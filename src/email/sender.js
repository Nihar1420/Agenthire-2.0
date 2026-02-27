// src/email/sender.js — outbound email via Resend.
// sendEmail() NEVER throws — it returns { success, id?, error? }. A global daily cap of 90
// (under Resend's 100/day free limit) sits above every per-track cap. All mail is sent
// as plain text from the configured SENDING_DOMAIN.

import { Resend } from 'resend';
import config from '../core/config.js';
import logger from '../utils/logger.js';
import { getTodayTotalSendCount } from '../db/queries.js';

const GLOBAL_DAILY_SEND_CAP = 90;

let _resend = null;
function client() {
  if (_resend) return _resend;
  _resend = new Resend(config.resendApiKey);
  return _resend;
}

/** The verified From address, always on SENDING_DOMAIN. */
function fromAddress() {
  return `AgentHire <outreach@${config.sendingDomain}>`;
}

/**
 * Send one plain-text email. Never throws.
 * @param {{to:string, subject:string, text:string, bcc?:string, from?:string}} opts
 * @returns {Promise<{success:boolean, id?:string, error?:string}>}
 */
export async function sendEmail({ to, subject, text, bcc, from } = {}) {
  try {
    if (!to || !subject || !text) {
      return { success: false, error: 'missing to/subject/text' };
    }

    const sentToday = getTodayTotalSendCount();
    if (sentToday >= GLOBAL_DAILY_SEND_CAP) {
      logger.warn('sendEmail: global daily cap reached', { cap: GLOBAL_DAILY_SEND_CAP, sentToday });
      return { success: false, error: 'global daily send cap reached' };
    }

    const payload = {
      from: from || fromAddress(),
      to: Array.isArray(to) ? to : [to],
      subject,
      text, // plain-text only
    };
    const bccAddr = bcc || config.bccEmail;
    if (bccAddr) payload.bcc = [bccAddr];

    const { data, error } = await client().emails.send(payload);
    if (error) {
      logger.warn('sendEmail: Resend error', { error: error.message || String(error) });
      return { success: false, error: error.message || String(error) };
    }
    logger.info('sendEmail: sent', { to, id: data?.id });
    return { success: true, id: data?.id };
  } catch (err) {
    logger.error('sendEmail: unexpected error', { error: err.message });
    return { success: false, error: err.message };
  }
}

export { GLOBAL_DAILY_SEND_CAP };
export default sendEmail;
