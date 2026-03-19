// src/business/company-finder.js — discover SMB leads for active business ideas.
// Source priority: Google Places (primary) → Apollo orgs (disabled-safe) → Google HTML
// scrape (last resort). Inserts leads source='smb_hunt', score 60, with JSON notes carrying
// the originating idea and a pitch_tier (website / webapp / ai_automation).

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { searchPlaces } from './places-finder.js';
import { crawlerFetch } from '../crawler/http.js';
import { stripHtml } from '../crawler/text.js';
import { insertLead, leadExistsByCompanySource, getActiveBusinessIdeas } from '../db/queries.js';

const SOURCE = 'smb_hunt';

/** Tier the pitch: no website ⇒ needs a website; has site + many employees ⇒ automation. */
function pitchTier({ website, employeeCount }) {
  if (!website) return 'website';
  if (employeeCount && employeeCount >= 20) return 'ai_automation';
  return 'webapp';
}

function queryFor(idea) {
  const kw = Array.isArray(idea.keywords) ? idea.keywords.join(' ') : idea.keywords || '';
  return [idea.type, idea.geography, kw].filter(Boolean).join(' ').trim() || idea.type || 'local business';
}

async function apolloOrgs(query, limit) {
  if (!config.apolloEnabled || !config.apolloApiKey) return [];
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: config.apolloApiKey, q_organization_name: query, per_page: limit }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.organizations || []).map((o) => ({
      name: o.name,
      website: o.website_url || null,
      employeeCount: o.estimated_num_employees || null,
    }));
  } catch {
    return [];
  }
}

/** Very light Google HTML fallback — just enough to surface a few business names. */
async function googleScrape(query, limit) {
  try {
    const res = await crawlerFetch(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    if (!res || !res.ok) return [];
    const text = stripHtml(await res.text());
    // Heuristic: pull capitalized multiword phrases as candidate names.
    const names = (text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\b/g) || []).slice(0, limit);
    return [...new Set(names)].map((name) => ({ name, website: null, employeeCount: null }));
  } catch {
    return [];
  }
}

export async function findSMBLeads(limit = 30) {
  const ideas = getActiveBusinessIdeas(10);
  let inserted = 0;
  const perIdea = Math.max(3, Math.ceil(limit / Math.max(1, ideas.length)));

  for (const idea of ideas) {
    if (inserted >= limit) break;
    const query = queryFor(idea);

    let businesses = (await searchPlaces(query, perIdea)).map((p) => ({
      name: p.name,
      website: p.website,
      address: p.address,
      phone: p.phone,
      employeeCount: null,
    }));
    if (businesses.length === 0) businesses = await apolloOrgs(query, perIdea);
    if (businesses.length === 0) businesses = await googleScrape(query, perIdea);

    for (const biz of businesses) {
      if (inserted >= limit) break;
      if (!biz.name || leadExistsByCompanySource(biz.name, SOURCE)) continue;

      const tier = pitchTier(biz);
      const notes = JSON.stringify({
        idea_id: idea.id,
        idea_type: idea.type,
        service_pitch: idea.service_pitch,
        pitch_tier: tier,
        address: biz.address || null,
        phone: biz.phone || null,
      });
      const { inserted: didInsert } = insertLead({
        source: SOURCE,
        company: biz.name,
        company_url: biz.website,
        score: 60,
        status: 'new',
        notes,
      });
      if (didInsert) inserted += 1;
    }
  }

  logger.info('findSMBLeads complete', { inserted, ideas: ideas.length });
  return { inserted };
}

export default findSMBLeads;
