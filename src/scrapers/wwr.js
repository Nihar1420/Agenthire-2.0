// src/scrapers/wwr.js — We Work Remotely RSS scraper.
// Feed titles are "Company: Role". We strip HTML from the description, pull a mailto:
// apply address when present, keyword-filter, dedup-by-URL, and insert platform='wwr'.

import { XMLParser } from 'fast-xml-parser';
import logger from '../utils/logger.js';
import { matchKeywords } from '../utils/keyword-match.js';
import { insertJob } from '../db/queries.js';

const FEED_URL = 'https://weworkremotely.com/categories/remote-programming-jobs.rss';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMailto(html) {
  const m = (html || '').match(/mailto:([^"'>\s?]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Split "Company: Role" title into { company, title }. */
function splitTitle(raw) {
  const idx = (raw || '').indexOf(':');
  if (idx === -1) return { company: null, title: (raw || '').trim() };
  return { company: raw.slice(0, idx).trim(), title: raw.slice(idx + 1).trim() };
}

export async function scrapeWWR() {
  let inserted = 0;
  let considered = 0;
  try {
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
    if (!res.ok) throw new Error(`WWR feed HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item || [];
    const list = Array.isArray(items) ? items : [items];

    for (const item of list) {
      considered += 1;
      const { company, title } = splitTitle(item.title || '');
      const descHtml = item.description || '';
      const description = stripHtml(descHtml);
      const url = item.link || item.guid?.['#text'] || item.guid || null;

      if (!matchKeywords(`${title} ${description}`)) continue;

      const { inserted: didInsert } = insertJob({
        platform: 'wwr',
        url,
        title,
        company,
        description,
        apply_email: extractMailto(descHtml),
      });
      if (didInsert) inserted += 1;
    }
  } catch (err) {
    logger.error('scrapeWWR failed', { error: err.message });
  }
  logger.info('scrapeWWR complete', { inserted, considered });
  return { inserted, considered };
}

export default scrapeWWR;
