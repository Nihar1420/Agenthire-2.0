// src/intelligence/llm.js — LLM access layer.
// Primary provider: Google Gemini (gemini-2.5-flash). Every call returns a uniform
// { text } shape so callers never touch a provider SDK directly.

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../core/config.js';
import logger from '../utils/logger.js';

const GEMINI_MODEL = 'gemini-2.5-flash';

let _gemini = null;
function gemini() {
  if (_gemini) return _gemini;
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set');
  _gemini = new GoogleGenerativeAI(config.geminiApiKey);
  return _gemini;
}

/**
 * Complete a prompt.
 * @param {string} prompt
 * @param {{ temperature?: number, maxOutputTokens?: number }} [opts]
 * @returns {Promise<{ text: string }>}
 */
export async function complete(prompt, opts = {}) {
  const model = gemini().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
    },
  });

  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.() ?? '';
  logger.debug('llm.complete via gemini', { chars: text.length });
  return { text };
}

export default { complete };
