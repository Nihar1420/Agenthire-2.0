// src/notify/digest.js — daily digest email.
// Builds a plain-text 24h report from getLast24HourStats and emails it to PERSONAL_EMAIL.
// startDigestScheduler() runs it daily at 08:00 IST. Run `node src/notify/digest.js --once`
// to send immediately. (getLast24HourStats lands in a later commit; imported lazily.)

import cron from 'node-cron';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { sendEmail } from '../email/sender.js';

const TZ = 'Asia/Kolkata';

async function getStats() {
  try {
    const q = await import('../db/queries.js');
    if (typeof q.getLast24HourStats === 'function') return q.getLast24HourStats();
  } catch {
    /* fall through */
  }
  return {};
}

function renderReport(stats) {
  const line = (label, val) => `${label.padEnd(26)} ${val ?? 0}`;
  return [
    'AgentHire — last 24 hours',
    '='.repeat(32),
    line('Jobs found', stats.jobs_found),
    line('Jobs scored', stats.jobs_scored),
    line('Leads found', stats.leads_found),
    line('Emails found', stats.emails_found),
    line('Applications sent', stats.applications_sent),
    line('Cold emails sent', stats.cold_emails_sent),
    line('Replies received', stats.replies),
    '',
    `Generated ${new Date().toISOString()}`,
  ].join('\n');
}

export async function sendDailyDigest() {
  const to = config.personalEmail;
  if (!to) {
    logger.warn('sendDailyDigest: PERSONAL_EMAIL not set, skipping');
    return { success: false, skipped: true };
  }
  const stats = await getStats();
  const text = renderReport(stats);
  const result = await sendEmail({ to, subject: 'AgentHire daily digest', text });
  logger.info('sendDailyDigest sent', { to, success: result.success });
  return result;
}

export function startDigestScheduler() {
  cron.schedule('0 8 * * *', () => sendDailyDigest().catch((e) => logger.error('digest cron failed', { error: e.message })), {
    timezone: TZ,
  });
  logger.info('digest scheduler started (0 8 * * * IST)');
}

// Direct-run support: `node src/notify/digest.js --once`
if (process.argv[1] && process.argv[1].endsWith('digest.js') && process.argv.includes('--once')) {
  sendDailyDigest()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default sendDailyDigest;
