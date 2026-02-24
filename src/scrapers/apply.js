// src/scrapers/apply.js — Upwork apply engine.
// Eligibility + daily cap (re-checked mid-loop), a persistent stealth browser context,
// and injection of the oauth2_global_js_token session cookie before navigation.
// Captcha/login guards and submission are layered on in later commits.

import { join } from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { humanDelay } from '../utils/delay.js';
import { writeProposal } from '../intelligence/writer.js';
import {
  getScoredJobsForPlatform,
  getTodayApplicationCountByType,
  insertApplication,
  markJobApplied,
} from '../db/queries.js';

const APPLY_TYPE = 'upwork_apply';
const PROFILE_DIR = join(process.cwd(), 'browser-data', 'upwork');

const APPLY_SELECTORS = [
  'button:has-text("Apply Now")',
  'a:has-text("Submit a Proposal")',
  'button:has-text("Submit a Proposal")',
  '[data-test="apply-button"]',
];
const COVER_SELECTORS = [
  'textarea[aria-label*="cover" i]',
  'textarea[name*="cover" i]',
  'textarea[placeholder*="cover" i]',
  'textarea',
];
const BID_SELECTORS = ['input[name*="rate" i]', 'input[aria-label*="rate" i]', 'input[type="number"]'];
const SUBMIT_SELECTORS = [
  'button:has-text("Send")',
  'button:has-text("Submit")',
  '[data-test="submit-proposal"]',
];

/** Click the first selector that exists. Returns true on success. */
async function clickFirst(page, selectors, timeout = 4000) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().then((n) => n > 0).catch(() => false)) {
      try {
        await el.click({ timeout });
        return true;
      } catch {
        /* try next */
      }
    }
  }
  return false;
}

/** Fill the first selector that exists. Returns true on success. */
async function fillFirst(page, selectors, value, timeout = 4000) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().then((n) => n > 0).catch(() => false)) {
      try {
        await el.fill(value, { timeout });
        return true;
      } catch {
        /* try next */
      }
    }
  }
  return false;
}

chromium.use(StealthPlugin());

function getEligibleJobs() {
  return getScoredJobsForPlatform('upwork', config.prospeoMinScore); // ≥75
}

/**
 * Detect a captcha challenge or a redirect to login. Returns a reason string when the
 * page is blocked, or null when it looks like a normal job page.
 */
async function detectBlock(page) {
  const url = page.url();
  if (/\/(login|signin)/i.test(url) || /login\.upwork\.com/i.test(url)) return 'login-redirect';

  const blocked = await page
    .evaluate(() => {
      const html = document.body ? document.body.innerText.toLowerCase() : '';
      if (document.querySelector('iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')) {
        return 'captcha-iframe';
      }
      if (/are you a human|verify you are|unusual traffic|complete the captcha/.test(html)) {
        return 'captcha-text';
      }
      return null;
    })
    .catch(() => null);

  return blocked;
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

      // Never crash on a block — log and abort the whole cycle gracefully.
      const block = await detectBlock(page);
      if (block) {
        logger.warn('applyToJobs: blocked, aborting cycle', { reason: block, jobId: job.id });
        break;
      }

      const proposal = await writeProposal(job);
      const urlBefore = page.url();

      if (!(await clickFirst(page, APPLY_SELECTORS))) {
        logger.info('applyToJobs: no apply control found, skipping', { jobId: job.id });
        continue;
      }
      await humanDelay(2000, 5000);
      await fillFirst(page, COVER_SELECTORS, proposal.body);
      if (config.skills?.hourlyRate?.min) {
        await fillFirst(page, BID_SELECTORS, String(config.skills.hourlyRate.min));
      }
      await humanDelay(1500, 4000);

      const submitted = await clickFirst(page, SUBMIT_SELECTORS);
      if (!submitted) {
        logger.info('applyToJobs: submit control not found, skipping', { jobId: job.id });
        continue;
      }

      // Wait for a URL change or a success marker.
      await page
        .waitForFunction(
          (before) =>
            location.href !== before ||
            /proposal|success|submitted|thank/i.test(document.body?.innerText || ''),
          urlBefore,
          { timeout: 15000 }
        )
        .catch(() => {});

      insertApplication({
        type: APPLY_TYPE,
        job_id: job.id,
        to_email: null,
        company: job.company,
        subject: proposal.subject,
        body: proposal.body,
        status: 'sent',
      });
      markJobApplied(job.id);
      applied += 1;
      logger.info('applyToJobs: submitted', { jobId: job.id, applied });

      // Mandatory cool-down between submits.
      await humanDelay(45000, 90000);
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
