// src/business/linkedin-profiles.js — LinkedIn profile discovery via Apify.
// searchLinkedInProfiles({titles, locations}) runs the HarvestAPI profile-search actor in
// Full+email mode, geo-filters to ALLOWED_COUNTRIES, and returns profiles with validated
// emails. Never throws (returns [] on failure).

import config from '../core/config.js';
import logger from '../utils/logger.js';

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

export { ALLOWED_COUNTRIES };
export default searchLinkedInProfiles;
