// src/core/orchestrator.js — the cycle brain.
// runStep() wraps every step so a single failure never stops the ones after it.
// runCycle() runs the pipeline in order: feed scrapers → scoring → apply. Counts,
// cycle logging, the scheduler, and later tracks are layered on in subsequent commits.

import logger from '../utils/logger.js';

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

/** Run one full cycle. Returns the array of step results. */
export async function runCycle() {
  logger.info('cycle starting');
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

  logger.info('cycle complete', { steps: steps.length, failed: steps.filter((s) => !s.ok).length });
  return steps;
}

export default runCycle;
