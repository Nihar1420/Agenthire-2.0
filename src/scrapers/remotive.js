// src/scrapers/remotive.js — Remotive JSON API scraper.
// Pulls the public jobs feed, keyword-filters against title+description+tags,
// dedups by URL, and inserts platform='remotive'.

import logger from '../utils/logger.js';
import { matchKeywords } from '../utils/keyword-match.js';
import { insertJob } from '../db/queries.js';

const API_URL = 'https://remotive.com/api/remote-jobs';

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeRemotive() {
  let inserted = 0;
  let considered = 0;
  try {
    const res = await fetch(API_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
    if (!res.ok) throw new Error(`Remotive API HTTP ${res.status}`);
    const data = await res.json();
    const jobs = data?.jobs || [];

    for (const j of jobs) {
      considered += 1;
      const title = j.title || '';
      const description = stripHtml(j.description || '');
      const tags = Array.isArray(j.tags) ? j.tags : [];

      if (!matchKeywords(`${title} ${description}`, tags)) continue;

      const { inserted: didInsert } = insertJob({
        platform: 'remotive',
        url: j.url || null,
        title,
        company: j.company_name || null,
        description,
      });
      if (didInsert) inserted += 1;
    }
  } catch (err) {
    logger.error('scrapeRemotive failed', { error: err.message });
  }
  logger.info('scrapeRemotive complete', { inserted, considered });
  return { inserted, considered };
}

export default scrapeRemotive;
