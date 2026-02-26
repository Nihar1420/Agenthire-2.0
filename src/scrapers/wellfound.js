// src/scrapers/wellfound.js — Wellfound (AngelList Talent) lead scraper.
// Injects the TAsessionID cookie into a persistent stealth context (direct connection,
// no proxy — Wellfound is sensitive to datacenter IPs). This is a LEAD scraper: it never
// applies. Lead extraction is added in the next commit.

import { join } from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { insertLead } from '../db/queries.js';

const PROFILE_DIR = join(process.cwd(), 'browser-data', 'wellfound');
const START_URL = 'https://wellfound.com/jobs';

// Wellfound rotates its markup; try several selectors for a "company card".
const CARD_SELECTORS = [
  '[data-test="StartupResult"]',
  '[data-test="job-listing-company"]',
  'div.styles_component__company',
  'div[class*="startupResult"]',
];

chromium.use(StealthPlugin());

async function launchContext() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    proxy: undefined, // direct connection on purpose
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });

  if (config.wellfoundSession) {
    await context.addCookies([
      {
        name: 'TAsessionID',
        value: config.wellfoundSession,
        domain: '.wellfound.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    logger.debug('wellfound: injected TAsessionID cookie');
  }

  return context;
}

/** Find the first card selector that actually matches on the page. */
async function resolveCardSelector(page) {
  for (const sel of CARD_SELECTORS) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) return sel;
  }
  return null;
}

export async function scrapeWellfound() {
  let context;
  try {
    if (!config.wellfoundSession) {
      logger.info('scrapeWellfound: WELLFOUND_SESSION not set, skipping');
      return { inserted: 0 };
    }
    context = await launchContext();
    const page = await context.newPage();
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

    const cardSelector = await resolveCardSelector(page);
    if (!cardSelector) {
      logger.warn('scrapeWellfound: no company cards matched any selector');
      return { inserted: 0 };
    }
    const count = await page.locator(cardSelector).count();
    logger.info('scrapeWellfound: located company cards', { cardSelector, count });

    // One page-side pass extracts everything we can from each card.
    const leads = await page.$$eval(cardSelector, (cards) =>
      cards.map((card) => {
        const text = (sel) => card.querySelector(sel)?.textContent?.trim() || null;
        const attr = (sel, a) => card.querySelector(sel)?.getAttribute(a) || null;
        const companyLink = attr('a[href*="/company/"]', 'href') || attr('a[href*="/startups/"]', 'href');
        const slug = companyLink ? companyLink.split('/').filter(Boolean).pop() : null;
        const linkedin = attr('a[href*="linkedin.com"]', 'href');
        const founderText = card.innerText || '';
        const stageMatch = founderText.match(/(Seed|Series [A-E]|Pre-Seed|Public|Acquired)/i);
        const empMatch = founderText.match(/(\d[\d,]*(?:\s*-\s*\d[\d,]*)?)\s+employees/i);
        return {
          company: text('[data-test="startup-name"]') || text('h2') || text('a[href*="/company/"]'),
          slug,
          company_url: companyLink ? `https://wellfound.com${companyLink}` : null,
          name: text('[data-test="founder-name"]'),
          title: text('[data-test="founder-title"]'),
          linkedin_url: linkedin,
          funding_stage: stageMatch ? stageMatch[1] : null,
          employee_count: empMatch ? empMatch[1] : null,
        };
      })
    );

    const cap = config.wellfoundListingsCap;
    const seen = new Set();
    let inserted = 0;
    for (const l of leads) {
      if (inserted >= cap) break;
      if (!l.company) continue;
      const slug = l.slug || l.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (seen.has(slug)) continue;
      seen.add(slug);

      const notes = JSON.stringify({
        funding_stage: l.funding_stage,
        employee_count: l.employee_count,
        slug,
      });
      const { inserted: didInsert } = insertLead({
        source: 'wellfound',
        company: l.company,
        company_url: l.company_url,
        name: l.name,
        title: l.title,
        linkedin_url: l.linkedin_url,
        score: 60,
        status: 'new',
        notes,
      });
      if (didInsert) inserted += 1;
    }

    logger.info('scrapeWellfound complete', { inserted, extracted: leads.length, cap });
    return { inserted };
  } catch (err) {
    logger.error('scrapeWellfound failed', { error: err.message });
    return { inserted: 0 };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export default scrapeWellfound;
