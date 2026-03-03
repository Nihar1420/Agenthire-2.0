// src/email/hunter.js — decision-maker email discovery.
// A fallback chain tried in order; the first hit wins. This commit adds method 1:
// a verified email_patterns row for the lead's domain. Later methods (SMTP guess, Apollo,
// Snov, Hunter, Prospeo) and batch drivers are layered on in subsequent commits.

import net from 'node:net';
import { resolveMx } from 'node:dns/promises';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import {
  getEmailPattern,
  saveEmailPattern,
  getLeadsWithoutEmail,
  updateLeadEnrichment,
  updateLeadStatus,
} from '../db/queries.js';

const SMTP_TIMEOUT_MS = 8000;
const MAIL_FROM = () => `verify@${config.sendingDomain || 'example.com'}`;

/** Split a full name into normalized { first, last } tokens (alnum, lowercase). */
export function splitName(name) {
  const parts = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '' };
}

/** Apply a stored pattern like "{first}.{last}" to a name + domain → an email address. */
export function applyPattern(pattern, name, domain) {
  const { first, last } = splitName(name);
  if (!first) return null;
  const local = pattern
    .replace(/\{first\}/g, first)
    .replace(/\{last\}/g, last)
    .replace(/\{f\}/g, first[0] || '')
    .replace(/\{l\}/g, last[0] || '')
    .replace(/[^a-z0-9._-]/g, '');
  if (!local || local.endsWith('.') || local.startsWith('.')) return null;
  return `${local}@${domain}`;
}

// Directory / aggregator hosts that are never a company's own email domain.
const DIRECTORY_HOSTS = [
  'wellfound.com',
  'angel.co',
  'linkedin.com',
  'crunchbase.com',
  'github.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'medium.com',
  'notion.site',
  'google.com',
  'ycombinator.com',
  'indeed.com',
  'glassdoor.com',
];

function isDirectoryHost(host) {
  return DIRECTORY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Extract a company's own email domain from a lead. Prefers company_url's host (minus
 * www.), but rejects directory/aggregator hosts and falls back to a name-slug .com.
 */
export function extractDomain(lead) {
  if (lead.company_url) {
    try {
      const host = new URL(lead.company_url).hostname.replace(/^www\./, '').toLowerCase();
      if (host && !isDirectoryHost(host)) return host;
    } catch {
      /* fall through */
    }
  }
  if (lead.company) {
    const slug = lead.company.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (slug) return `${slug}.com`;
  }
  return null;
}

/**
 * Hand-rolled SMTP RCPT-TO probe. Opens a socket to the MX, walks the greeting → EHLO →
 * MAIL FROM → RCPT TO handshake, and resolves true when the server returns 2xx for RCPT.
 * Never throws (resolves false on any error/timeout).
 */
function smtpProbe(mxHost, rcpt) {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost);
    let stage = 0;
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        socket.write('QUIT\r\n');
        socket.end();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    socket.setTimeout(SMTP_TIMEOUT_MS, () => finish(false));
    socket.on('error', () => finish(false));

    socket.on('data', (buf) => {
      const code = parseInt(buf.toString().slice(0, 3), 10);
      if (stage === 0) {
        if (code !== 220) return finish(false);
        socket.write(`EHLO ${config.sendingDomain || 'example.com'}\r\n`);
        stage = 1;
      } else if (stage === 1) {
        socket.write(`MAIL FROM:<${MAIL_FROM()}>\r\n`);
        stage = 2;
      } else if (stage === 2) {
        if (code !== 250) return finish(false);
        socket.write(`RCPT TO:<${rcpt}>\r\n`);
        stage = 3;
      } else if (stage === 3) {
        finish(code >= 200 && code < 300);
      }
    });
  });
}

/** Candidate local-part patterns for a name, in priority order. */
function candidatePatterns(name) {
  const { first, last } = splitName(name);
  if (!first) return [];
  const pats = [];
  if (last) {
    pats.push({ pattern: '{first}.{last}', local: `${first}.${last}` });
    pats.push({ pattern: '{f}{last}', local: `${first[0]}${last}` });
    pats.push({ pattern: '{first}{last}', local: `${first}${last}` });
  }
  pats.push({ pattern: '{first}', local: first });
  return pats;
}

/**
 * SMTP method: resolve MX, detect a catch-all (which makes RCPT probing meaningless), then
 * probe candidate addresses in order. Returns { email, pattern } or null.
 */
