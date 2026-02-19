// src/scrapers/remoteok.js — RemoteOK JSON API scraper.
// The first array element is a legal-notice object, not a job — skip it. Keyword-filter
// against position/description/tags, dedup by URL, insert platform='remoteok'.

import logger from '../utils/logger.js';
import { matchKeywords } from '../utils/keyword-match.js';
import { insertJob } from '../db/queries.js';

const API_URL = 'https://remoteok.com/api';

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeRemoteOK() {
  let inserted = 0;
  let considered = 0;
  try {
    const res = await fetch(API_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
    if (!res.ok) throw new Error(`RemoteOK API HTTP ${res.status}`);
    const data = await res.json();
    // Element 0 is the legal notice; real jobs start at index 1.
    const jobs = Array.isArray(data) ? data.slice(1) : [];

    for (const j of jobs) {
      considered += 1;
      const title = j.position || j.title || '';
      const description = stripHtml(j.description || '');
      const tags = Array.isArray(j.tags) ? j.tags : [];

      if (!matchKeywords(`${title} ${description}`, tags)) continue;

      const { inserted: didInsert } = insertJob({
        platform: 'remoteok',
        url: j.url || j.apply_url || null,
        title,
        company: j.company || null,
        description,
      });
      if (didInsert) inserted += 1;
    }
  } catch (err) {
    logger.error('scrapeRemoteOK failed', { error: err.message });
  }
  logger.info('scrapeRemoteOK complete', { inserted, considered });
  return { inserted, considered };
}

export default scrapeRemoteOK;
