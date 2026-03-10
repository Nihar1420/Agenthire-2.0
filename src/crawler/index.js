// src/crawler/index.js — pluggable crawler registry + routing.
// registerAdapter() adds a source; runCrawler() runs each adapter in isolation (one bad
// adapter never breaks the others), normalizes each Opportunity, and routes it into the
// jobs table. Opportunities with an applyEmail are normal jobs; those without are flagged
// as needing a contact lookup (hirer queue).

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { insertJob } from '../db/queries.js';
import { createRssAdapter } from './adapters/rss.js';
import { createJsonAdapter } from './adapters/json-api.js';
import { createHtmlAdapter } from './adapters/html.js';
import { stripHtml, extractEmail } from './text.js';

const adapters = [];

/** Register an adapter (anything with a `source` and async `fetchOpportunities()`). */
export function registerAdapter(adapter) {
  if (adapter && typeof adapter.fetchOpportunities === 'function') {
    adapters.push(adapter);
  }
  return adapters.length;
}

export function getAdapters() {
  return adapters.slice();
}

/** Normalize an Opportunity to a consistent shape. */
export function normalizeOpportunity(opp, source) {
  return {
    source: opp.source || source,
    title: (opp.title || '').toString().trim() || 'Untitled role',
    company: opp.company ? String(opp.company).trim() : null,
    url: opp.url || null,
    description: (opp.description || '').toString().trim(),
    applyEmail: opp.applyEmail ? String(opp.applyEmail).toLowerCase().trim() : null,
  };
}

/** Route one Opportunity into the jobs table. Returns true if a new row was inserted. */
export function routeOpportunity(opp) {
  const hasEmail = !!opp.applyEmail;
  const { inserted } = insertJob({
    platform: opp.source,
    url: opp.url,
    title: opp.title,
    company: opp.company,
    description: opp.description,
    apply_email: opp.applyEmail,
    // No direct email ⇒ this row needs a contact lookup before it can be actioned.
    status: hasEmail ? 'new' : 'needs_contact',
  });
  return inserted;
}

/** Run every registered adapter in isolation and route what they return. */
export async function runCrawler() {
  let inserted = 0;
  for (const adapter of adapters) {
    try {
      if (adapter.dormant) continue;
      const opps = await adapter.fetchOpportunities();
      for (const raw of opps || []) {
        const opp = normalizeOpportunity(raw, adapter.source);
        if (!opp.url) continue;
        if (routeOpportunity(opp)) inserted += 1;
      }
      logger.info('crawler: adapter done', { source: adapter.source, returned: (opps || []).length });
    } catch (err) {
      logger.error('crawler: adapter failed', { source: adapter.source, error: err.message });
    }
  }
  logger.info('runCrawler complete', { inserted, adapters: adapters.length });
  return { inserted };
}

// ─────────────────────────────────────────────────────────
// Live source registrations (run once at import).
// ─────────────────────────────────────────────────────────

registerAdapter(
  createRssAdapter({ name: 'RemoteYeah', source: 'remoteyeah', url: 'https://remoteyeah.com/rss.xml', splitTitle: true })
);
registerAdapter(
  createRssAdapter({
    name: 'RealWorkFromAnywhere',
    source: 'realworkfromanywhere',
    url: 'https://www.realworkfromanywhere.com/feed.xml',
    splitTitle: true,
  })
);
registerAdapter(
  createJsonAdapter({
    name: 'Himalayas',
    source: 'himalayas',
    url: 'https://himalayas.app/jobs/api',
    paginate: { limit: 50, maxPages: 3, offsetParam: 'offset', limitParam: 'limit' },
    mapItem: (j) => ({
      title: j.title || j.jobTitle,
      company: j.companyName || j.company?.name,
      url: j.applicationLink || j.guid || j.url,
      description: stripHtml(j.description || j.excerpt || ''),
      applyEmail: extractEmail(j.description || ''),
    }),
  })
);
registerAdapter(
  createJsonAdapter({
    name: 'Jobicy',
    source: 'jobicy',
    url: 'https://jobicy.com/api/v2/remote-jobs?count=50',
    mapItem: (j) => ({
      title: j.jobTitle || j.title,
      company: j.companyName,
      url: j.url,
      description: stripHtml(j.jobDescription || j.jobExcerpt || ''),
      applyEmail: extractEmail(j.jobDescription || ''),
    }),
  })
);

// Config-gated static HTML career page (dormant unless CRAWLER_HTML_CAREER_URL is set).
registerAdapter(
  createHtmlAdapter({ name: 'CareerPage', source: 'career-page', url: config.crawlerHtmlCareerUrl })
);

export default runCrawler;
