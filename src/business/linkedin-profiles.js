// src/business/linkedin-profiles.js — LinkedIn profile discovery via Apify.
// searchLinkedInProfiles({titles, locations}) runs the HarvestAPI profile-search actor in
// Full+email mode, geo-filters to ALLOWED_COUNTRIES, and returns profiles with validated
// emails. Never throws (returns [] on failure).

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { insertLead, insertContact, contactExistsByLinkedIn } from '../db/queries.js';

const ALLOWED_COUNTRIES = (process.env.ALLOWED_COUNTRIES || 'United States,Canada,United Kingdom,Australia')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Run an Apify actor synchronously and return its dataset items. */
export async function runApifyActor(actorId, input) {
  if (!config.apifyApiToken) return [];
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(
    config.apifyApiToken
  )}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify actor ${actorId} HTTP ${res.status}`);
  return res.json();
}

function inAllowedCountry(location) {
  if (!location) return false;
  const l = String(location).toLowerCase();
  return ALLOWED_COUNTRIES.some((c) => l.includes(c));
}

export async function searchLinkedInProfiles({ titles = [], locations = [] } = {}) {
  if (!config.apifyApiToken) {
    logger.debug('searchLinkedInProfiles: APIFY_API_TOKEN not set, skipping');
    return [];
  }
  try {
    const items = await runApifyActor(config.apifyProfileActor, {
      title: titles,
      location: locations,
      profileScraperMode: 'Full + email required (~$8 per 1k)',
      maxItems: config.linkedinProfileDailyCap,
    });

    const profiles = (Array.isArray(items) ? items : [])
      .map((p) => ({
        name: p.fullName || p.name || [p.firstName, p.lastName].filter(Boolean).join(' '),
        title: p.headline || p.title || p.position || null,
        company: p.companyName || p.company || null,
        linkedin_url: p.linkedinUrl || p.profileUrl || p.url || null,
        email: (p.email || '').toLowerCase() || null,
        location: p.location || p.locationName || null,
      }))
      .filter((p) => p.linkedin_url && inAllowedCountry(p.location))
      .map((p) => ({ ...p, email: p.email && EMAIL_RE.test(p.email) ? p.email : null }));

    logger.info('searchLinkedInProfiles complete', { returned: profiles.length });
    return profiles;
  } catch (err) {
    logger.warn('searchLinkedInProfiles failed', { error: err.message });
    return [];
  }
}

// Title priority for hiring contacts (higher index = better). Off-list titles are rejected.
const CONTACT_TITLE_PRIORITY = [
  'talent',
  'recruiter',
  'recruiting',
  'people',
  'hr',
  'hiring manager',
  'engineering manager',
  'head of engineering',
  'vp engineering',
  'cto',
  'founder',
  'co-founder',
  'ceo',
];

/** Rank a title by CONTACT_TITLE_PRIORITY. Returns -1 for off-list titles (rejected). */
export function titleRank(title) {
  const t = (title || '').toLowerCase();
  let best = -1;
  CONTACT_TITLE_PRIORITY.forEach((kw, i) => {
    if (t.includes(kw) && i > best) best = i;
  });
  return best;
}

/**
 * Find the single best hiring contact at a company via LinkedIn profile search.
 * Rejects anyone whose title isn't on CONTACT_TITLE_PRIORITY (title-rank floor of 0).
 * @returns {Promise<object|null>} the best contact (with jobId attached) or null
 */
export async function findContactForCompany(jobId, company) {
  if (!company) return null;
  const profiles = await searchLinkedInProfiles({
    titles: CONTACT_TITLE_PRIORITY.slice(-6), // senior/decision-maker titles
    locations: [],
  });

  const ranked = profiles
    .filter((p) => (p.company || '').toLowerCase().includes(company.toLowerCase()))
    .map((p) => ({ ...p, rank: titleRank(p.title) }))
    .filter((p) => p.rank >= 0) // reject off-list titles
    .sort((a, b) => b.rank - a.rank);

  const best = ranked[0] || null;
  if (best) logger.info('findContactForCompany: found', { company, name: best.name, title: best.title });
  return best ? { ...best, jobId } : null;
}

/** Recruiter-side titles imply a job lead; everyone else is treated as a potential client. */
function trackFor(title) {
  const t = (title || '').toLowerCase();
  return /recruit|talent|\bhr\b|people|hiring/.test(t) ? 'recruiter_job' : 'founder_client';
}

/**
 * Insert discovered profiles as one company-lead + one person-contact each, deduped on
 * linkedin_url. Returns { inserted } (number of new contacts).
 */
export function insertProfiles(profiles = []) {
  let inserted = 0;
  for (const p of profiles) {
    if (!p.linkedin_url || contactExistsByLinkedIn(p.linkedin_url)) continue;
    const track = trackFor(p.title);

    const lead = insertLead({
      source: 'linkedin',
      company: p.company,
      name: p.name,
      title: p.title,
      linkedin_url: p.linkedin_url,
      email: p.email,
      email_status: p.email ? 'verified' : null,
      score: 65,
      status: p.email ? 'ready_for_outreach' : 'new',
    });

    insertContact({
      source_type: 'linkedin',
      source_id: lead.id,
      name: p.name,
      company: p.company,
      linkedin_url: p.linkedin_url,
      email: p.email,
      email_status: p.email ? 'verified' : null,
      status: 'new',
      track,
    });
    inserted += 1;
  }
  logger.info('insertProfiles complete', { inserted, considered: profiles.length });
  return { inserted };
}

export { ALLOWED_COUNTRIES, CONTACT_TITLE_PRIORITY };
export default searchLinkedInProfiles;