async function smtpGuess(name, domain) {
  let mx;
  try {
    const records = await resolveMx(domain);
    mx = records.sort((a, b) => a.priority - b.priority)[0]?.exchange;
  } catch {
    return null;
  }
  if (!mx) return null;

  // Catch-all detection: a random address that accepts ⇒ every address "accepts".
  const catchAll = await smtpProbe(mx, `zz-nonexistent-${Date.now()}@${domain}`);
  if (catchAll) {
    logger.debug('smtpGuess: catch-all domain, skipping', { domain });
    return null;
  }

  for (const cand of candidatePatterns(name)) {
    const email = `${cand.local}@${domain}`;
    // eslint-disable-next-line no-await-in-loop
    if (await smtpProbe(mx, email)) {
      return { email, pattern: cand.pattern };
    }
  }
  return null;
}

/** Method 3: Apollo /people/match by name + company. Skipped when APOLLO_ENABLED=false. */
async function apolloMatch(lead) {
  if (!config.apolloEnabled || !config.apolloApiKey || !lead.name) return null;
  const { first, last } = splitName(lead.name);
  try {
    const res = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        api_key: config.apolloApiKey,
        first_name: first,
        last_name: last,
        organization_name: lead.company || undefined,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email = data?.person?.email;
    if (email && !/email_not_unlocked/i.test(email)) {
      return { email: email.toLowerCase(), method: 'apollo', status: 'verified' };
    }
  } catch (err) {
    logger.debug('apolloMatch failed', { error: err.message });
  }
  return null;
}

// Snov OAuth token cache.
let _snovToken = null;
let _snovTokenExp = 0;

async function snovToken() {
  if (_snovToken && Date.now() < _snovTokenExp) return _snovToken;
  if (!config.snovClientId || !config.snovClientSecret) return null;
  try {
    const res = await fetch('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: config.snovClientId,
        client_secret: config.snovClientSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    _snovToken = data.access_token;
    _snovTokenExp = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3000_000) - 60_000;
    return _snovToken;
  } catch {
    return null;
  }
}

/** Method 4: Snov.io get-emails-from-names (name + domain). */
async function snovFind(lead, domain) {
  const token = await snovToken();
  if (!token || !lead.name) return null;
  const { first, last } = splitName(lead.name);
  try {
    const url =
      `https://api.snov.io/v1/get-emails-from-names?access_token=${encodeURIComponent(token)}` +
      `&firstName=${encodeURIComponent(first)}&lastName=${encodeURIComponent(last)}` +
      `&domain=${encodeURIComponent(domain)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const emails = data?.data?.emails || data?.emails || [];
    const valid = emails.find((e) => /valid/i.test(e.status || e.smtp_status || '')) || emails[0];
    const email = valid?.email;
    if (email) {
      const status = /valid/i.test(valid.status || valid.smtp_status || '') ? 'verified' : 'guessed';
      return { email: email.toLowerCase(), method: 'snov', status };
    }
  } catch (err) {
    logger.debug('snovFind failed', { error: err.message });
  }
  return null;
}

/** Method 5: Hunter.io email-finder (domain + name). */
async function hunterFind(lead, domain) {
  if (!config.hunterApiKey || !lead.name) return null;
  const { first, last } = splitName(lead.name);
  try {
    const url =
      `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}` +
      `&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}` +
      `&api_key=${encodeURIComponent(config.hunterApiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const email = data?.data?.email;
    if (email) {
      const score = data?.data?.score ?? 0;
      return { email: email.toLowerCase(), method: 'hunter', status: score >= 80 ? 'verified' : 'guessed' };
    }
  } catch (err) {
    logger.debug('hunterFind failed', { error: err.message });
  }
  return null;
}

/**
 * Method 6: Prospeo LinkedIn→email. HARD-GATED — only called when score ≥ prospeoMinScore
 * AND a linkedin_url is present, because Prospeo burns paid credits. Saves the winning
 * pattern to email_patterns for future free lookups.
 */
