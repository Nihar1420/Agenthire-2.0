// src/intelligence/scorer.js — LLM job scoring (0–100) against the résumé.
// Strict-JSON prompt at low temperature; robust parsing (strip code fences → regex
// fallback), clamp to 0–100, persist score + status='scored'.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { complete } from './llm.js';
import { getUnscoredJobs, updateJobScore } from '../db/queries.js';

const RESUME_CAP = 2500;
const DESC_CAP = 2000;

/** Remove ```json ... ``` fences some models wrap JSON in. */
export function stripCodeFences(text) {
  return (text || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/** Parse a score object from model text: JSON first, then a regex fallback. */
function parseScore(text) {
  const cleaned = stripCodeFences(text);
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.score === 'number') return obj;
  } catch {
    // fall through to regex
  }
  const m = cleaned.match(/"?score"?\s*[:=]\s*(\d{1,3})/i);
  if (m) return { score: parseInt(m[1], 10), reason: cleaned.slice(0, 300) };
  return null;
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildPrompt(job) {
  const resume = (config.resume || '').slice(0, RESUME_CAP);
  const desc = (job.description || '').slice(0, DESC_CAP);
  return `You are scoring how well a job matches a candidate's résumé.
Return STRICT JSON only, no prose: {"score": <0-100 integer>, "reason": "<one sentence>"}.

Scoring guide: 90-100 excellent fit, 70-89 strong, 50-69 possible, <50 weak.
Weight remote-friendliness, stack overlap, and seniority fit.

=== RÉSUMÉ ===
${resume}

=== JOB ===
Title: ${job.title || ''}
Company: ${job.company || ''}
Description: ${desc}

JSON:`;
}

/**
 * Score a single job. Persists score + status='scored'. Returns the numeric score,
 * or null if the model produced nothing parseable (job left unscored for retry).
 */
export async function scoreJob(job) {
  const { text } = await complete(buildPrompt(job), { temperature: 0.2, maxOutputTokens: 256 });
  const parsed = parseScore(text);
  if (!parsed) {
    logger.warn('scoreJob: unparseable model output', { jobId: job.id });
    return null;
  }
  const score = clamp(parsed.score);
  updateJobScore(job.id, score);
  logger.info('scored job', { jobId: job.id, score, title: job.title });
  return score;
}

/**
 * Score up to `limit` unscored jobs. A per-run cache keyed by title+company avoids
 * re-billing the LLM for duplicate listings that appear across multiple feeds.
 * @returns {Promise<{ scored: number }>}
 */
export async function scoreUnscoredJobs(limit = 50) {
  const jobs = getUnscoredJobs(limit);
  const cache = new Map();
  let scored = 0;

  for (const job of jobs) {
    const key = `${(job.title || '').toLowerCase()}::${(job.company || '').toLowerCase()}`;
    try {
      if (cache.has(key)) {
        // Reuse the score we already paid for this cycle.
        updateJobScore(job.id, cache.get(key));
        scored += 1;
        continue;
      }
      const score = await scoreJob(job);
      if (score !== null) {
        cache.set(key, score);
        scored += 1;
      }
    } catch (err) {
      logger.error('scoreUnscoredJobs: job failed', { jobId: job.id, error: err.message });
    }
  }

  logger.info('scoreUnscoredJobs complete', { scored, considered: jobs.length });
  return { scored };
}

export default { scoreJob, scoreUnscoredJobs, stripCodeFences };
