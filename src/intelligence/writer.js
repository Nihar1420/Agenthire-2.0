// src/intelligence/writer.js — LLM copywriters.
// All copy is first-person, honest (no invented experience), free of flattery and a
// banned spam-word list. Writers return { subject, body } with safe fallbacks.

import config from '../core/config.js';
import logger from '../utils/logger.js';
import { complete } from './llm.js';
import { stripCodeFences } from './scorer.js';

const RESUME_CAP = 2500;
const DESC_CAP = 1500;

function bannedWordsRule() {
  const banned = config.templates?.bannedWords || [];
  return banned.length ? `Never use these words/phrases: ${banned.join(', ')}.` : '';
}

const RULES = () => `Rules:
- Write in first person, plain and direct.
- ${bannedWordsRule()}
- No flattery, no hype, no exclamation marks.
- Never claim experience or skills not present in the résumé.
- One clear call to action.`;

/** Parse { subject, body } from model output, tolerating code fences. */
function parseCopy(text) {
  const cleaned = stripCodeFences(text);
  try {
    const obj = JSON.parse(cleaned);
    if (obj && (obj.subject || obj.body)) {
      return { subject: (obj.subject || '').trim(), body: (obj.body || '').trim() };
    }
  } catch {
    // fall through
  }
  return null;
}

function withSignature(body) {
  const sig = config.templates?.signature || 'Best';
  return body.includes(sig) ? body : `${body}\n\n${sig}`;
}

/**
 * Write a proposal for a job. Returns { subject, body } (body includes signature).
 * On any failure returns a safe generic fallback so the caller never crashes.
 */
export async function writeProposal(job) {
  const resume = (config.resume || '').slice(0, RESUME_CAP);
  const desc = (job.description || '').slice(0, DESC_CAP);
  const style = config.templates?.proposal?.styleGuide || '';
  const { min = 150, max = 200 } = config.templates?.proposal?.wordCount || {};

  const prompt = `Write a job-application proposal (${min}-${max} words).
Return STRICT JSON: {"subject": "...", "body": "..."}.
Style: ${style}
${RULES()}

=== RÉSUMÉ ===
${resume}

=== JOB ===
Title: ${job.title || ''}
Company: ${job.company || ''}
Description: ${desc}

JSON:`;

  try {
    const { text } = await complete(prompt, { temperature: 0.6, maxOutputTokens: 700 });
    const copy = parseCopy(text);
    if (copy && copy.body) {
      return { subject: copy.subject || `Application: ${job.title || 'your role'}`, body: withSignature(copy.body) };
    }
  } catch (err) {
    logger.warn('writeProposal failed, using fallback', { jobId: job.id, error: err.message });
  }

  return {
    subject: `Application: ${job.title || 'your role'}`,
    body: withSignature(
      `Hi,\n\nI'm a full-stack engineer (Node.js / React) interested in "${job.title || 'your role'}". ` +
        `I've shipped production web apps and automation systems end-to-end and can start immediately. ` +
        `Happy to share relevant work — would a short call this week suit you?`
    ),
  };
}

/**
 * Write a cold outreach email for a lead. 5–7 sentences, company-specific opener,
 * single CTA. Returns { subject, body }; safe fallback on failure.
 */
export async function writeColdEmail(lead) {
  const resume = (config.resume || '').slice(0, RESUME_CAP);
  const style = config.templates?.coldEmail?.styleGuide || '';
  const { min = 5, max = 7 } = config.templates?.coldEmail?.sentenceCount || {};
  const company = lead.company || 'your team';
  const name = lead.name ? lead.name.split(' ')[0] : 'there';

  const prompt = `Write a cold outreach email (${min}-${max} sentences).
Return STRICT JSON: {"subject": "...", "body": "..."}.
Open with something specific to ${company}. One clear, low-friction CTA.
Style: ${style}
${RULES()}

Recipient: ${name}${lead.title ? `, ${lead.title}` : ''} at ${company}
${lead.notes ? `Context: ${String(lead.notes).slice(0, 400)}` : ''}

=== SENDER RÉSUMÉ ===
${resume}

JSON:`;

  try {
    const { text } = await complete(prompt, { temperature: 0.6, maxOutputTokens: 500 });
    const copy = parseCopy(text);
    if (copy && copy.body) {
      return { subject: copy.subject || `Quick idea for ${company}`, body: withSignature(copy.body) };
    }
  } catch (err) {
    logger.warn('writeColdEmail failed, using fallback', { leadId: lead.id, error: err.message });
  }

  return {
    subject: `Quick idea for ${company}`,
    body: withSignature(
      `Hi ${name},\n\nI came across ${company} and wanted to reach out. ` +
        `I build Node.js/React web apps and automation, and I think I could help you ship faster. ` +
        `Would you be open to a short call this week?`
    ),
  };
}

export default { writeProposal, writeColdEmail };
