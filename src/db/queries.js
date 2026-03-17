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

export function leadExistsByCompanySource(company, source) {
  if (!company) return false;
  return !!stmt(`SELECT 1 FROM leads WHERE lower(company) = lower(?) AND source = ? LIMIT 1`).get(company, source);
}

/** High-scoring jobs that lack a direct apply email — candidates for company outreach. */
export function getHighScoreJobsWithoutApplyEmail(minScore, limit = 25) {
  return stmt(`
    SELECT DISTINCT company, url, score FROM jobs
    WHERE score >= ? AND (apply_email IS NULL OR apply_email = '') AND company IS NOT NULL
    ORDER BY score DESC
    LIMIT ?
  `).all(minScore, limit);
}

/** Distinct company names seen on the Remotive feed. */
export function getRemotiveCompanies(limit = 25) {
  return stmt(`
    SELECT DISTINCT company FROM jobs
    WHERE platform = 'remotive' AND company IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
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

/**
 * Today's dev-track cold emails (leads sourced from company_hunt / wellfound).
 * Applications not linked to a lead count as dev (contacts/one-offs default here).
 */
export function getTodayDevOutreachCount() {
  const row = stmt(`
    SELECT COUNT(*) AS n FROM applications a
    LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type = 'cold_email'
      AND date(a.sent_at) = date('now', 'localtime')
      AND (l.source IS NULL OR l.source != 'smb_hunt')
  `).get();
  return row ? row.n : 0;
}

/** Today's SMB-track cold emails (leads sourced from smb_hunt). */
export function getTodaySMBOutreachCount() {
  const row = stmt(`
    SELECT COUNT(*) AS n FROM applications a
    JOIN leads l ON l.id = a.lead_id
    WHERE a.type = 'cold_email'
      AND date(a.sent_at) = date('now', 'localtime')
      AND l.source = 'smb_hunt'
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

// ─────────────────────────────────────────────────────────
// HIRER QUEUE (jobs needing a contact lookup)
// ─────────────────────────────────────────────────────────

/** Jobs flagged as needing a decision-maker contact, best-scored first. */
export function getHirerQueueJobs(limit = 50) {
  return stmt(`
    SELECT * FROM jobs
    WHERE needs_contact = 1
      AND (contact_lookup_status IS NULL OR contact_lookup_status NOT IN ('outreach_sent'))
    ORDER BY score DESC NULLS LAST, created_at DESC
    LIMIT ?
  `).all(limit);
}

/** Jobs still awaiting a contact lookup (not yet attempted). */
export function getJobsNeedingContactLookup(limit = 25) {
  return stmt(`
    SELECT * FROM jobs
    WHERE needs_contact = 1 AND contact_lookup_status IS NULL
    ORDER BY score DESC NULLS LAST
    LIMIT ?
  `).all(limit);
}

export function setJobContactLookupStatus(id, status) {
  return stmt(`UPDATE jobs SET contact_lookup_status = ? WHERE id = ?`).run(status, id);
}

export function setJobNeedsContact(id, flag = 1) {
  return stmt(`UPDATE jobs SET needs_contact = ? WHERE id = ?`).run(flag ? 1 : 0, id);
}

// ─────────────────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────────────────

export function insertContact(c) {
  const info = stmt(`
    INSERT INTO contacts (source_type, source_id, name, company, linkedin_url, email,
                          email_status, status, send_requested, track)
    VALUES (@source_type, @source_id, @name, @company, @linkedin_url, @email,
            @email_status, @status, @send_requested, @track)
  `).run({
    source_type: c.source_type ?? null,
    source_id: c.source_id ?? null,
    name: c.name ?? null,
    company: c.company ?? null,
    linkedin_url: c.linkedin_url ?? null,
    email: c.email ?? null,
    email_status: c.email_status ?? null,
    status: c.status ?? 'new',
    send_requested: c.send_requested ? 1 : 0,
    track: c.track ?? null,
  });
  return { id: Number(info.lastInsertRowid) };
}

export function getContactById(id) {
  return stmt(`SELECT * FROM contacts WHERE id = ?`).get(id);
}

export function contactExistsByLinkedIn(url) {
  if (!url) return false;
  return !!stmt(`SELECT 1 FROM contacts WHERE linkedin_url = ? LIMIT 1`).get(url);
}

export function getContactsWithoutEmail(limit = 25) {
  return stmt(`
    SELECT * FROM contacts
    WHERE (email IS NULL OR email = '')
      AND status NOT IN ('email_not_found', 'unverifiable')
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

/** Contacts by email verification state (guessed / verifying / verified / ...). */
export function getContactsByEmailStatus(status, limit = 100) {
  return stmt(`SELECT * FROM contacts WHERE email_status = ? ORDER BY created_at ASC LIMIT ?`).all(status, limit);
}

export function updateContactEmail(id, email, emailStatus) {
  return stmt(`
    UPDATE contacts SET email = COALESCE(?, email), email_status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(email, emailStatus, id);
}

export function updateContactEmailStatus(id, emailStatus) {
  return stmt(`UPDATE contacts SET email_status = ?, updated_at = datetime('now') WHERE id = ?`).run(emailStatus, id);
}

/** Mark a guessed contact as submitted for verification (guessed → verifying). */
export function markContactVerifying(id) {
  return stmt(`
    UPDATE contacts
    SET email_status = 'verifying', verification_submitted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

export function updateContactStatus(id, status) {
  return stmt(`UPDATE contacts SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
}

/** Contacts a user has queued for sending (send_requested = 1). */
export function getSendRequestedContacts(limit = 50) {
  return stmt(`
    SELECT * FROM contacts
    WHERE send_requested = 1 AND status NOT IN ('outreach_sent')
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function setContactSendRequested(id, flag = 1) {
  return stmt(`UPDATE contacts SET send_requested = ?, updated_at = datetime('now') WHERE id = ?`).run(
    flag ? 1 : 0,
    id
  );
}

/** Contacts with a usable email, ready for outreach on a given track. */
export function getContactsReadyForOutreach(limit = 50) {
  return stmt(`
    SELECT * FROM contacts
    WHERE email IS NOT NULL AND email != ''
      AND email_status IN ('verified', 'guessed')
      AND status NOT IN ('outreach_sent')
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

// ─────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────

/** Rolling 24-hour counts for the daily digest. */
export function getLast24HourStats() {
  const since = `datetime('now', '-1 day')`;
  const one = (sql, ...args) => (stmt(sql).get(...args)?.n ?? 0);
  return {
    jobs_found: one(`SELECT COUNT(*) n FROM jobs WHERE created_at >= ${since}`),
    jobs_scored: one(`SELECT COUNT(*) n FROM jobs WHERE scored_at >= ${since}`),
    leads_found: one(`SELECT COUNT(*) n FROM leads WHERE created_at >= ${since}`),
    emails_found: one(
      `SELECT COUNT(*) n FROM leads WHERE email IS NOT NULL AND email != '' AND updated_at >= ${since}`
    ),
    applications_sent: one(
      `SELECT COUNT(*) n FROM applications WHERE type IN ('upwork_apply','email_apply') AND sent_at >= ${since}`
    ),
    cold_emails_sent: one(`SELECT COUNT(*) n FROM applications WHERE type='cold_email' AND sent_at >= ${since}`),
    replies: one(`SELECT COUNT(*) n FROM outcomes WHERE type='reply' AND created_at >= ${since}`),
  };
}

/** All-time headline counters. */
export function getAllTimeStats() {
  const one = (sql) => (stmt(sql).get()?.n ?? 0);
  return {
    jobs: one(`SELECT COUNT(*) n FROM jobs`),
    leads: one(`SELECT COUNT(*) n FROM leads`),
    applications: one(`SELECT COUNT(*) n FROM applications`),
    replies: one(`SELECT COUNT(*) n FROM outcomes WHERE type='reply'`),
  };
}

/**
 * Data for the weekly reflector: applications from the last 28 days joined to their job
 * (for platform) plus reply status, with body length and send hour for correlation.
 */
export function getReflectionData() {
  return stmt(`
    SELECT
      a.id,
      a.type,
      a.company,
      a.status,
      length(a.body) AS body_len,
      CAST(strftime('%H', a.sent_at) AS INTEGER) AS send_hour,
      j.platform AS platform,
      CASE WHEN a.status = 'replied' THEN 1 ELSE 0 END AS replied
    FROM applications a
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.sent_at >= datetime('now', '-28 days')
  `).all();
}

/** Test/maintenance hook: drop the prepared-statement cache. */
export function _resetStmtCache() {
  _cache.clear();
}
