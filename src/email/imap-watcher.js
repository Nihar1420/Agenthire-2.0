// src/email/imap-watcher.js — always-on Gmail reply watcher (poll + match).
// Connects to imap.gmail.com:993 via imapflow, polls unseen mail every 3 minutes, and
// matches each sender back to an application (exact recipient first, then the sender's real
// company domain). Reconnect logic and reply handling are added in the next commit.

import { ImapFlow } from 'imapflow';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { findApplicationBySenderEmail, findApplicationBySenderDomain } from '../db/queries.js';

const POLL_INTERVAL_MS = 3 * 60 * 1000;

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

export { POLL_INTERVAL_MS, makeClient };
