// src/scrapers/wellfound.js — Wellfound (AngelList Talent) lead scraper.
// Injects the TAsessionID cookie into a persistent stealth context (direct connection,
// no proxy — Wellfound is sensitive to datacenter IPs). This is a LEAD scraper: it never
// applies. Lead extraction is added in the next commit.

import { join } from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../core/config.js';
import logger from '../utils/logger.js';

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
    // Extraction + insert added in the next commit.
    return { inserted: 0, cardSelector, count };
  } catch (err) {
    logger.error('scrapeWellfound failed', { error: err.message });
    return { inserted: 0 };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export default scrapeWellfound;
