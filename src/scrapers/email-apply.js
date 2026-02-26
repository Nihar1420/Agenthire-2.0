// src/scrapers/email-apply.js — direct email-apply track.
// For scored jobs (≥75) that carry a direct apply_email, generate a proposal and email it.
// DAILY_CAP is the authoritative value (15); a stale header comment elsewhere may say 5.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { humanDelay } from '../utils/delay.js';
import { writeProposal } from '../intelligence/writer.js';
import { sendEmail } from '../email/sender.js';
import {
  getJobsWithApplyEmail,
  getTodayApplicationCountByType,
  insertApplication,
  updateJobStatus,
  markJobApplied,
} from '../db/queries.js';

const DAILY_CAP = 15;
const APPLY_TYPE = 'email_apply';

export async function emailApplyToJobs() {
  const jobs = getJobsWithApplyEmail(config.prospeoMinScore, 100); // score ≥ 75
  let sent = 0;

  for (const job of jobs) {
    // Re-check the cap mid-loop.
    const usedToday = getTodayApplicationCountByType(APPLY_TYPE);
    if (usedToday + sent >= DAILY_CAP) {
      logger.info('emailApplyToJobs: daily cap reached', { cap: DAILY_CAP, usedToday, sent });
      break;
    }

    const proposal = await writeProposal(job);

    if (config.outreachDryRun) {
      logger.info('emailApplyToJobs: DRY RUN, not sending', { jobId: job.id, to: job.apply_email });
      continue;
    }

    const result = await sendEmail({
      to: job.apply_email,
      subject: proposal.subject,
      text: proposal.body,
    });

    if (result.success) {
      insertApplication({
        type: APPLY_TYPE,
        job_id: job.id,
        to_email: job.apply_email,
        company: job.company,
        subject: proposal.subject,
        body: proposal.body,
        status: 'sent',
      });
      markJobApplied(job.id);
      sent += 1;
      logger.info('emailApplyToJobs: sent', { jobId: job.id, to: job.apply_email, sent });
    } else {
      updateJobStatus(job.id, 'apply_failed');
      logger.warn('emailApplyToJobs: send failed', { jobId: job.id, error: result.error });
    }

    await humanDelay(20000, 45000);
  }

  logger.info('emailApplyToJobs complete', { sent });
  return { sent };
}

export default emailApplyToJobs;
