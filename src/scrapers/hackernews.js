// src/scrapers/hackernews.js — "Ask HN: Who is hiring?" scraper via the Algolia API.
// Finds the latest hiring thread, treats each top-level comment as a job post, extracts
// an apply email (rejecting noreply/junk), keyword-filters, dedups, inserts platform='hackernews'.

import logger from '../utils/logger.js';
import { matchKeywords } from '../utils/keyword-match.js';
import { insertJob } from '../db/queries.js';

const SEARCH_URL =
  'https://hn.algolia.com/api/v1/search_by_date?query=%22Ask%20HN%3A%20Who%20is%20hiring%3F%22&tags=story&hitsPerPage=1';
const ITEM_URL = (id) => `https://hn.algolia.com/api/v1/items/${id}`;

const JUNK_EMAIL = /(noreply|no-reply|example\.com|sentry|wixpress|\.png|\.jpg|@2x)/i;

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmail(text) {
  const matches = (text || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  for (const e of matches) {
    if (!JUNK_EMAIL.test(e)) return e.toLowerCase();
  }
  return null;
}

export async function scrapeHackerNews() {
  let inserted = 0;
  let considered = 0;
  try {
    const searchRes = await fetch(SEARCH_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
    if (!searchRes.ok) throw new Error(`HN search HTTP ${searchRes.status}`);
    const search = await searchRes.json();
    const storyId = search?.hits?.[0]?.objectID;
    if (!storyId) throw new Error('No hiring thread found');

    const itemRes = await fetch(ITEM_URL(storyId));
    if (!itemRes.ok) throw new Error(`HN item HTTP ${itemRes.status}`);
    const item = await itemRes.json();
    const comments = item?.children || [];

    for (const c of comments) {
      if (!c || !c.text) continue;
      considered += 1;
      const text = stripHtml(c.text);
      if (!matchKeywords(text)) continue;

      // Use the first line as a pseudo-title.
      const title = text.slice(0, 120);
      const { inserted: didInsert } = insertJob({
        platform: 'hackernews',
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        title,
        company: null,
        description: text,
        apply_email: extractEmail(c.text),
      });
      if (didInsert) inserted += 1;
    }
  } catch (err) {
    logger.error('scrapeHackerNews failed', { error: err.message });
  }
  logger.info('scrapeHackerNews complete', { inserted, considered });
  return { inserted, considered };
}

export default scrapeHackerNews;
