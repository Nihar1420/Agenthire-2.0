// scripts/setup.js — interactive .env wizard.
// Prompts every key config.js reads (masking secrets), live-verifies each credential against
// its real API, and writes .env atomically. Flags:
//   --verify-only   check an existing .env without rewriting it
//   --reuse         keep existing values as defaults (skip re-typing)
//
// Usage: npm run setup   |   npm run setup:verify

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveMx } from 'node:dns/promises';

const ENV_PATH = join(process.cwd(), '.env');
const TMP_PATH = join(process.cwd(), '.env.tmp');
const args = process.argv.slice(2);
const VERIFY_ONLY = args.includes('--verify-only');
const REUSE = args.includes('--reuse') || VERIFY_ONLY;

// ── existing .env (for defaults / verify) ──
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
const existing = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, 'utf8')) : {};

// ── prompting ──
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

function maskedAsk(q) {
  return new Promise((res) => {
    const onData = (char) => {
      const s = String(char);
      if (s === '\n' || s === '\r' || s === '') return;
      process.stdout.write('\x1b[2K\x1b[200D' + q + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(q, (val) => {
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      res(val);
    });
  });
}

// ── key catalog ──
const KEYS = [
  { key: 'GEMINI_API_KEY', secret: true, required: true, verify: verifyGemini },
  { key: 'GROQ_API_KEY', secret: true, verify: verifyGroq },
  { key: 'RESEND_API_KEY', secret: true, required: true, verify: verifyResend },
  { key: 'SENDING_DOMAIN', required: true, verify: verifyDomain },
  { key: 'IMAP_USER', required: true },
  { key: 'IMAP_PASS', secret: true, required: true, verify: verifyImap },
  { key: 'PERSONAL_EMAIL' },
  { key: 'HUNTER_API_KEY', secret: true, required: true, verify: verifyHunter },
  { key: 'SNOV_CLIENT_ID', secret: true, required: true },
  { key: 'SNOV_CLIENT_SECRET', secret: true, required: true, verify: verifySnov },
  { key: 'PROSPEO_API_KEY', secret: true, required: true },
  { key: 'APOLLO_ENABLED' },
  { key: 'APOLLO_API_KEY', secret: true, verify: verifyApollo },
  { key: 'GOOGLE_PLACES_API_KEY', secret: true },
  { key: 'APIFY_API_TOKEN', secret: true, verify: verifyApify },
  { key: 'FCM_DEVICE_TOKEN', secret: true },
  { key: 'GITHUB_PAT', secret: true, verify: verifyGithub },
  { key: 'OUTREACH_DRY_RUN' },
  { key: 'LINKEDIN_PROFILE_SEARCH_ENABLED' },
];

// ── verifiers (each returns {ok, detail}) ──
async function j(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, ok: res.ok, body: await res.text() };
}
async function verifyGemini(v) {
  const r = await j(`https://generativelanguage.googleapis.com/v1beta/models?key=${v}`);
  return { ok: r.ok, detail: r.ok ? 'models listed' : `HTTP ${r.status}` };
}
async function verifyGroq(v) {
  const r = await j('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${v}` } });
  return { ok: r.ok, detail: r.ok ? 'ok' : `HTTP ${r.status}` };
}
async function verifyResend(v) {
  const r = await j('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${v}` } });
  return { ok: r.ok, detail: r.ok ? 'ok' : `HTTP ${r.status}` };
}
async function verifyDomain(v) {
  try {
    const mx = await resolveMx(v);
    return { ok: mx.length > 0, detail: `${mx.length} MX records` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}
async function verifyImap(v, all) {
  try {
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: all.IMAP_USER, pass: v }, logger: false });
    await client.connect();
    await client.logout();
    return { ok: true, detail: 'connected' };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}
async function verifyHunter(v) {
  const r = await j(`https://api.hunter.io/v2/account?api_key=${v}`);
  return { ok: r.ok, detail: r.ok ? 'ok' : `HTTP ${r.status}` };
}
async function verifySnov(v, all) {
  const r = await j('https://api.snov.io/v1/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: all.SNOV_CLIENT_ID, client_secret: v }),
  });
  return { ok: r.ok && /access_token/.test(r.body), detail: r.ok ? 'token ok' : `HTTP ${r.status}` };
}
async function verifyApollo(v, all) {
  if (!/^(1|true|yes)$/i.test(all.APOLLO_ENABLED || '')) return { ok: true, detail: 'disabled — skipped' };
  const r = await j('https://api.apollo.io/v1/auth/health', { headers: { 'X-Api-Key': v } });
  return { ok: r.ok, detail: r.ok ? 'ok' : `HTTP ${r.status}` };
}
async function verifyApify(v) {
  const r = await j(`https://api.apify.com/v2/users/me?token=${v}`);
  return { ok: r.ok, detail: r.ok ? 'ok' : `HTTP ${r.status}` };
}
async function verifyGithub(v) {
  const r = await j('https://api.github.com/user', { headers: { Authorization: `Bearer ${v}`, 'User-Agent': 'AgentHire-setup' } });
  return { ok: r.ok, detail: r.ok ? 'ok' : `HTTP ${r.status}` };
}

// ── main ──
async function main() {
  const values = {};
  console.log(VERIFY_ONLY ? 'AgentHire — verify .env\n' : 'AgentHire — .env setup\n');

  for (const spec of KEYS) {
    const cur = existing[spec.key];
    if (VERIFY_ONLY) {
      values[spec.key] = cur || '';
      continue;
    }
    const label = `${spec.key}${spec.required ? ' (required)' : ''}${cur && REUSE ? ' [keep current]' : ''}: `;
    let val = spec.secret ? await maskedAsk(label) : await ask(label);
    if (!val && cur && REUSE) val = cur;
    values[spec.key] = val;
  }

  // Verify.
  console.log('\nVerifying credentials…');
  for (const spec of KEYS) {
    if (!spec.verify) continue;
    const v = values[spec.key];
    if (!v) {
      console.log(`  ○ ${spec.key}: (empty, skipped)`);
      continue;
    }
    try {
      const r = await spec.verify(v, values);
      console.log(`  ${r.ok ? '✓' : '✗'} ${spec.key}: ${r.detail}`);
    } catch (e) {
      console.log(`  ✗ ${spec.key}: ${e.message}`);
    }
  }

  if (!VERIFY_ONLY) {
    const lines = KEYS.map((s) => `${s.key}=${values[s.key] ?? ''}`);
    writeFileSync(TMP_PATH, lines.join('\n') + '\n', 'utf8');
    renameSync(TMP_PATH, ENV_PATH); // atomic
    console.log(`\n✓ Wrote ${ENV_PATH}`);
  }

  rl.close();
}

main().catch((e) => {
  console.error('setup failed:', e.message);
  rl.close();
  process.exit(1);
});
