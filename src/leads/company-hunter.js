// src/leads/company-hunter.js — discover target companies for the developer outreach track.
// Three sources: (1) Apollo org search 1–50 employees (disabled-safe), (2) high-scoring DB
// jobs without an apply email, (3) companies seen on the Remotive feed. Inserts leads with
// source='company_hunt', score 60, deduped by company name.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import {
  insertLead,
  leadExistsByCompanySource,
  getHighScoreJobsWithoutApplyEmail,
  getRemotiveCompanies,
} from '../db/queries.js';

const SOURCE = 'company_hunt';

/** Apollo organization search (1–50 employees). Returns [] when Apollo is disabled. */
async function apolloOrgs(limit) {
  if (!config.apolloEnabled || !config.apolloApiKey) return [];
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.apolloApiKey,
        organization_num_employees_ranges: ['1,50'],
        page: 1,
        per_page: limit,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.organizations || []).map((o) => ({
      company: o.name,
      company_url: o.website_url || o.primary_domain ? `https://${o.primary_domain}` : null,
    }));
  } catch (err) {
    logger.debug('apolloOrgs failed', { error: err.message });
    return [];
  }
}

export async function findTargetCompanies(limit = 30) {
  const candidates = [];

  // Source 1: Apollo orgs.
  candidates.push(...(await apolloOrgs(Math.ceil(limit / 2))));

  // Source 2: high-score DB jobs without a direct apply email.
  for (const row of getHighScoreJobsWithoutApplyEmail(config.prospeoMinScore, limit)) {
    if (row.company) candidates.push({ company: row.company, company_url: null });
  }

  // Source 3: Remotive companies.
  for (const row of getRemotiveCompanies(limit)) {
    if (row.company) candidates.push({ company: row.company, company_url: null });
  }

  let inserted = 0;
  const seen = new Set();
  for (const c of candidates) {
    if (inserted >= limit) break;
    const key = (c.company || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (leadExistsByCompanySource(c.company, SOURCE)) continue;

    const { inserted: didInsert } = insertLead({
      source: SOURCE,
      company: c.company,
      company_url: c.company_url,
      score: 60,
      status: 'new',
    });
    if (didInsert) inserted += 1;
  }

  logger.info('findTargetCompanies complete', { inserted, candidates: candidates.length });
  return { inserted };
}

export default findTargetCompanies;
