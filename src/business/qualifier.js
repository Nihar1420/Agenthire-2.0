// src/business/qualifier.js — qualify SMB leads (part 1: probe + score + primary email).
// For each new smb_hunt lead: parse its notes, probe the website (5s), ask the LLM for a
// 0–100 fit score (<50 ⇒ low_score and stop), then try Apollo for an Owner/GM/Director and
// findBusinessEmail as the primary email source. The gated fallback + verify land next commit.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { complete } from '../intelligence/llm.js';
import { stripCodeFences } from '../intelligence/scorer.js';
import { findBusinessEmail } from './business-email.js';
import { findEmail } from '../email/hunter.js';
import { hasMxRecord } from '../email/sender.js';
import { getLeadsBySourceStatus, updateLeadEnrichment } from '../db/queries.js';

const SOURCE = 'smb_hunt';
const OWNER_TITLES = ['Owner', 'General Manager', 'GM', 'Director', 'Managing Director', 'Principal'];
const SMB_FALLBACK_MIN_SCORE = 65; // only spend paid finder credits on strong-enough SMB leads

/** Drop undeliverable addresses (no MX). Returns the email if it looks deliverable, else null. */
async function verifyEmailState(email) {
  if (!email) return null;
  return (await hasMxRecord(email)) ? email : null;
}

function parseNotes(lead) {
  try {
    return JSON.parse(lead.notes || '{}');
  } catch {
    return {};
  }
}

/** Reachable within 5s? */
async function probeWebsite(url) {
  if (!url) return false;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url.startsWith('http') ? url : `https://${url}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': config.crawlerUserAgent },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function scoreFit(lead, notes, siteUp) {
  const prompt = `Score 0-100 how good a freelance-dev sales prospect this local business is.
Higher = clearer digital gap we can fix and likely budget. Return STRICT JSON {"score": <int>}.
Business: ${lead.company}
Category: ${notes.idea_type || 'unknown'}
Pitch: ${notes.service_pitch || ''}
Website reachable: ${siteUp ? 'yes' : 'no'}`;
  try {
    const { text } = await complete(prompt, { temperature: 0.2, maxOutputTokens: 60 });
    const obj = JSON.parse(stripCodeFences(text));
    const n = Math.max(0, Math.min(100, Math.round(obj.score)));
    return Number.isFinite(n) ? n : 50;
  } catch {
    return 50; // neutral default when the model is unavailable
  }
}

async function apolloOwner(lead) {
  if (!config.apolloEnabled || !config.apolloApiKey || !lead.company) return null;
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: config.apolloApiKey, q_organization_name: lead.company, person_titles: OWNER_TITLES, per_page: 3 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = (data?.people || [])[0];
    if (p) return { name: p.name, title: p.title, email: /unlocked/i.test(p.email || '') ? null : p.email };
  } catch {
    /* ignore */
  }
  return null;
}

/** Qualify SMB leads. This commit stops after the primary email attempt; part 2 finalizes. */
export async function qualifySMBLeads(limit = 20) {
  const leads = getLeadsBySourceStatus(SOURCE, 'new', limit);
  let qualified = 0;

  for (const lead of leads) {
    const notes = parseNotes(lead);
    const siteUp = await probeWebsite(lead.company_url);
    const score = await scoreFit(lead, notes, siteUp);

    if (score < 50) {
      updateLeadEnrichment(lead.id, { score, status: 'low_score' });
      continue;
    }

    const owner = await apolloOwner(lead);
    let email = owner?.email || null;

    // Primary: generic business inbox.
    if (!email) {
      const biz = await findBusinessEmail({ website: lead.company_url });
      if (biz) email = biz.email;
    }

    // Gated fallback: the 6-method chain, only for strong SMB leads (≥65).
    if (!email && score >= SMB_FALLBACK_MIN_SCORE) {
      const result = await findEmail({ ...lead, name: owner?.name || lead.name });
      if (result?.email) email = result.email;
    }

    // Drop undeliverable addresses before we ever queue them.
    email = await verifyEmailState(email);

    if (email) {
      updateLeadEnrichment(lead.id, {
        score,
        name: owner?.name || null,
        title: owner?.title || null,
        email,
        email_status: 'guessed',
        status: 'ready_for_outreach',
        ready_for_outreach: 1,
      });
      qualified += 1;
    } else {
      updateLeadEnrichment(lead.id, {
        score,
        name: owner?.name || null,
        title: owner?.title || null,
        status: 'no_email',
      });
    }
  }

  logger.info('qualifySMBLeads (part 1) complete', { qualified, considered: leads.length });
  return { qualified };
}

export default qualifySMBLeads;
