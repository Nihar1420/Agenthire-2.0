// src/db/queries.js — prepared-statement helpers.
// Statements are prepared lazily and cached per SQL string on the shared connection.

import { getDb } from './schema.js';

const _cache = new Map();

/** Prepare-and-cache a statement for the shared connection. */
function stmt(sql) {
  if (_cache.has(sql)) return _cache.get(sql);
  const prepared = getDb().prepare(sql);
  _cache.set(sql, prepared);
  return prepared;
}

// ─────────────────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────────────────

/**
 * Insert a job, deduping by URL (INSERT OR IGNORE on the UNIQUE url).
 * @returns {{inserted: boolean, id: number|null}}
 */
export function insertJob(job) {
  const info = stmt(`
    INSERT OR IGNORE INTO jobs (platform, url, title, company, description, apply_email, status)
    VALUES (@platform, @url, @title, @company, @description, @apply_email, @status)
  `).run({
    platform: job.platform,
    url: job.url ?? null,
    title: job.title ?? null,
    company: job.company ?? null,
    description: job.description ?? null,
    apply_email: job.apply_email ?? null,
    status: job.status ?? 'new',
  });
  return { inserted: info.changes > 0, id: info.changes > 0 ? Number(info.lastInsertRowid) : null };
}

export function jobExistsByUrl(url) {
  if (!url) return false;
  return !!stmt(`SELECT 1 FROM jobs WHERE url = ? LIMIT 1`).get(url);
}

export function getJobById(id) {
  return stmt(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

/** Jobs that still need scoring (never scored). */
export function getUnscoredJobs(limit = 50) {
  return stmt(`
    SELECT * FROM jobs
    WHERE score IS NULL AND status IN ('new', 'needs_contact')
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

export function updateJobScore(id, score) {
  return stmt(`
    UPDATE jobs SET score = ?, status = 'scored', scored_at = datetime('now')
    WHERE id = ?
  `).run(score, id);
}

export function updateJobStatus(id, status) {
  return stmt(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, id);
}

export function markJobApplied(id) {
  return stmt(`
    UPDATE jobs SET status = 'applied', applied_at = datetime('now') WHERE id = ?
  `).run(id);
}

/** Scored, eligible jobs for a platform at/above a score threshold, best first. */
export function getScoredJobsForPlatform(platform, minScore) {
  return stmt(`
    SELECT * FROM jobs
    WHERE platform = ? AND status = 'scored' AND score >= ?
    ORDER BY score DESC
  `).all(platform, minScore);
}

/** Test/maintenance hook: drop the prepared-statement cache. */
export function _resetStmtCache() {
  _cache.clear();
}
