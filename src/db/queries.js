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

/** Backfill / update the apply_email for a job (used by feeds that parse addresses late). */
export function setJobApplyEmail(id, email) {
  return stmt(`UPDATE jobs SET apply_email = ? WHERE id = ?`).run(email, id);
}

/** Scored jobs that carry a direct apply email, at/above a score threshold, best first. */
export function getJobsWithApplyEmail(minScore, limit = 50) {
  return stmt(`
    SELECT * FROM jobs
    WHERE apply_email IS NOT NULL AND apply_email != ''
      AND status = 'scored' AND score >= ?
    ORDER BY score DESC
    LIMIT ?
  `).all(minScore, limit);
}

// ─────────────────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────────────────

export function insertLead(lead) {
  const info = stmt(`
    INSERT INTO leads (source, company, company_url, name, title, linkedin_url, email,
                       email_status, score, status, notes)
    VALUES (@source, @company, @company_url, @name, @title, @linkedin_url, @email,
            @email_status, @score, @status, @notes)
  `).run({
    source: lead.source,
    company: lead.company ?? null,
    company_url: lead.company_url ?? null,
    name: lead.name ?? null,
    title: lead.title ?? null,
    linkedin_url: lead.linkedin_url ?? null,
    email: lead.email ?? null,
    email_status: lead.email_status ?? null,
    score: lead.score ?? null,
    status: lead.status ?? 'new',
    notes: lead.notes ?? null,
  });
  return { inserted: info.changes > 0, id: Number(info.lastInsertRowid) };
}

export function getLeadById(id) {
  return stmt(`SELECT * FROM leads WHERE id = ?`).get(id);
}

export function leadExistsByLinkedIn(url) {
  if (!url) return false;
  return !!stmt(`SELECT 1 FROM leads WHERE linkedin_url = ? LIMIT 1`).get(url);
}

export function getLeadsWithoutEmail(limit = 50) {
  return stmt(`
    SELECT * FROM leads
    WHERE (email IS NULL OR email = '') AND status NOT IN ('email_not_found', 'no_email')
    ORDER BY score DESC, created_at ASC
    LIMIT ?
  `).all(limit);
}

export function getLeadsReadyForOutreach(source, limit = 50) {
  return stmt(`
    SELECT * FROM leads
    WHERE ready_for_outreach = 1 AND status = 'ready_for_outreach' AND source = ?
    ORDER BY score DESC
    LIMIT ?
  `).all(source, limit);
}

