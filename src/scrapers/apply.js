// src/scrapers/apply.js — Upwork apply engine.
// Eligibility + daily cap (re-checked mid-loop), a persistent stealth browser context,
// and injection of the oauth2_global_js_token session cookie before navigation.
// Captcha/login guards and submission are layered on in later commits.

import { join } from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { getScoredJobsForPlatform, getTodayApplicationCountByType } from '../db/queries.js';

const APPLY_TYPE = 'upwork_apply';
const PROFILE_DIR = join(process.cwd(), 'browser-data', 'upwork');

chromium.use(StealthPlugin());

function getEligibleJobs() {
  return getScoredJobsForPlatform('upwork', config.prospeoMinScore); // ≥75
}

/** Launch a persistent, stealthed browser context and inject the Upwork session cookie. */
async function launchContext() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });

  if (config.upworkSessionToken) {
    await context.addCookies([
      {
        name: 'oauth2_global_js_token',
        value: config.upworkSessionToken,
        domain: '.upwork.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    logger.debug('apply: injected oauth2_global_js_token cookie');
  }

  return context;
}

export async function applyToJobs() {
  const jobs = getEligibleJobs();
  const cap = config.upworkDailyCap; // 8
  let applied = 0;

  if (jobs.length === 0) {
    logger.info('applyToJobs: no eligible jobs');
    return { applied: 0, eligible: 0 };
  }

  let context;
  try {
    context = await launchContext();
    const page = await context.newPage();

    for (const job of jobs) {
      const usedToday = getTodayApplicationCountByType(APPLY_TYPE);
      if (usedToday + applied >= cap) {
        logger.info('applyToJobs: daily cap reached', { cap, usedToday, applied });
        break;
      }
      if (!job.url) continue;

      await page.goto(job.url.replace('#upwork', ''), { waitUntil: 'domcontentloaded' });
      logger.debug('applyToJobs: navigated', { jobId: job.id, title: job.title });
      // Guards + submission follow in later commits.
    }
  } catch (err) {
    logger.error('applyToJobs failed', { error: err.message });
  } finally {
    if (context) await context.close().catch(() => {});
  }

  logger.info('applyToJobs complete', { eligible: jobs.length, applied });
  return { applied, eligible: jobs.length };
}

export default applyToJobs;
