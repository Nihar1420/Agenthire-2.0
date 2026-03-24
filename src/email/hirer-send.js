// src/email/hirer-send.js — controlled, manual hirer-queue send.
// Dashboard-triggered: generates a proposal and sends immediately, BYPASSING the per-track
// daily caps (a human has explicitly approved this one). The global Resend cap in sendEmail
// still applies as a hard safety limit.

import logger from '../utils/logger.js';
import { writeProposal } from '../intelligence/writer.js';
import { sendEmail } from './sender.js';
import {
  getContactById,
  getJobById,
  insertApplication,
  markContactOutreachSent,
  setJobContactLookupStatus,
} from '../db/queries.js';

/**
 * Send outreach for one reviewed hirer-queue contact.
 * @param {number} contactId
 * @returns {Promise<{success:boolean, error?:string, id?:string}>}
 */
export async function sendHirerQueueContact(contactId) {
  const contact = getContactById(contactId);
  if (!contact) return { success: false, error: 'contact not found' };
  if (!contact.email) return { success: false, error: 'contact has no email' };

  // The contact was discovered for a specific job (source_type='job').
  const job = contact.source_type === 'job' && contact.source_id ? getJobById(contact.source_id) : null;
  const proposal = await writeProposal(
    job || { title: `role at ${contact.company || 'your company'}`, company: contact.company, description: '' }
  );

  const result = await sendEmail({ to: contact.email, subject: proposal.subject, text: proposal.body });
  if (result.success) {
    insertApplication({
      type: 'hirer_queue',
      job_id: job ? job.id : null,
      to_email: contact.email,
      company: contact.company,
      subject: proposal.subject,
      body: proposal.body,
      status: 'sent',
    });
    markContactOutreachSent(contactId);
    if (job) setJobContactLookupStatus(job.id, 'outreach_sent');
    logger.info('sendHirerQueueContact: sent', { contactId, to: contact.email });
  } else {
    logger.warn('sendHirerQueueContact: send failed', { contactId, error: result.error });
  }
  return result;
}

export default sendHirerQueueContact;