export function updateLeadEnrichment(id, fields) {
  return stmt(`
    UPDATE leads
    SET name = COALESCE(@name, name),
        title = COALESCE(@title, title),
        email = COALESCE(@email, email),
        email_status = COALESCE(@email_status, email_status),
        linkedin_url = COALESCE(@linkedin_url, linkedin_url),
        status = COALESCE(@status, status),
        ready_for_outreach = COALESCE(@ready_for_outreach, ready_for_outreach),
        updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id,
    name: fields.name ?? null,
    title: fields.title ?? null,
    email: fields.email ?? null,
    email_status: fields.email_status ?? null,
    linkedin_url: fields.linkedin_url ?? null,
    status: fields.status ?? null,
    ready_for_outreach: fields.ready_for_outreach ?? null,
  });
}

export function updateLeadStatus(id, status) {
  return stmt(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
}

// ─────────────────────────────────────────────────────────
// APPLICATIONS
// ─────────────────────────────────────────────────────────

export function insertApplication(app) {
  const info = stmt(`
    INSERT INTO applications (type, job_id, lead_id, to_email, company, subject, body, status)
    VALUES (@type, @job_id, @lead_id, @to_email, @company, @subject, @body, @status)
  `).run({
    type: app.type,
    job_id: app.job_id ?? null,
    lead_id: app.lead_id ?? null,
    to_email: app.to_email ?? null,
    company: app.company ?? null,
    subject: app.subject ?? null,
    body: app.body ?? null,
    status: app.status ?? 'sent',
  });
  return { id: Number(info.lastInsertRowid) };
}

export function updateApplicationStatus(id, status) {
  return stmt(`UPDATE applications SET status = ? WHERE id = ?`).run(status, id);
}

export function incrementFollowupCount(id) {
  return stmt(`UPDATE applications SET followup_count = followup_count + 1 WHERE id = ?`).run(id);
}

export function findApplicationBySenderEmail(email) {
  return stmt(`
    SELECT * FROM applications WHERE lower(to_email) = lower(?) ORDER BY sent_at DESC LIMIT 1
  `).get(email);
}

/** Total emails/applications sent today (local date) — feeds the global send cap. */
export function getTodayTotalSendCount() {
  const row = stmt(`
    SELECT COUNT(*) AS n FROM applications
    WHERE date(sent_at) = date('now', 'localtime')
  `).get();
  return row ? row.n : 0;
}

/** Count applications of a given type sent today (local date), for daily-cap checks. */
export function getTodayApplicationCountByType(type) {
  const row = stmt(`
    SELECT COUNT(*) AS n FROM applications
    WHERE type = ? AND date(sent_at) = date('now', 'localtime')
  `).get(type);
  return row ? row.n : 0;
}

/** Most recent application whose recipient shares the given (real company) domain. */
export function findApplicationBySenderDomain(domain) {
  return stmt(`
    SELECT * FROM applications
    WHERE to_email LIKE '%@' || ? ORDER BY sent_at DESC LIMIT 1
  `).get(domain);
}

export function getActiveApplicationsForSequence() {
  return stmt(`
    SELECT * FROM applications
    WHERE type IN ('cold_email', 'email_apply') AND status IN ('sent', 'followup_1')
    ORDER BY sent_at ASC
  `).all();
}

// ─────────────────────────────────────────────────────────
// OUTCOMES
// ─────────────────────────────────────────────────────────

export function insertOutcome(outcome) {
  const info = stmt(`
    INSERT INTO outcomes (application_id, type, detail) VALUES (?, ?, ?)
  `).run(outcome.application_id ?? null, outcome.type, outcome.detail ?? null);
  return { id: Number(info.lastInsertRowid) };
}

// ─────────────────────────────────────────────────────────
// EMAIL PATTERNS (learned {first}.{last} etc. per domain)
// ─────────────────────────────────────────────────────────

export function getEmailPattern(domain) {
  return stmt(`SELECT * FROM email_patterns WHERE domain = ?`).get(domain);
}

export function saveEmailPattern(domain, pattern, verified = 1) {
  return stmt(`
    INSERT INTO email_patterns (domain, pattern, verified) VALUES (?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET pattern = excluded.pattern, verified = excluded.verified
  `).run(domain, pattern, verified ? 1 : 0);
}

// ─────────────────────────────────────────────────────────
// LEARNINGS
// ─────────────────────────────────────────────────────────

export function insertLearning(content) {
  const info = stmt(`INSERT INTO learnings (content) VALUES (?)`).run(content);
  return { id: Number(info.lastInsertRowid) };
}

export function getRecentLearnings(limit = 5) {
  return stmt(`SELECT * FROM learnings ORDER BY created_at DESC LIMIT ?`).all(limit);
}

// ─────────────────────────────────────────────────────────
// CYCLE LOGS
// ─────────────────────────────────────────────────────────

export function insertCycleLog() {
  const info = stmt(`INSERT INTO cycle_logs (status) VALUES ('running')`).run();
  return Number(info.lastInsertRowid);
}

export function updateCycleLog(id, fields) {
  return stmt(`
    UPDATE cycle_logs
    SET finished_at = COALESCE(@finished_at, finished_at),
        status = COALESCE(@status, status),
        jobs_found = COALESCE(@jobs_found, jobs_found),
        leads_found = COALESCE(@leads_found, leads_found),
        jobs_scored = COALESCE(@jobs_scored, jobs_scored),
        emails_found = COALESCE(@emails_found, emails_found),
        proposals_sent = COALESCE(@proposals_sent, proposals_sent),
        errors = COALESCE(@errors, errors)
    WHERE id = @id
  `).run({
    id,
    finished_at: fields.finished_at ?? null,
    status: fields.status ?? null,
    jobs_found: fields.jobs_found ?? null,
    leads_found: fields.leads_found ?? null,
    jobs_scored: fields.jobs_scored ?? null,
    emails_found: fields.emails_found ?? null,
    proposals_sent: fields.proposals_sent ?? null,
    errors: fields.errors ?? null,
  });
}

/** Test/maintenance hook: drop the prepared-statement cache. */
export function _resetStmtCache() {
  _cache.clear();
}
