// ui/lib/db.js — dashboard data layer.
// Two lazily-opened connections: a READ-ONLY one for all views (safeQuery returns a
// fallback if the DB is missing) and a separate WRITABLE one (WAL) for the few write
// actions (add contact, queue send). The agent.db lives at the repo root's data/ dir.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  // `next start` runs from ./ui, so the DB is one level up.
  const candidates = [join(process.cwd(), '..', 'data', 'agent.db'), join(process.cwd(), 'data', 'agent.db')];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

let _ro = null;
let _rw = null;

export function getDb() {
  if (_ro) return _ro;
  const p = resolveDbPath();
  if (!existsSync(p)) return null;
  _ro = new Database(p, { readonly: true, fileMustExist: true });
  return _ro;
}

export function getWriteDb() {
  if (_rw) return _rw;
  const p = resolveDbPath();
  if (!existsSync(p)) return null;
  _rw = new Database(p);
  _rw.pragma('journal_mode = WAL');
  return _rw;
}

/** Run a read query, returning `fallback` if the DB is absent or the query throws. */
export function safeQuery(fn, fallback) {
  try {
    const db = getDb();
    if (!db) return fallback;
    return fn(db);
  } catch {
    return fallback;
  }
}

// ── Aggregates for the dashboard ──

export function getDashboardStats() {
  return safeQuery((db) => {
    const one = (sql) => db.prepare(sql).get()?.n ?? 0;
    return {
      jobs: one(`SELECT COUNT(*) n FROM jobs`),
      scored: one(`SELECT COUNT(*) n FROM jobs WHERE status='scored' OR score IS NOT NULL`),
      leads: one(`SELECT COUNT(*) n FROM leads`),
      applications: one(`SELECT COUNT(*) n FROM applications`),
      replies: one(`SELECT COUNT(*) n FROM outcomes WHERE type='reply'`),
      sentToday: one(`SELECT COUNT(*) n FROM applications WHERE date(sent_at)=date('now','localtime')`),
    };
  }, { jobs: 0, scored: 0, leads: 0, applications: 0, replies: 0, sentToday: 0 });
}

export function getBySourceCounts() {
  return safeQuery(
    (db) => db.prepare(`SELECT platform AS source, COUNT(*) n FROM jobs GROUP BY platform ORDER BY n DESC`).all(),
    []
  );
}

export function getRecentApplications(limit = 50, offset = 0, status = null) {
  return safeQuery((db) => {
    const where = status ? `WHERE status = @status` : '';
    return db
      .prepare(`SELECT * FROM applications ${where} ORDER BY sent_at DESC LIMIT @limit OFFSET @offset`)
      .all({ status, limit, offset });
  }, []);
}

export function getLeads(limit = 100, source = null) {
  return safeQuery((db) => {
    const where = source ? `WHERE source = @source` : '';
    return db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT @limit`).all({ source, limit });
  }, []);
}

export function getReplies(limit = 50) {
  return safeQuery(
    (db) =>
      db
        .prepare(
          `SELECT o.*, a.company, a.to_email, a.subject FROM outcomes o
           LEFT JOIN applications a ON a.id = o.application_id
           WHERE o.type='reply' ORDER BY o.created_at DESC LIMIT ?`
        )
        .all(limit),
    []
  );
}

export function getLatestCycle() {
  return safeQuery((db) => db.prepare(`SELECT * FROM cycle_logs ORDER BY started_at DESC LIMIT 1`).get(), null);
}

export function getLogTail(limit = 30) {
  // /api/logs does not exist server-side; the dashboard tolerates an empty tail.
  return safeQuery(
    (db) => db.prepare(`SELECT * FROM cycle_logs ORDER BY started_at DESC LIMIT ?`).all(limit),
    []
  );
}

export function getHirerQueue(limit = 100) {
  return safeQuery(
    (db) =>
      db
        .prepare(`SELECT * FROM jobs WHERE needs_contact = 1 ORDER BY score DESC NULLS LAST, created_at DESC LIMIT ?`)
        .all(limit),
    []
  );
}

// ── Write helpers ──

export function addContact({ name, company, email, linkedin_url }) {
  const db = getWriteDb();
  if (!db) return { ok: false, error: 'db unavailable' };
  const info = db
    .prepare(
      `INSERT INTO contacts (source_type, name, company, email, linkedin_url, email_status, status)
       VALUES ('manual', @name, @company, @email, @linkedin_url, @email_status, 'new')`
    )
    .run({ name, company, email: email || null, linkedin_url: linkedin_url || null, email_status: email ? 'verified' : null });
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function requestContactSend(id) {
  const db = getWriteDb();
  if (!db) return { ok: false, error: 'db unavailable' };
  db.prepare(`UPDATE contacts SET send_requested = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  return { ok: true };
}
