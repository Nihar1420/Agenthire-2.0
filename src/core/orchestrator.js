// src/core/orchestrator.js — the cycle brain.
// runStep() wraps every step so a single failure never stops the ones after it.
// runCycle() runs the pipeline in order: feed scrapers → scoring → apply. Counts,
// cycle logging, the scheduler, and later tracks are layered on in subsequent commits.

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

const JOB_FEEDS = ['scrapeWWR', 'scrapeRemotive', 'scrapeRemoteOK', 'scrapeHackerNews', 'scrapeUpwork'];

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

  // ── Score ──
  steps.push(await runStep('scoreUnscoredJobs', () => scoreUnscoredJobs(50)));

  // ── Apply ──
  steps.push(await runStep('applyToJobs', applyToJobs));

  const counts = {
    jobs_found: sumField(steps, JOB_FEEDS, 'inserted'),
    leads_found: sumField(steps, ['scrapeWellfound'], 'inserted'),
    jobs_scored: sumField(steps, ['scoreUnscoredJobs'], 'scored'),
    emails_found: 0,
    proposals_sent: sumField(steps, ['applyToJobs'], 'applied'),
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

export default runCycle;
