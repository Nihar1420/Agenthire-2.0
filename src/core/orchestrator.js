// src/core/orchestrator.js — the cycle brain.
// runStep() wraps every step so a single failure never stops the ones after it.
// runCycle() runs the pipeline in order: feed scrapers → scoring → apply. Counts,
// cycle logging, the scheduler, and later tracks are layered on in subsequent commits.

import cron from 'node-cron';
import logger from '../utils/logger.js';
import { insertCycleLog, updateCycleLog } from '../db/queries.js';

import scrapeWWR from '../scrapers/wwr.js';
import scrapeRemotive from '../scrapers/remotive.js';
import scrapeRemoteOK from '../scrapers/remoteok.js';
import scrapeHackerNews from '../scrapers/hackernews.js';
import scrapeWellfound from '../scrapers/wellfound.js';
import scrapeUpwork from '../scrapers/upwork.js';
import { scoreUnscoredJobs } from '../intelligence/scorer.js';
import applyToJobs from '../scrapers/apply.js';
import runCrawler from '../crawler/index.js';
import { findEmailsForLeads, findEmailsForContacts } from '../email/hunter.js';
import { verifyGuessedContacts } from '../email/verifier.js';
import findTargetCompanies from '../leads/company-hunter.js';
import enrichDiscoveredLeads from '../leads/enricher.js';
import sendOutreachEmails, { sendContactOutreach, processSendRequests } from '../leads/outreach.js';
import findSMBLeads from '../business/company-finder.js';
import qualifySMBLeads from '../business/qualifier.js';
import sendSMBOutreach from '../business/smb-outreach.js';
import emailApplyToJobs from '../scrapers/email-apply.js';

/**
 * Run a named step. Never throws — returns { name, ok, result?, error? } so the cycle can
 * always continue and record what happened.
 */
export async function runStep(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    logger.info(`step ok: ${name}`, { ms: Date.now() - started });
    return { name, ok: true, result };
  } catch (err) {
    logger.error(`step failed: ${name}`, { error: err.message });
    return { name, ok: false, error: err.message };
  }
}

/** Sum a field across the named steps' successful results. */
function sumField(steps, names, field) {
  return steps
    .filter((s) => names.includes(s.name) && s.ok && s.result)
    .reduce((acc, s) => acc + (s.result[field] || 0), 0);
}

const JOB_FEEDS = ['scrapeWWR', 'scrapeRemotive', 'scrapeRemoteOK', 'scrapeHackerNews', 'scrapeUpwork', 'crawlSources'];

/** Run one full cycle. Opens a cycle_logs row, runs the pipeline, and records counts + errors. */
export async function runCycle() {
  logger.info('cycle starting');
  const cycleId = insertCycleLog();
  const steps = [];

  // ── Feeds ──
  steps.push(await runStep('scrapeWWR', scrapeWWR));
  steps.push(await runStep('scrapeRemotive', scrapeRemotive));
  steps.push(await runStep('scrapeRemoteOK', scrapeRemoteOK));
  steps.push(await runStep('scrapeHackerNews', scrapeHackerNews));
  steps.push(await runStep('scrapeWellfound', scrapeWellfound));
  steps.push(await runStep('scrapeUpwork', scrapeUpwork));

  // ── Pluggable crawler sources ──
  steps.push(await runStep('crawlSources', runCrawler));

  // ── Score ──
  steps.push(await runStep('scoreUnscoredJobs', () => scoreUnscoredJobs(50)));

  // ── Email finding + verification ──
  steps.push(await runStep('findEmailsForLeads', () => findEmailsForLeads(25)));
  steps.push(await runStep('findEmailsForContacts', () => findEmailsForContacts(25)));
  steps.push(await runStep('verifyGuessedContacts', verifyGuessedContacts));

  // ── Apply ──
  steps.push(await runStep('applyToJobs', applyToJobs));

  // ── Developer outreach track ──
  steps.push(await runStep('findTargetCompanies', () => findTargetCompanies(30)));
  steps.push(await runStep('enrichDiscoveredLeads', () => enrichDiscoveredLeads(20)));
  steps.push(await runStep('sendOutreachEmails', () => sendOutreachEmails()));
  steps.push(await runStep('sendContactOutreach', () => sendContactOutreach()));
  steps.push(await runStep('processSendRequests', () => processSendRequests()));

  // ── SMB track ──
  steps.push(await runStep('findSMBLeads', () => findSMBLeads(30)));
  steps.push(await runStep('qualifySMBLeads', () => qualifySMBLeads(20)));
  steps.push(await runStep('sendSMBOutreach', () => sendSMBOutreach()));

  // ── LinkedIn discovery runs here (once/day) — wired in a later commit. ──

  // ── Direct email-apply track ──
  steps.push(await runStep('emailApplyToJobs', emailApplyToJobs));

  // ── runSequence (3-touch follow-ups) is implemented but intentionally DISABLED here. ──

  const counts = {
    jobs_found: sumField(steps, JOB_FEEDS, 'inserted'),
    leads_found: sumField(steps, ['scrapeWellfound', 'findTargetCompanies', 'findSMBLeads'], 'inserted'),
    jobs_scored: sumField(steps, ['scoreUnscoredJobs'], 'scored'),
    emails_found: sumField(steps, ['findEmailsForLeads', 'findEmailsForContacts'], 'found'),
    proposals_sent:
      sumField(steps, ['applyToJobs'], 'applied') +
      sumField(
        steps,
        ['sendOutreachEmails', 'sendContactOutreach', 'processSendRequests', 'sendSMBOutreach', 'emailApplyToJobs'],
        'sent'
      ),
  };
  const errors = steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`);

  updateCycleLog(cycleId, {
    finished_at: new Date().toISOString(),
    status: errors.length ? 'completed_with_errors' : 'completed',
    ...counts,
    errors: errors.length ? JSON.stringify(errors) : null,
  });

  logger.info('cycle complete', { ...counts, failed: errors.length });
  return { cycleId, steps, counts };
}

const TZ = 'Asia/Kolkata';
const CRON = '0 */2 * * *'; // every 2 hours

/**
 * Start the orchestrator: fire one cycle immediately (fire-and-forget), then run every 2h.
 */
export function startOrchestrator() {
  logger.info('orchestrator starting — firing initial cycle');
  runCycle().catch((err) => logger.error('initial cycle failed', { error: err.message }));

  cron.schedule(CRON, () => {
    runCycle().catch((err) => logger.error('scheduled cycle failed', { error: err.message }));
  }, { timezone: TZ });

  logger.info('orchestrator scheduled', { cron: CRON, timezone: TZ });
}

// Direct-run support: `node src/core/orchestrator.js --once` runs a single cycle and exits;
// without --once it starts the scheduler.
if (process.argv[1] && process.argv[1].endsWith('orchestrator.js')) {
  if (process.argv.includes('--once')) {
    runCycle()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    startOrchestrator();
  }
}

export default runCycle;
