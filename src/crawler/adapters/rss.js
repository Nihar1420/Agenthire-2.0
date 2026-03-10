// src/crawler/adapters/rss.js — RSS/Atom adapter factory.
// createRssAdapter({ name, source, url, splitTitle }) returns an adapter with
// fetchOpportunities() that normalizes feed items to Opportunity objects:
//   { source, title, company, url, description, applyEmail }

import { XMLParser } from 'fast-xml-parser';
import { crawlerFetch } from '../http.js';
import { stripHtml, extractEmail } from '../text.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function firstLink(entry) {
  // RSS uses <link>text; Atom uses <link href="...">.
  if (typeof entry.link === 'string') return entry.link;
  if (Array.isArray(entry.link)) {
    const alt = entry.link.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
    return (alt || entry.link[0])?.['@_href'] || null;
  }
  if (entry.link?.['@_href']) return entry.link['@_href'];
  if (entry.guid) return entry.guid['#text'] || entry.guid;
  if (entry.id) return entry.id;
  return null;
}

/** Split "Role at Company" / "Company: Role" into { title, company }. */
function splitRoleCompany(raw) {
  const atMatch = raw.match(/^(.*?)\s+at\s+(.+)$/i);
  if (atMatch) return { title: atMatch[1].trim(), company: atMatch[2].trim() };
  const colon = raw.indexOf(':');
  if (colon !== -1) return { company: raw.slice(0, colon).trim(), title: raw.slice(colon + 1).trim() };
  return { title: raw.trim(), company: null };
}

export function createRssAdapter({ name, source, url, splitTitle = false }) {
  return {
    name: name || source,
    source,
    async fetchOpportunities() {
      const res = await crawlerFetch(url);
      if (!res || !res.ok) return [];
      const xml = await res.text();
      const parsed = parser.parse(xml);

      // RSS: rss.channel.item[]. Atom: feed.entry[].
      const raw = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
      const items = Array.isArray(raw) ? raw : [raw].filter(Boolean);

      return items.map((item) => {
        const rawTitle = (item.title?.['#text'] || item.title || '').toString();
        const { title, company } = splitTitle ? splitRoleCompany(rawTitle) : { title: rawTitle, company: null };
        const descHtml = item.description || item.summary?.['#text'] || item.summary || item.content?.['#text'] || '';
        return {
          source,
          title,
          company,
          url: firstLink(item),
          description: stripHtml(descHtml),
          applyEmail: extractEmail(descHtml),
        };
      });
    },
  };
}

export default createRssAdapter;
