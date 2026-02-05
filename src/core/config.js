// src/core/config.js — hand-rolled .env loader + validated config.
// No dotenv dependency: we split each line on the FIRST "=" and preserve the remainder
// verbatim, so spaced Gmail app passwords ("abcd efgh ijkl mnop") survive intact.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ENV_PATH = join(ROOT, '.env');

/** Parse a .env file into a plain object (first "=" splits key/value; # comments). */
function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of matching surrounding quotes, but keep inner spaces.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Load .env into process.env (without overwriting already-set vars). */
function loadDotenv() {
  if (!existsSync(ENV_PATH)) return;
  const parsed = parseEnv(readFileSync(ENV_PATH, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotenv();

/** Load the JSON/markdown config files (best-effort; missing → sensible empty). */
function loadFile(relPath, { json = false } = {}) {
  try {
    const raw = readFileSync(join(ROOT, relPath), 'utf8');
    return json ? JSON.parse(raw) : raw;
  } catch {
    return json ? {} : '';
  }
}

const env = process.env;
const bool = (v, def = false) => (v === undefined ? def : /^(1|true|yes)$/i.test(v));
const int = (v, def) => (v === undefined || v === '' ? def : parseInt(v, 10));

export const config = {
  // ─── LLM ───────────────────────────────────────────────
  geminiApiKey: env.GEMINI_API_KEY,
  groqApiKey: env.GROQ_API_KEY,

  // ─── Email out / inbox / push ──────────────────────────
  resendApiKey: env.RESEND_API_KEY,
  sendingDomain: env.SENDING_DOMAIN,
  imapUser: env.IMAP_USER,
  imapPass: env.IMAP_PASS,
  imapLookbackDays: int(env.IMAP_LOOKBACK_DAYS, 3),
  personalEmail: env.PERSONAL_EMAIL,
  bccEmail: env.BCC_EMAIL || env.PERSONAL_EMAIL,
  fcmServerKey: env.FCM_SERVER_KEY,
  fcmDeviceToken: env.FCM_DEVICE_TOKEN,

  // ─── Lead intelligence ─────────────────────────────────
  hunterApiKey: env.HUNTER_API_KEY,
  snovClientId: env.SNOV_CLIENT_ID,
  snovClientSecret: env.SNOV_CLIENT_SECRET,
  prospeoApiKey: env.PROSPEO_API_KEY,
  apolloEnabled: bool(env.APOLLO_ENABLED, false), // off by default — free plan 403s
  apolloApiKey: env.APOLLO_API_KEY,
  googlePlacesApiKey: env.GOOGLE_PLACES_API_KEY,
  apifyApiToken: env.APIFY_API_TOKEN,

  // ─── Platform sessions ─────────────────────────────────
  upworkSessionToken: env.UPWORK_SESSION_TOKEN,
  wellfoundSession: env.WELLFOUND_SESSION,

  // ─── Feature toggles ───────────────────────────────────
  outreachDryRun: bool(env.OUTREACH_DRY_RUN, false),
  linkedinProfileSearchEnabled: bool(env.LINKEDIN_PROFILE_SEARCH_ENABLED, false),
  linkedinProfileDailyCap: int(env.LINKEDIN_PROFILE_DAILY_CAP, 50),

  // ─── Crawler tunables ──────────────────────────────────
  crawlerHtmlCareerUrl: env.CRAWLER_HTML_CAREER_URL || null,
  crawlerUserAgent:
    env.CRAWLER_USER_AGENT ||
    'Mozilla/5.0 (compatible; AgentHireBot/1.0; +https://github.com/Nihar1420/Agenthire-2.0)',
  crawlerFetchTimeoutMs: int(env.CRAWLER_FETCH_TIMEOUT_MS, 30000),
  crawlerPerDomainDelayMs: int(env.CRAWLER_PER_DOMAIN_DELAY_MS, 5000),

  // ─── Infra / misc ──────────────────────────────────────
  dbPath: env.DB_PATH || join(ROOT, 'data', 'agent.db'),
  githubPat: env.GITHUB_PAT,
  dropletIp: env.DROPLET_IP,

  // ─── Caps & gates (authoritative constants) ────────────
  upworkDailyCap: 8,
  devOutreachDailyCap: 10,
  smbOutreachDailyCap: 35,
  contactOutreachDailyCap: 50,
  emailApplyDailyCap: 15,
  globalDailySendCap: 90,
  prospeoMinScore: 75,
  upworkListingsCap: 30,
  wellfoundListingsCap: 30,

  // ─── Loaded config files ───────────────────────────────
  skills: loadFile('config/skills.json', { json: true }),
  resume: loadFile('config/resume.md'),
  templates: loadFile('config/templates.json', { json: true }),
};

// Base-required env keys (always). APOLLO_API_KEY is conditionally required below.
const REQUIRED = [
  'GEMINI_API_KEY',
  'RESEND_API_KEY',
  'SENDING_DOMAIN',
  'IMAP_USER',
  'IMAP_PASS',
  'HUNTER_API_KEY',
  'SNOV_CLIENT_ID',
  'SNOV_CLIENT_SECRET',
  'PROSPEO_API_KEY',
];

/** Throw a clear error listing every missing required env key. */
export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (config.apolloEnabled && !process.env.APOLLO_API_KEY) {
    missing.push('APOLLO_API_KEY (required when APOLLO_ENABLED=true)');
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s):\n  - ${missing.join('\n  - ')}\n` +
        `Set them in .env (run "npm run setup") before starting the agent.`
    );
  }
  return true;
}

export default config;
