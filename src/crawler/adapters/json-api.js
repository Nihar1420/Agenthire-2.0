// src/crawler/adapters/json-api.js — JSON API adapter factory.
// createJsonAdapter({ name, source, url, paginate, mapItem }) returns an adapter with
// fetchOpportunities(). Supports a single call or offset/limit pagination. extractItems
// tolerates several common envelope shapes; the caller's mapItem produces Opportunities.

import { crawlerFetch } from '../http.js';

/** Find the array of items in a variety of common JSON envelope shapes. */
export function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of ['jobs', 'results', 'data', 'items', 'positions', 'listings']) {
    if (Array.isArray(data[key])) return data[key];
  }
  // Nested one level (e.g. { data: { jobs: [...] } }).
  for (const v of Object.values(data)) {
    if (v && typeof v === 'object') {
      const nested = extractItems(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function createJsonAdapter({ name, source, url, mapItem, paginate = null }) {
  return {
    name: name || source,
    source,
    async fetchOpportunities() {
      const out = [];

      const pull = async (fetchUrl) => {
        const res = await crawlerFetch(fetchUrl, { headers: { Accept: 'application/json' } });
        if (!res || !res.ok) return [];
        const data = await res.json().catch(() => null);
        return extractItems(data);
      };

      if (!paginate) {
        const items = await pull(url);
        for (const it of items) {
          const opp = mapItem(it);
          if (opp) out.push({ source, ...opp });
        }
        return out;
      }

      // Offset/limit pagination: { limit, maxPages, param: {offset,limit} }.
      const { limit = 50, maxPages = 3, offsetParam = 'offset', limitParam = 'limit' } = paginate;
      for (let page = 0; page < maxPages; page += 1) {
        const sep = url.includes('?') ? '&' : '?';
        const pageUrl = `${url}${sep}${limitParam}=${limit}&${offsetParam}=${page * limit}`;
        const items = await pull(pageUrl);
        if (items.length === 0) break;
        for (const it of items) {
          const opp = mapItem(it);
          if (opp) out.push({ source, ...opp });
        }
        if (items.length < limit) break;
      }
      return out;
    },
  };
}

export default createJsonAdapter;
