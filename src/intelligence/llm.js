// src/intelligence/llm.js — LLM access layer.
// Primary: Google Gemini (gemini-2.5-flash). On ANY Gemini failure, fall back to
// Groq (llama-3.3-70b-versatile). Every call returns a uniform { text } shape.

import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import config from '../core/config.js';
import logger from '../utils/logger.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

if (!config.groqApiKey) {
  logger.warn('GROQ_API_KEY is not set — no LLM fallback if Gemini fails.');
}

/**
 * Preventive per-minute request throttle. Serializes acquire() calls through a promise
 * chain so concurrent callers queue in order, and delays the next request until fewer
 * than `rpm` timestamps fall inside the trailing 60s window.
 */
export class SlidingWindowLimiter {
  constructor(rpm = 12) {
    this.rpm = rpm;
    this.windowMs = 60_000;
    this.timestamps = [];
    this._chain = Promise.resolve();
  }

  acquire() {
    // Chain so only one waiter is evaluated at a time (FIFO fairness).
    this._chain = this._chain.then(() => this._acquireOne());
    return this._chain;
  }

  async _acquireOne() {
    // Drop timestamps outside the window.
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.rpm) {
      const oldest = this.timestamps[0];
      const wait = this.windowMs - (now - oldest) + 5;
      await new Promise((r) => setTimeout(r, wait));
      return this._acquireOne();
    }
    this.timestamps.push(Date.now());
  }
}

const limiter = new SlidingWindowLimiter(
  parseInt(process.env.LLM_RPM || '12', 10)
);

/**
 * Approximate daily token accounting with midnight (local) rollover. Limits are
 * env-overridable; we log a single warning per day once usage crosses 80%.
 */
export class TokenCounter {
  constructor(dailyLimit) {
    this.dailyLimit = dailyLimit;
    this.day = TokenCounter._today();
    this.used = 0;
    this._warned = false;
  }

  static _today() {
    return new Date().toISOString().slice(0, 10);
  }

  _rolloverIfNeeded() {
    const today = TokenCounter._today();
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
      this._warned = false;
    }
  }

  /** Rough token estimate: ~4 characters per token. */
  static estimate(text) {
    return Math.ceil((text || '').length / 4);
  }

  add(tokens) {
    this._rolloverIfNeeded();
    this.used += tokens;
    if (!this._warned && this.used >= this.dailyLimit * 0.8) {
      this._warned = true;
      logger.warn('LLM daily token usage above 80%', {
        used: this.used,
        limit: this.dailyLimit,
      });
    }
    return this.used;
  }

  remaining() {
    this._rolloverIfNeeded();
    return Math.max(0, this.dailyLimit - this.used);
  }
}

const tokenCounter = new TokenCounter(
  parseInt(process.env.LLM_DAILY_TOKEN_LIMIT || '1000000', 10)
);

let _gemini = null;
function gemini() {
  if (_gemini) return _gemini;
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set');
  _gemini = new GoogleGenerativeAI(config.geminiApiKey);
  return _gemini;
}

let _groq = null;
function groq() {
  if (_groq) return _groq;
  if (!config.groqApiKey) throw new Error('GROQ_API_KEY is not set');
  _groq = new Groq({ apiKey: config.groqApiKey });
  return _groq;
}

async function completeGemini(prompt, opts) {
  const model = gemini().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
    },
  });
  const result = await model.generateContent(prompt);
  return result?.response?.text?.() ?? '';
}

async function completeGroq(prompt, opts) {
  const res = await groq().chat.completions.create({
    model: GROQ_MODEL,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxOutputTokens ?? 2048,
    messages: [{ role: 'user', content: prompt }],
  });
  return res?.choices?.[0]?.message?.content ?? '';
}

/**
 * Complete a prompt. Tries Gemini first, then Groq on any failure.
 * @returns {Promise<{ text: string, provider: string }>}
 */
export async function complete(prompt, opts = {}) {
  await limiter.acquire();
  const promptTokens = TokenCounter.estimate(prompt);
  try {
    const text = await completeGemini(prompt, opts);
    tokenCounter.add(promptTokens + TokenCounter.estimate(text));
    logger.debug('llm.complete via gemini', { chars: text.length });
    return { text, provider: 'gemini' };
  } catch (geminiErr) {
    logger.warn('Gemini failed, falling back to Groq', { error: geminiErr.message });
    if (!config.groqApiKey) throw geminiErr;
    const text = await completeGroq(prompt, opts);
    tokenCounter.add(promptTokens + TokenCounter.estimate(text));
    logger.debug('llm.complete via groq', { chars: text.length });
    return { text, provider: 'groq' };
  }
}

/** Current daily token usage snapshot. */
export function tokenUsage() {
  return { used: tokenCounter.used, remaining: tokenCounter.remaining(), limit: tokenCounter.dailyLimit };
}

export default { complete };
