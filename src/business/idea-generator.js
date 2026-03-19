// src/business/idea-generator.js — weekly SMB opportunity generator.
// Asks the LLM for 10 concrete local-business service pitches, validates them, and persists
// to business_ideas. Scheduled Sundays 08:00 IST. (The business_ideas CRUD lands in the next
// commit; persistence is imported lazily so this module loads before it exists.)

import cron from 'node-cron';
import logger from '../utils/logger.js';
import { complete } from '../intelligence/llm.js';
import { stripCodeFences } from '../intelligence/scorer.js';

const TZ = 'Asia/Kolkata';

const PROMPT = `Generate 10 concrete opportunities where a freelance developer could sell a small
digital project to a local small business (SMB). Return STRICT JSON: an array of 10 objects,
each: {"type": "<business category>", "geography": "<city/region>", "digital_gap": "<what they
lack, e.g. no website / outdated site / no online booking>", "service_pitch": "<1 sentence offer>",
"estimated_value": <USD integer 500-6000>, "keywords": ["places","search","terms"]}.
No prose, JSON array only.`;

function validate(idea) {
  return (
    idea &&
    typeof idea.type === 'string' &&
    typeof idea.service_pitch === 'string' &&
    idea.service_pitch.length > 0
  );
}

export async function generateBusinessIdeas() {
  let ideas = [];
  try {
    const { text } = await complete(PROMPT, { temperature: 0.8, maxOutputTokens: 1500 });
    const parsed = JSON.parse(stripCodeFences(text));
    if (Array.isArray(parsed)) ideas = parsed.filter(validate).slice(0, 10);
  } catch (err) {
    logger.warn('generateBusinessIdeas: parse/LLM failed', { error: err.message });
  }

  // Persist if the business_ideas layer is available.
  let persisted = 0;
  try {
    const q = await import('../db/queries.js');
    if (typeof q.insertBusinessIdea === 'function') {
      for (const idea of ideas) {
        q.insertBusinessIdea({
          type: idea.type,
          geography: idea.geography || null,
          digital_gap: idea.digital_gap || null,
          service_pitch: idea.service_pitch,
          estimated_value: idea.estimated_value || null,
          keywords: JSON.stringify(idea.keywords || []),
        });
        persisted += 1;
      }
    }
  } catch (err) {
    logger.debug('generateBusinessIdeas: persistence unavailable', { error: err.message });
  }

  logger.info('generateBusinessIdeas complete', { generated: ideas.length, persisted });
  return { ideas, persisted };
}

export function startBusinessIdeasScheduler() {
  cron.schedule('0 8 * * 0', () => generateBusinessIdeas().catch((e) => logger.error('ideas cron failed', { error: e.message })), {
    timezone: TZ,
  });
  logger.info('business ideas scheduler started (0 8 * * 0 IST)');
}

export default generateBusinessIdeas;
