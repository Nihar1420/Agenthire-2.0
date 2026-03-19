// src/db/schema.js — SQLite connection + schema migration.
// One shared connection (WAL mode, foreign keys on, 5s busy timeout).

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'agent.db');

let db = null;

/** Return the shared DB connection, opening it on first use. */
export function getDb() {
  if (db) return db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Create all core tables if they do not exist. Idempotent. */
export function migrate() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      platform      TEXT NOT NULL,
      url           TEXT UNIQUE,
      title         TEXT,
      company       TEXT,
      description   TEXT,
      apply_email   TEXT,
      score         INTEGER,
      status        TEXT NOT NULL DEFAULT 'new',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      scored_at     TEXT,
      applied_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source              TEXT NOT NULL,
      company             TEXT,
      company_url         TEXT,
      name                TEXT,
      title               TEXT,
      linkedin_url        TEXT,
      email               TEXT,
      email_status        TEXT,
      score               INTEGER,
      status              TEXT NOT NULL DEFAULT 'new',
      notes               TEXT,
      ready_for_outreach  INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT
    );

    CREATE TABLE IF NOT EXISTS applications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      type            TEXT NOT NULL,
      job_id          INTEGER REFERENCES jobs(id),
      lead_id         INTEGER REFERENCES leads(id),
      to_email        TEXT,
      company         TEXT,
      subject         TEXT,
      body            TEXT,
      status          TEXT NOT NULL DEFAULT 'sent',
      followup_count  INTEGER NOT NULL DEFAULT 0,
      sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id  INTEGER REFERENCES applications(id),
      type            TEXT NOT NULL,
      detail          TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_patterns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      domain      TEXT UNIQUE NOT NULL,
      pattern     TEXT NOT NULL,
      verified    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS learnings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cycle_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT,
      status          TEXT NOT NULL DEFAULT 'running',
      jobs_found      INTEGER NOT NULL DEFAULT 0,
      leads_found     INTEGER NOT NULL DEFAULT 0,
      jobs_scored     INTEGER NOT NULL DEFAULT 0,
      emails_found    INTEGER NOT NULL DEFAULT 0,
      proposals_sent  INTEGER NOT NULL DEFAULT 0,
      errors          TEXT
    );

    -- Indexes for the hot query paths (scoring, applying, dedup, analytics).
    CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_platform  ON jobs(platform);
    CREATE INDEX IF NOT EXISTS idx_jobs_score     ON jobs(score);
    CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_source   ON leads(source);
    CREATE INDEX IF NOT EXISTS idx_leads_email    ON leads(email_status);
    CREATE INDEX IF NOT EXISTS idx_apps_status    ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_apps_type      ON applications(type);
    CREATE INDEX IF NOT EXISTS idx_apps_sent_at   ON applications(sent_at);
    CREATE INDEX IF NOT EXISTS idx_patterns_domain ON email_patterns(domain);

    CREATE TABLE IF NOT EXISTS contacts (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type               TEXT,
      source_id                 INTEGER,
      name                      TEXT,
      company                   TEXT,
      linkedin_url              TEXT,
      email                     TEXT,
      email_status              TEXT,
      status                    TEXT NOT NULL DEFAULT 'new',
      send_requested            INTEGER NOT NULL DEFAULT 0,
      track                     TEXT,
      verification_submitted_at TEXT,
      created_at                TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_status       ON contacts(status);
    CREATE INDEX IF NOT EXISTS idx_contacts_email_status ON contacts(email_status);
    CREATE INDEX IF NOT EXISTS idx_contacts_send_req     ON contacts(send_requested);
    CREATE INDEX IF NOT EXISTS idx_contacts_track        ON contacts(track);

    CREATE TABLE IF NOT EXISTS business_ideas (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      type             TEXT,
      geography        TEXT,
      digital_gap      TEXT,
      service_pitch    TEXT,
      estimated_value  INTEGER,
      keywords         TEXT,
      status           TEXT NOT NULL DEFAULT 'active',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_business_ideas_status ON business_ideas(status);
  `);

  // ── Idempotent column additions (hirer queue) ──
  addColumnIfMissing(d, 'jobs', 'needs_contact', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(d, 'jobs', 'location', 'TEXT');
  addColumnIfMissing(d, 'jobs', 'contact_lookup_status', 'TEXT');

  // Backfill: rows routed as 'needs_contact' (before the column existed) get the flag set.
  d.prepare(`UPDATE jobs SET needs_contact = 1 WHERE status = 'needs_contact' AND needs_contact = 0`).run();

  return d;
}

/** ADD COLUMN only when it doesn't already exist (SQLite has no IF NOT EXISTS for columns). */
function addColumnIfMissing(d, table, column, definition) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Close the shared connection (used by short-lived scripts / tests). */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
