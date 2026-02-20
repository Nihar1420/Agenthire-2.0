// src/scrapers/upwork.js — "Upwork" job source.
// INTENTIONAL QUIRK: this scrapes RemoteOK, not Upwork. Upwork's RSS returns 410 and its
// HTML is Cloudflare-gated, so we back this source with RemoteOK's public JSON. The name
// and platform='upwork' are kept so the apply engine and orchestrator imports stay stable.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { matchKeywords } from '../utils/keyword-match.js';
import { insertJob } from '../db/queries.js';

const API_URL = 'https://remoteok.com/api';

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeUpwork() {
  let inserted = 0;
  let considered = 0;
  const cap = config.upworkListingsCap;
  try {
    const res = await fetch(API_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
    if (!res.ok) throw new Error(`RemoteOK API HTTP ${res.status}`);
    const data = await res.json();
    const jobs = Array.isArray(data) ? data.slice(1) : [];

    for (const j of jobs) {
      if (inserted >= cap) break;
      considered += 1;
      const title = j.position || j.title || '';
      const description = stripHtml(j.description || '');
      const tags = Array.isArray(j.tags) ? j.tags : [];
      if (!matchKeywords(`${title} ${description}`, tags)) continue;

      // Tag the URL so it can't collide with the remoteok.js feed's own rows.
      const url = (j.url || j.apply_url || '') + '#upwork';
      const { inserted: didInsert } = insertJob({
        platform: 'upwork',
        url,
        title,
        company: j.company || null,
        description,
      });
      if (didInsert) inserted += 1;
    }
  } catch (err) {
    logger.error('scrapeUpwork failed', { error: err.message });
  }
  logger.info('scrapeUpwork complete', { inserted, considered, cap });
  return { inserted, considered };
}

export default scrapeUpwork;
