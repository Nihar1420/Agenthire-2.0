// src/email/hunter.js — decision-maker email discovery.
// A fallback chain tried in order; the first hit wins. This commit adds method 1:
// a verified email_patterns row for the lead's domain. Later methods (SMTP guess, Apollo,
// Snov, Hunter, Prospeo) and batch drivers are layered on in subsequent commits.

import net from 'node:net';
import { resolveMx } from 'node:dns/promises';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { getEmailPattern } from '../db/queries.js';

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

/** Extract a company domain from a lead. Full version (blocklist etc.) lands in a later commit. */
export function extractDomain(lead) {
  if (lead.company_url) {
    try {
      const host = new URL(lead.company_url).hostname.replace(/^www\./, '');
      if (host) return host;
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

/**
 * Find an email for a lead. Returns { email, method, status } or null.
 * Method 1: verified email_patterns row. Method 2: SMTP RCPT-TO guess.
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

  return null;
}

export default findEmail;
