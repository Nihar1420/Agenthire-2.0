// src/leads/outreach.js — developer outreach track (send).
// Sends cold emails to enriched company_hunt leads via writeColdEmail + sendEmail.
// Respects a daily cap (default 10, re-checked mid-loop), supports dry-run, 30–60s delays.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { humanDelay } from '../utils/delay.js';
import { writeColdEmail } from '../intelligence/writer.js';
import { sendEmail } from '../email/sender.js';
import {
  getLeadsReadyForOutreach,
  getTodayApplicationCountByType,
  insertApplication,
  updateLeadStatus,
} from '../db/queries.js';

const TYPE = 'cold_email';
const SOURCE = 'company_hunt';

/** Count today's dev-track cold emails (overridden by the source-split counter in a later commit). */
function devSentToday() {
  return getTodayApplicationCountByType(TYPE);
}

export async function sendOutreachEmails(cap = config.devOutreachDailyCap) {
  const leads = getLeadsReadyForOutreach(SOURCE, cap * 2);
  let sent = 0;

  for (const lead of leads) {
    // Re-check the cap mid-loop.
    if (devSentToday() + sent >= cap) {
      logger.info('sendOutreachEmails: daily cap reached', { cap, sent });
      break;
    }
    if (!lead.email) continue;

    const copy = await writeColdEmail(lead);

    if (config.outreachDryRun) {
      logger.info('sendOutreachEmails: DRY RUN', { leadId: lead.id, to: lead.email });
      updateLeadStatus(lead.id, 'outreach_sent');
      sent += 1;
      continue;
    }

    const result = await sendEmail({ to: lead.email, subject: copy.subject, text: copy.body });
    if (result.success) {
      insertApplication({
        type: TYPE,
        lead_id: lead.id,
        to_email: lead.email,
        company: lead.company,
        subject: copy.subject,
        body: copy.body,
        status: 'sent',
      });
      updateLeadStatus(lead.id, 'outreach_sent');
      sent += 1;
      logger.info('sendOutreachEmails: sent', { leadId: lead.id, to: lead.email, sent });
    } else {
      logger.warn('sendOutreachEmails: send failed', { leadId: lead.id, error: result.error });
    }

    await humanDelay(30000, 60000);
  }

  logger.info('sendOutreachEmails complete', { sent });
  return { sent };
}

export default sendOutreachEmails;
