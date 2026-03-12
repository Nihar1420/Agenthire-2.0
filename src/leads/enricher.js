// src/leads/enricher.js — turn bare company leads into contactable people.
// For each lead lacking an email: ask Apollo mixed_people/search for a CTO / VP-Eng /
// Founder (dropping Apollo's locked "email_not_unlocked" placeholders), then fall back to
// the 6-method findEmail() chain. Sets ready_for_outreach or no_email.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { findEmail } from '../email/hunter.js';
import { getLeadsWithoutEmail, updateLeadEnrichment } from '../db/queries.js';

const TARGET_TITLES = ['CTO', 'VP of Engineering', 'VP Engineering', 'Founder', 'Co-Founder', 'CEO', 'Head of Engineering'];

function isLocked(email) {
  return !email || /email_not_unlocked|locked|domain\.com$/i.test(email);
}

/** Apollo people search for a decision-maker at a company. Returns {name,title,email}|null. */
async function apolloPerson(lead) {
  if (!config.apolloEnabled || !config.apolloApiKey || !lead.company) return null;
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.apolloApiKey,
        q_organization_name: lead.company,
        person_titles: TARGET_TITLES,
        page: 1,
        per_page: 5,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const people = data?.people || [];
    for (const p of people) {
      if (!isLocked(p.email)) {
        return { name: p.name, title: p.title, email: p.email.toLowerCase(), linkedin_url: p.linkedin_url };
      }
    }
    // Even a locked person gives us a name to feed findEmail().
    const first = people[0];
    if (first) return { name: first.name, title: first.title, email: null, linkedin_url: first.linkedin_url };
  } catch (err) {
    logger.debug('apolloPerson failed', { error: err.message });
  }
  return null;
}

export async function enrichDiscoveredLeads(limit = 20) {
  const leads = getLeadsWithoutEmail(limit);
  let ready = 0;
  let noEmail = 0;

  for (const lead of leads) {
    try {
      let name = lead.name;
      let title = lead.title;
      let email = null;
      let linkedin = lead.linkedin_url;

      const person = await apolloPerson(lead);
      if (person) {
        name = person.name || name;
        title = person.title || title;
        linkedin = person.linkedin_url || linkedin;
        email = person.email;
      }

      // Fallback to the findEmail() chain if Apollo didn't hand us a usable address.
      if (!email) {
        const result = await findEmail({ ...lead, name, linkedin_url: linkedin });
        if (result?.email) email = result.email;
      }

      if (email) {
        updateLeadEnrichment(lead.id, {
          name,
          title,
          email,
          email_status: 'guessed',
          linkedin_url: linkedin,
          status: 'ready_for_outreach',
          ready_for_outreach: 1,
        });
        ready += 1;
      } else {
        updateLeadEnrichment(lead.id, { name, title, status: 'no_email' });
        noEmail += 1;
      }
    } catch (err) {
      logger.warn('enrichDiscoveredLeads: lead failed', { leadId: lead.id, error: err.message });
    }
  }

  logger.info('enrichDiscoveredLeads complete', { ready, noEmail, considered: leads.length });
  return { ready, noEmail };
}

export default enrichDiscoveredLeads;
