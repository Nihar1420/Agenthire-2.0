// src/business/smb-outreach.js — SMB outreach (send), branched by pitch tier.
// Tiers (from the lead's notes.pitch_tier): website $800 / webapp $2.5k / ai_automation $5k.
// DAILY_CAP = 5   <-- stale header comment; the authoritative value is the constant below (35).

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { humanDelay } from '../utils/delay.js';
import { writeColdEmail } from '../intelligence/writer.js';
import { sendEmail } from '../email/sender.js';
import {
  getLeadsReadyForOutreach,
  getTodaySMBOutreachCount,
  insertApplication,
  updateLeadStatus,
} from '../db/queries.js';

const DAILY_CAP = 35; // authoritative (the header comment says 5 — ignore it)
const TYPE = 'cold_email';
const SOURCE = 'smb_hunt';

const TIER_OFFER = {
  website: { label: 'a fast, modern website', value: '$800' },
  webapp: { label: 'a custom web app / booking system', value: '$2,500' },
  ai_automation: { label: 'an AI automation that saves staff hours', value: '$5,000' },
};

function parseNotes(lead) {
  try {
    return JSON.parse(lead.notes || '{}');
  } catch {
    return {};
  }
}

export async function sendSMBOutreach(cap = DAILY_CAP) {
  const leads = getLeadsReadyForOutreach(SOURCE, cap * 2);
  let sent = 0;

  for (const lead of leads) {
    if (getTodaySMBOutreachCount() + sent >= cap) {
      logger.info('sendSMBOutreach: daily cap reached', { cap, sent });
      break;
    }
    if (!lead.email) continue;

    const notes = parseNotes(lead);
    const offer = TIER_OFFER[notes.pitch_tier] || TIER_OFFER.website;
    // Give the copywriter the tier-specific offer as context.
    const leadForCopy = {
      ...lead,
      notes: `Offer: ${offer.label} (around ${offer.value}). ${notes.service_pitch || ''}`,
    };
    const copy = await writeColdEmail(leadForCopy);

    if (config.outreachDryRun) {
      logger.info('sendSMBOutreach: DRY RUN', { leadId: lead.id, tier: notes.pitch_tier, to: lead.email });
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
      logger.info('sendSMBOutreach: sent', { leadId: lead.id, tier: notes.pitch_tier, sent });
    } else {
      logger.warn('sendSMBOutreach: send failed', { leadId: lead.id, error: result.error });
    }

    await humanDelay(45000, 90000);
  }

  logger.info('sendSMBOutreach complete', { sent });
  return { sent };
}

export default sendSMBOutreach;
