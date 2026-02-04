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
  `);

  return d;
}

/** Close the shared connection (used by short-lived scripts / tests). */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
