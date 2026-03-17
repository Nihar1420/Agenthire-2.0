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
  getTodayDevOutreachCount,
  insertApplication,
  updateLeadStatus,
  getContactsReadyForOutreach,
  getContactById,
  updateContactStatus,
  getSendRequestedContacts,
  setContactSendRequested,
} from '../db/queries.js';

const TYPE = 'cold_email';
const SOURCE = 'company_hunt';

/** Count today's dev-track cold emails (source-split, excludes SMB). */
function devSentToday() {
  return getTodayDevOutreachCount();
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

/** Send one cold email to a contact. Shared by the batch + single-send paths. */
async function sendToContact(contact) {
  if (!contact?.email) return { success: false, error: 'no email' };
  const copy = await writeColdEmail(contact);
  if (config.outreachDryRun) {
    updateContactStatus(contact.id, 'outreach_sent');
    return { success: true, dryRun: true };
  }
  const result = await sendEmail({ to: contact.email, subject: copy.subject, text: copy.body });
  if (result.success) {
    insertApplication({
      type: TYPE,
      to_email: contact.email,
      company: contact.company,
      subject: copy.subject,
      body: copy.body,
      status: 'sent',
    });
    updateContactStatus(contact.id, 'outreach_sent');
  }
  return result;
}

/** Batch outreach to user-added contacts. Cap default 50, re-checked mid-loop. */
export async function sendContactOutreach(cap = config.contactOutreachDailyCap) {
  const contacts = getContactsReadyForOutreach(cap * 2);
  let sent = 0;
  for (const contact of contacts) {
    if (getTodayApplicationCountByType(TYPE) + sent >= config.globalDailySendCap) break;
    if (sent >= cap) {
      logger.info('sendContactOutreach: cap reached', { cap, sent });
      break;
    }
    const r = await sendToContact(contact);
    if (r.success) {
      sent += 1;
      await humanDelay(30000, 60000);
    }
  }
  logger.info('sendContactOutreach complete', { sent });
  return { sent };
}

/** Drain the send-request queue: contacts a user explicitly flagged (send_requested=1). */
export async function processSendRequests(limit = 25) {
  const contacts = getSendRequestedContacts(limit);
  let sent = 0;
  for (const contact of contacts) {
    const r = await sendToContact(contact);
    setContactSendRequested(contact.id, 0); // clear the request regardless of outcome
    if (r.success) {
      sent += 1;
      await humanDelay(20000, 45000);
    }
  }
  logger.info('processSendRequests complete', { sent, considered: contacts.length });
  return { sent };
}

/** Dashboard one-off: send to a single contact by id immediately. */
export async function sendSingleContact(contactId) {
  const contact = getContactById(contactId);
  if (!contact) return { success: false, error: 'contact not found' };
  const r = await sendToContact(contact);
  logger.info('sendSingleContact', { contactId, success: r.success });
  return r;
}

export default sendOutreachEmails;
