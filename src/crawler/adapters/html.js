// src/crawler/adapters/html.js — static HTML career-page adapter.
// createHtmlAdapter({ name, source, url }) is DORMANT unless a url is provided (the config
// gate CRAWLER_HTML_CAREER_URL). It fetches the page, strips it, and emits one Opportunity
// per distinct email found, suffixing the url with "#<email>" so routing dedup stays unique.

import * as cheerio from 'cheerio';
import { crawlerFetch } from '../http.js';
import { extractEmails, stripHtml } from '../text.js';

export function createHtmlAdapter({ name, source = 'html-career', url = null } = {}) {
  return {
    name: name || source,
    source,
    dormant: !url,
    async fetchOpportunities() {
      if (!url) return []; // dormant until configured
      const res = await crawlerFetch(url);
      if (!res || !res.ok) return [];
      const html = await res.text();

      const $ = cheerio.load(html);
      const title = ($('title').first().text() || '').trim() || 'Careers';
      const bodyText = stripHtml($('body').html() || html);
      const emails = extractEmails(html);

      // One opportunity per distinct email; unique url via #<email> suffix.
      return emails.map((email) => ({
        source,
        title,
        company: null,
        url: `${url}#${email}`,
        description: bodyText.slice(0, 2000),
        applyEmail: email,
      }));
    },
  };
}

export default createHtmlAdapter;
