// src/business/business-email.js — find a generic business inbox for an SMB.
// First tries Hunter.io domain-search, then falls back to scraping the site's home / contact
// / contact-us / about pages for role inboxes (info@, hello@, …). Never throws.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { crawlerFetch } from '../crawler/http.js';
import { extractEmails } from '../crawler/text.js';

const ROLE_LOCALPARTS = ['info', 'hello', 'contact', 'hi', 'sales', 'team', 'admin', 'office', 'support'];
const PAGES = ['', '/contact', '/contact-us', '/about'];

function domainFromWebsite(website) {
  try {
    return new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Prefer a role inbox on the target domain, else the first email on the domain, else first. */
function pickBest(emails, domain) {
  const onDomain = emails.filter((e) => e.endsWith(`@${domain}`));
  const pool = onDomain.length ? onDomain : emails;
  const role = pool.find((e) => ROLE_LOCALPARTS.includes(e.split('@')[0]));
  return role || pool[0] || null;
}

async function hunterDomainSearch(domain) {
  if (!config.hunterApiKey) return [];
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(
        config.hunterApiKey
      )}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.emails || []).map((e) => e.value.toLowerCase());
  } catch {
    return [];
  }
}

async function scrapeSite(website, domain) {
  const base = website.startsWith('http') ? website.replace(/\/$/, '') : `https://${website}`;
  const found = [];
  for (const path of PAGES) {
    const res = await crawlerFetch(`${base}${path}`);
    if (res && res.ok) {
      const html = await res.text();
      found.push(...extractEmails(html));
    }
    if (found.some((e) => e.endsWith(`@${domain}`))) break; // good enough
  }
  return found;
}

/**
 * @param {{website?:string, domain?:string}} biz
 * @returns {Promise<{email:string, source:string}|null>}
 */
export async function findBusinessEmail(biz = {}) {
  const domain = biz.domain || (biz.website ? domainFromWebsite(biz.website) : null);
  if (!domain) return null;

  // 1) Hunter domain-search.
  const hunterEmails = await hunterDomainSearch(domain);
  let best = pickBest(hunterEmails, domain);
  if (best) return { email: best, source: 'hunter_domain' };

  // 2) Scrape the site for a role inbox.
  if (biz.website) {
    try {
      const scraped = await scrapeSite(biz.website, domain);
      best = pickBest(scraped, domain);
      if (best) return { email: best, source: 'site_scrape' };
    } catch (err) {
      logger.debug('findBusinessEmail: scrape failed', { domain, error: err.message });
    }
  }
  return null;
}

export default findBusinessEmail;
