// src/business/post-filter.js — classify LinkedIn posts for relevance.
// A fast deterministic pre-reject drops bench-sales / visa / C2C recruiter spam, then a
// résumé-grounded LLM decides {relevant, track, geoOk, skillMatch, reason}. Fail-safe:
// anything unparseable or erroring is REJECTED.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { complete } from '../intelligence/llm.js';
import { stripCodeFences } from '../intelligence/scorer.js';

const SPAM_PATTERNS = [
  /bench\s*sales/i,
  /\bc2c\b/i,
  /corp\s*to\s*corp/i,
  /\bopt\b|\bcpt\b/i,
  /h1\s*-?\s*b\s*transfer/i,
  /visa\s+sponsor/i,
  /gc\s+holders?/i,
  /passport\s+number/i,
  /hotlist/i,
];

const REJECT = (reason) => ({ relevant: false, track: null, geoOk: false, skillMatch: false, reason });

export async function classifyPost(post) {
  const text = (post?.text || '').trim();
  if (!text) return REJECT('empty post');

  // Deterministic pre-reject.
  for (const re of SPAM_PATTERNS) {
    if (re.test(text)) return REJECT(`spam pattern: ${re.source}`);
  }

  const resume = (config.resume || '').slice(0, 1500);
  const prompt = `Decide if this LinkedIn post is a genuine hiring/freelance opportunity that fits the
candidate. Return STRICT JSON:
{"relevant": <bool>, "track": "recruiter_job"|"founder_client"|null, "geoOk": <bool>, "skillMatch": <bool>, "reason": "<short>"}.
Reject bench-sales, visa/C2C spam, and roles far from the résumé.

=== RÉSUMÉ ===
${resume}

=== POST ===
${text.slice(0, 1500)}

JSON:`;

  try {
    const { text: out } = await complete(prompt, { temperature: 0.2, maxOutputTokens: 200 });
    const obj = JSON.parse(stripCodeFences(out));
    if (typeof obj.relevant !== 'boolean') return REJECT('unparseable classification');
    return {
      relevant: obj.relevant,
      track: obj.track ?? null,
      geoOk: !!obj.geoOk,
      skillMatch: !!obj.skillMatch,
      reason: obj.reason || '',
    };
  } catch (err) {
    logger.debug('classifyPost: fail-safe reject', { error: err.message });
    return REJECT('classifier error');
  }
}

export default classifyPost;
