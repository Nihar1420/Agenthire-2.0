// src/email/hunter.js — decision-maker email discovery.
// A fallback chain tried in order; the first hit wins. This commit adds method 1:
// a verified email_patterns row for the lead's domain. Later methods (SMTP guess, Apollo,
// Snov, Hunter, Prospeo) and batch drivers are layered on in subsequent commits.

import logger from '../utils/logger.js';
import { getEmailPattern } from '../db/queries.js';

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
 * Find an email for a lead. Returns { email, method, status } or null.
 * Method 1: apply a verified email_patterns row for the domain.
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

  return null;
}

export default findEmail;
