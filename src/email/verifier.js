// src/email/verifier.js — two-phase Snov.io verification for guessed contact emails.
// Phase A: collect results of previously-submitted verifications (valid → verified,
// invalid → email_not_found, stuck > 24h → unverifiable).
// Phase B: submit a new daily-capped batch of guessed emails and mark them 'verifying'.
// Never throws. The contacts DB layer is imported lazily (it lands in a later phase).

import config from '../core/config.js';
import logger from '../utils/logger.js';

const DAILY_VERIFY_CAP = 100;
const STUCK_HOURS = 24;

let _token = null;
let _tokenExp = 0;
async function snovToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  if (!config.snovClientId || !config.snovClientSecret) return null;
  try {
    const res = await fetch('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: config.snovClientId,
        client_secret: config.snovClientSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    _token = data.access_token;
    _tokenExp = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3000_000) - 60_000;
    return _token;
  } catch {
    return null;
  }
}

async function submitForVerification(token, email) {
  try {
    const res = await fetch('https://api.snov.io/v1/get-emails-verification-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, emails: [email] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkVerification(token, email) {
  try {
    const res = await fetch(
      `https://api.snov.io/v1/get-emails-verification-status?access_token=${encodeURIComponent(
        token
      )}&emails[]=${encodeURIComponent(email)}`
    );
    if (!res.ok) return 'pending';
    const data = await res.json();
    const row = Array.isArray(data?.data) ? data.data[0] : data?.data?.[email] || null;
    const result = (row?.result || row?.smtp_status || '').toLowerCase();
    if (/valid/.test(result) && !/invalid/.test(result)) return 'valid';
    if (/invalid|not_valid|do_not_mail/.test(result)) return 'invalid';
    return 'pending';
  } catch {
    return 'pending';
  }
}

export async function verifyGuessedContacts() {
  const q = await import('../db/queries.js');
  if (typeof q.getContactsByEmailStatus !== 'function') {
    logger.debug('verifyGuessedContacts: contacts layer not available yet');
    return { verified: 0, rejected: 0, submitted: 0 };
  }
  const token = await snovToken();
  if (!token) {
    logger.warn('verifyGuessedContacts: no Snov token');
    return { verified: 0, rejected: 0, submitted: 0 };
  }

  let verified = 0;
  let rejected = 0;
  let submitted = 0;

  // ── Phase A: collect in-flight results ──
  const inFlight = q.getContactsByEmailStatus('verifying');
  for (const c of inFlight) {
    const status = await checkVerification(token, c.email);
    if (status === 'valid') {
      q.updateContactEmailStatus(c.id, 'verified');
      verified += 1;
    } else if (status === 'invalid') {
      q.updateContactEmailStatus(c.id, 'email_not_found');
      rejected += 1;
    } else {
      const submittedAt = c.verification_submitted_at ? Date.parse(c.verification_submitted_at) : 0;
      if (submittedAt && Date.now() - submittedAt > STUCK_HOURS * 3600_000) {
        q.updateContactEmailStatus(c.id, 'unverifiable');
      }
    }
  }

  // ── Phase B: submit a new daily-capped batch ──
  const guessed = q.getContactsByEmailStatus('guessed');
  for (const c of guessed) {
    if (submitted >= DAILY_VERIFY_CAP) break;
    if (!c.email) continue;
    const ok = await submitForVerification(token, c.email);
    if (ok) {
      q.markContactVerifying(c.id);
      submitted += 1;
    }
  }

  logger.info('verifyGuessedContacts complete', { verified, rejected, submitted });
  return { verified, rejected, submitted };
}

export default verifyGuessedContacts;
