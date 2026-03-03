// src/email/sequence.js — 3-touch follow-up sequence.
// Touch 1 at day 3, touch 2 at day 7, then the application is marked sequence_complete.
// KNOWN_ACTIVE_STATUSES is the ONLY set we act on, which makes a structurally-impossible
// 4th touch: once an app leaves this set it can never re-enter the sequence. Never throws.

import logger from '../utils/logger.js';
import { humanDelay } from '../utils/delay.js';
import { writeFollowUp } from '../intelligence/writer.js';
import { sendEmail } from './sender.js';
import {
  getActiveApplicationsForSequence,
  incrementFollowupCount,
  updateApplicationStatus,
} from '../db/queries.js';

// Statuses that may still receive a follow-up. 'followup_2'/'replied'/'sequence_complete'
// are deliberately absent — a 4th touch is therefore impossible.
const KNOWN_ACTIVE_STATUSES = new Set(['sent', 'followup_1']);

const DAY_MS = 24 * 3600 * 1000;

function ageDays(sentAt) {
  const t = Date.parse(sentAt);
  if (!t) return 0;
  return (Date.now() - t) / DAY_MS;
}

export async function runSequence() {
  let touched = 0;
  try {
    const apps = getActiveApplicationsForSequence();
    for (const app of apps) {
      if (!app.to_email) continue;
      if (!KNOWN_ACTIVE_STATUSES.has(app.status)) continue; // guard

      const age = ageDays(app.sent_at);

      // Touch 1 — day 3.
      if (app.status === 'sent' && age >= 3) {
        const copy = await writeFollowUp(app, 1);
        const r = await sendEmail({ to: app.to_email, subject: copy.subject, text: copy.body });
        if (r.success) {
          incrementFollowupCount(app.id);
          updateApplicationStatus(app.id, 'followup_1');
          touched += 1;
          await humanDelay(15000, 30000);
        }
        continue;
      }

      // Touch 2 — day 7 — then complete.
      if (app.status === 'followup_1' && age >= 7) {
        const copy = await writeFollowUp(app, 2);
        const r = await sendEmail({ to: app.to_email, subject: copy.subject, text: copy.body });
        if (r.success) {
          incrementFollowupCount(app.id);
          updateApplicationStatus(app.id, 'sequence_complete');
          touched += 1;
          await humanDelay(15000, 30000);
        }
      }
    }
  } catch (err) {
    logger.error('runSequence failed', { error: err.message });
  }
  logger.info('runSequence complete', { touched });
  return { touched };
}

export { KNOWN_ACTIVE_STATUSES };
export default runSequence;
