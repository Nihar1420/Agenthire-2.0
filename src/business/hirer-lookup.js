// src/business/hirer-lookup.js — find hiring contacts for hirer-queue jobs.
// For each job flagged needs_contact (not yet looked up), run findContactForCompany via
// Apify, save the best contact as pending_review, and record contact_lookup_status.

import logger from '../utils/logger.js';
import { findContactForCompany } from './linkedin-profiles.js';
import {
  getJobsNeedingContactLookup,
  saveHirerQueueContact,
  setJobContactLookupStatus,
} from '../db/queries.js';

export async function lookupHirerQueueContacts(limit = 10) {
  const jobs = getJobsNeedingContactLookup(limit);
  let found = 0;
  let notFound = 0;

  for (const job of jobs) {
    try {
      const contact = await findContactForCompany(job.id, job.company);
      if (contact) {
        saveHirerQueueContact(job.id, {
          name: contact.name,
          company: job.company,
          linkedin_url: contact.linkedin_url,
          email: contact.email,
          track: 'recruiter_job',
        });
        setJobContactLookupStatus(job.id, 'found');
        found += 1;
      } else {
        setJobContactLookupStatus(job.id, 'not_found');
        notFound += 1;
      }
    } catch (err) {
      logger.warn('lookupHirerQueueContacts: job failed', { jobId: job.id, error: err.message });
    }
  }

  logger.info('lookupHirerQueueContacts complete', { found, notFound, considered: jobs.length });
  return { found, notFound };
}

export default lookupHirerQueueContacts;