async function prospeoFind(lead, domain) {
  if (!config.prospeoApiKey) return null;
  if ((lead.score ?? 0) < config.prospeoMinScore) return null; // gate: score
  if (!lead.linkedin_url) return null; // gate: LinkedIn URL required
  try {
    const res = await fetch('https://api.prospeo.io/linkedin-email-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': config.prospeoApiKey },
      body: JSON.stringify({ url: lead.linkedin_url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email = data?.response?.email || data?.email;
    if (email) {
      const lc = email.toLowerCase();
      // Learn the pattern so we don't pay next time for this domain.
      if (lead.name && domain) {
        const { first, last } = splitName(lead.name);
        const local = lc.split('@')[0];
        let pattern = null;
        if (last && local === `${first}.${last}`) pattern = '{first}.{last}';
        else if (last && local === `${first[0]}${last}`) pattern = '{f}{last}';
        else if (last && local === `${first}${last}`) pattern = '{first}{last}';
        else if (local === first) pattern = '{first}';
        if (pattern) saveEmailPattern(domain, pattern, 1);
      }
      return { email: lc, method: 'prospeo', status: 'verified' };
    }
  } catch (err) {
    logger.debug('prospeoFind failed', { error: err.message });
  }
  return null;
}

/**
 * Find an email for a lead. Returns { email, method, status } or null.
 * Methods in order: 1 DB pattern · 2 SMTP guess · 3 Apollo · 4 Snov · 5 Hunter.io · 6 Prospeo (gated).
 */
export async function findEmail(lead) {
  const domain = extractDomain(lead);
  if (!domain) return null;

  // ── Method 1: DB pattern cache ──
  const pattern = getEmailPattern(domain);
  if (pattern && pattern.verified && lead.name) {
    const email = applyPattern(pattern.pattern, lead.name, domain);
    if (email) {
      logger.debug('findEmail: hit via db_pattern', { domain, email });
      return { email, method: 'db_pattern', status: 'verified' };
    }
  }

  // ── Method 2: SMTP guesser ──
  if (lead.name) {
    const smtp = await smtpGuess(lead.name, domain);
    if (smtp) {
      logger.debug('findEmail: hit via smtp', { domain, email: smtp.email });
      return { email: smtp.email, method: 'smtp', status: 'verified', pattern: smtp.pattern };
    }
  }

  // ── Method 3: Apollo people/match ──
  const apollo = await apolloMatch(lead);
  if (apollo) {
    logger.debug('findEmail: hit via apollo', { email: apollo.email });
    return apollo;
  }

  // ── Method 4: Snov.io ──
  const snov = await snovFind(lead, domain);
  if (snov) {
    logger.debug('findEmail: hit via snov', { email: snov.email });
    return snov;
  }

  // ── Method 5: Hunter.io ──
  const hunter = await hunterFind(lead, domain);
  if (hunter) {
    logger.debug('findEmail: hit via hunter', { email: hunter.email });
    return hunter;
  }

  // ── Method 6: Prospeo (hard-gated) ──
  const prospeo = await prospeoFind(lead, domain);
  if (prospeo) {
    logger.debug('findEmail: hit via prospeo', { email: prospeo.email });
    return prospeo;
  }

  return null;
}

/** Persist a winning email + (optional) learned pattern for a lead. */
function persistLeadEmail(lead, result) {
  updateLeadEnrichment(lead.id, { email: result.email, email_status: result.status });
  if (result.pattern) {
    const domain = extractDomain(lead);
    if (domain) saveEmailPattern(domain, result.pattern, result.status === 'verified' ? 1 : 0);
  }
}

/**
 * Batch driver: find emails for leads that lack one. On a clean miss, mark the lead
 * 'email_not_found' so we don't re-bill paid methods on the next cycle.
 * @returns {Promise<{found:number, missed:number}>}
 */
export async function findEmailsForLeads(limit = 25) {
  const leads = getLeadsWithoutEmail(limit);
  let found = 0;
  let missed = 0;
  for (const lead of leads) {
    try {
      const result = await findEmail(lead);
      if (result && result.email) {
        persistLeadEmail(lead, result);
        found += 1;
      } else {
        updateLeadStatus(lead.id, 'email_not_found');
        missed += 1;
      }
    } catch (err) {
      logger.warn('findEmailsForLeads: lead failed', { leadId: lead.id, error: err.message });
    }
  }
  logger.info('findEmailsForLeads complete', { found, missed, considered: leads.length });
  return { found, missed };
}

/**
 * Batch driver for user-added contacts. The contacts table + queries land in a later phase,
 * so we import them lazily to keep this module loadable before they exist.
 * @returns {Promise<{found:number, missed:number}>}
 */
export async function findEmailsForContacts(limit = 25) {
  const q = await import('../db/queries.js');
  if (typeof q.getContactsWithoutEmail !== 'function') {
    logger.debug('findEmailsForContacts: contacts layer not available yet');
    return { found: 0, missed: 0 };
  }
  const contacts = q.getContactsWithoutEmail(limit);
  let found = 0;
  let missed = 0;
  for (const c of contacts) {
    try {
      const result = await findEmail(c);
      if (result && result.email) {
        q.updateContactEmail(c.id, result.email, result.status);
        found += 1;
      } else {
        q.updateContactEmail(c.id, null, 'email_not_found');
        missed += 1;
      }
    } catch (err) {
      logger.warn('findEmailsForContacts: contact failed', { contactId: c.id, error: err.message });
    }
  }
  logger.info('findEmailsForContacts complete', { found, missed, considered: contacts.length });
  return { found, missed };
}

export default findEmail;
