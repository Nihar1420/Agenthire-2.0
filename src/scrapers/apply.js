// src/scrapers/apply.js — Upwork apply engine (eligibility + daily cap).
// Selects scored, high-fit jobs and applies up to the daily cap, re-checking the cap
// mid-loop because counts can change during a long cycle. Browser automation, session
// injection, captcha guards, and submission are layered on in later commits.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { getScoredJobsForPlatform, getTodayApplicationCountByType } from '../db/queries.js';

const APPLY_TYPE = 'upwork_apply';

/** Eligible jobs: platform='upwork', status='scored', score ≥ 75, best first. */
function getEligibleJobs() {
  return getScoredJobsForPlatform('upwork', config.prospeoMinScore); // ≥75
}

export async function applyToJobs() {
  const jobs = getEligibleJobs();
  const cap = config.upworkDailyCap; // 8
  let applied = 0;

  if (jobs.length === 0) {
    logger.info('applyToJobs: no eligible jobs');
    return { applied: 0, eligible: 0 };
  }

  for (const job of jobs) {
    // Re-check the cap mid-loop — other paths may have consumed it during this cycle.
    const usedToday = getTodayApplicationCountByType(APPLY_TYPE);
    if (usedToday + applied >= cap) {
      logger.info('applyToJobs: daily cap reached', { cap, usedToday, applied });
      break;
    }

    // Submission is implemented in later commits; for now we only account for eligibility.
    logger.debug('applyToJobs: eligible job', { jobId: job.id, score: job.score, title: job.title });
  }

  logger.info('applyToJobs complete', { eligible: jobs.length, applied });
  return { applied, eligible: jobs.length };
}

export default applyToJobs;
