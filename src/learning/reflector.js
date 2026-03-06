// src/learning/reflector.js — weekly self-analysis.
// Joins the last 28 days of applications to their jobs/leads, aggregates reply-rate by
// platform / body-length bucket / send-hour in plain JS, then (when there are ≥10 apps)
// asks the LLM to summarise actionable patterns. A learning row is ALWAYS persisted so the
// copywriters have something to read. Scheduled Sundays 06:00 IST.

import cron from 'node-cron';
import logger from '../utils/logger.js';
import { complete } from '../intelligence/llm.js';
import { getReflectionData, insertLearning } from '../db/queries.js';

const TZ = 'Asia/Kolkata';
const MIN_APPS_FOR_LLM = 10;

function bucketLength(len) {
  if (len < 400) return 'short (<400)';
  if (len < 800) return 'medium (400-800)';
  return 'long (>800)';
}

function rate(replied, total) {
  return total ? Math.round((replied / total) * 100) : 0;
}

/** Aggregate reply-rate across a few dimensions. */
function aggregate(rows) {
  const dims = { platform: {}, length: {}, hour: {} };
  const bump = (obj, key, replied) => {
    obj[key] = obj[key] || { total: 0, replied: 0 };
    obj[key].total += 1;
    obj[key].replied += replied ? 1 : 0;
  };
  for (const r of rows) {
    bump(dims.platform, r.platform || r.type || 'unknown', r.replied);
    bump(dims.length, bucketLength(r.body_len || 0), r.replied);
    bump(dims.hour, String(r.send_hour ?? '?'), r.replied);
  }
  const flatten = (obj) =>
    Object.entries(obj)
      .map(([k, v]) => `${k}: ${rate(v.replied, v.total)}% (${v.replied}/${v.total})`)
      .join('; ');
  return {
    byPlatform: flatten(dims.platform),
    byLength: flatten(dims.length),
    byHour: flatten(dims.hour),
  };
}

export async function runReflection() {
  const rows = getReflectionData();
  const agg = aggregate(rows);

  let summary =
    `Reflection over ${rows.length} applications (28d). ` +
    `Reply-rate by platform — ${agg.byPlatform || 'n/a'}. ` +
    `By length — ${agg.byLength || 'n/a'}. By send hour — ${agg.byHour || 'n/a'}.`;

  if (rows.length >= MIN_APPS_FOR_LLM) {
    try {
      const prompt = `You are analysing outbound job/sales performance. Given these reply-rate
aggregates, write 3-5 short, concrete, actionable rules a copywriter should follow next week.
Return one rule per line, no preamble.

By platform: ${agg.byPlatform}
By body length: ${agg.byLength}
By send hour: ${agg.byHour}`;
      const { text } = await complete(prompt, { temperature: 0.4, maxOutputTokens: 300 });
      if (text && text.trim()) summary = text.trim();
    } catch (err) {
      logger.warn('runReflection: LLM summary failed, persisting raw aggregate', { error: err.message });
    }
  }

  insertLearning(summary); // always persist
  logger.info('runReflection complete', { apps: rows.length });
  return { apps: rows.length, summary };
}

export function startReflectionScheduler() {
  cron.schedule('0 6 * * 0', () => runReflection().catch((e) => logger.error('reflection cron failed', { error: e.message })), {
    timezone: TZ,
  });
  logger.info('reflection scheduler started (0 6 * * 0 IST)');
}

export default runReflection;
