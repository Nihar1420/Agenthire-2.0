// src/crawler/http.js — polite HTTP for the crawler.
// fetchWithTimeout adds a real UA + AbortController timeout and a per-domain rate limiter.
// robotsAllowed parses robots.txt (fail-open). crawlerFetch composes the two.

import config from '../core/config.js';
import logger from '../utils/logger.js';

const lastFetchAt = new Map(); // domain -> timestamp
const robotsCache = new Map(); // domain -> { rules, fetchedAt }

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Wait so we never hit the same domain more often than CRAWLER_PER_DOMAIN_DELAY_MS. */
async function throttle(domain) {
  const now = Date.now();
  const last = lastFetchAt.get(domain) || 0;
  const wait = config.crawlerPerDomainDelayMs - (now - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt.set(domain, Date.now());
}

/** fetch() with a real UA and an AbortController timeout. */
export async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.crawlerFetchTimeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'User-Agent': config.crawlerUserAgent, ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse the Disallow rules for our UA (and *) from robots.txt text. */
function parseRobots(text) {
  const rules = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = field.toLowerCase();
    if (key === 'user-agent') {
      applies = value === '*' || /agenthire/i.test(value);
    } else if (key === 'disallow' && applies && value) {
      rules.push(value);
    }
  }
  return rules;
}

/** Is fetching `url` allowed by robots.txt? Fail-open (allow) on any error. */
export async function robotsAllowed(url) {
  const domain = domainOf(url);
  if (!domain) return true;
  try {
    let entry = robotsCache.get(domain);
    if (!entry) {
      const res = await fetchWithTimeout(`https://${domain}/robots.txt`);
      const text = res.ok ? await res.text() : '';
      entry = { rules: parseRobots(text) };
      robotsCache.set(domain, entry);
    }
    const path = new URL(url).pathname;
    return !entry.rules.some((rule) => path.startsWith(rule));
  } catch {
    return true; // fail-open
  }
}

/** Robots-aware, throttled fetch. Returns the Response, or null if disallowed/failed. */
export async function crawlerFetch(url, opts = {}) {
  const domain = domainOf(url);
  if (!domain) return null;
  if (!(await robotsAllowed(url))) {
    logger.debug('crawlerFetch: blocked by robots.txt', { url });
    return null;
  }
  await throttle(domain);
  try {
    return await fetchWithTimeout(url, opts);
  } catch (err) {
    logger.debug('crawlerFetch: failed', { url, error: err.message });
    return null;
  }
}

export default crawlerFetch;
