// src/email/imap-watcher.js — always-on Gmail reply watcher (poll + match).
// Connects to imap.gmail.com:993 via imapflow, polls unseen mail every 3 minutes, and
// matches each sender back to an application (exact recipient first, then the sender's real
// company domain). Reconnect logic and reply handling are added in the next commit.

import { ImapFlow } from 'imapflow';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import {
  findApplicationBySenderEmail,
  findApplicationBySenderDomain,
  updateApplicationStatus,
  insertOutcome,
} from '../db/queries.js';

const POLL_INTERVAL_MS = 3 * 60 * 1000;
const BACKOFF_MIN_MS = 5000;
const BACKOFF_MAX_MS = 60000;

const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
]);

function senderDomain(email) {
  return String(email || '').split('@')[1]?.toLowerCase() || '';
}

function isNoReply(email) {
  return /no-?reply|do-?not-?reply|mailer-daemon|postmaster/i.test(email || '');
}

/** Match a sender address to an application, or null. */
export function matchSenderToApplication(fromEmail) {
  if (!fromEmail || isNoReply(fromEmail)) return null;

  // 1) Exact recipient match.
  const exact = findApplicationBySenderEmail(fromEmail);
  if (exact) return exact;

  // 2) Real company domain match (never freemail).
  const domain = senderDomain(fromEmail);
  if (domain && !FREEMAIL.has(domain)) {
    const byDomain = findApplicationBySenderDomain(domain);
    if (byDomain) return byDomain;
  }
  return null;
}

function makeClient() {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: config.imapUser, pass: config.imapPass },
    logger: false,
  });
}

/** One poll pass: scan unseen messages and match senders to applications. */
export async function pollOnce(client) {
  const lock = await client.getMailboxLock('INBOX');
  const matches = [];
  try {
    for await (const msg of client.fetch({ seen: false }, { envelope: true })) {
      const from = msg.envelope?.from?.[0]?.address;
      const app = matchSenderToApplication(from);
      if (app) {
        matches.push({ app, from, subject: msg.envelope?.subject, uid: msg.uid });
        logger.info('imap: matched reply', { from, appId: app.id });
      }
    }
  } finally {
    lock.release();
  }
  return matches;
}

/** Record a matched reply: flip the application to 'replied' and log an outcome. */
export async function handleMatch(match) {
  updateApplicationStatus(match.app.id, 'replied');
  insertOutcome({
    application_id: match.app.id,
    type: 'reply',
    detail: `From ${match.from}: ${match.subject || ''}`.slice(0, 500),
  });
  logger.info('imap: application marked replied', { appId: match.app.id, company: match.app.company });
}

function isAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  return err?.authenticationFailed || /auth|credential|invalid login|application-specific/.test(m);
}

/**
 * Connect and poll forever. Reconnects with exponential backoff (5s → 60s). A permanent
 * auth failure stops the watcher (retrying would just lock the account).
 */
export async function startWatcher() {
  let backoff = BACKOFF_MIN_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const client = makeClient();
    try {
      await client.connect();
      logger.info('imap: connected, watching INBOX');
      backoff = BACKOFF_MIN_MS; // reset after a good connection

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const matches = await pollOnce(client);
        for (const match of matches) {
          // eslint-disable-next-line no-await-in-loop
          await handleMatch(match);
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    } catch (err) {
      if (isAuthError(err)) {
        logger.error('imap: authentication failed — stopping watcher permanently', {
          error: err.message,
        });
        return;
      }
      logger.warn('imap: connection lost, reconnecting', { backoffMs: backoff, error: err.message });
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
    } finally {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  }
}

export { POLL_INTERVAL_MS, makeClient };
