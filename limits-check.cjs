// limits-check.cjs — read-only health check of daily send/token usage vs targets, plus
// live API balances (Apify / Hunter / Snov / Prospeo). Prints a SAFE/WARNING/CRITICAL
// report. Never mutates anything. Run: `node limits-check.cjs`.

const fs = require('node:fs');
const path = require('node:path');

// ── Minimal .env loader (first '=' splits; spaces preserved) ──
function loadEnv() {
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}
loadEnv();

const C = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m' };
const GLOBAL_DAILY_SEND_CAP = 90;

function level(used, cap) {
  const pct = cap ? used / cap : 0;
  if (pct >= 0.95) return ['CRITICAL', C.red];
  if (pct >= 0.75) return ['WARNING', C.yellow];
  return ['SAFE', C.green];
}

function line(label, detail, [status, color]) {
  console.log(`${color}${status.padEnd(9)}${C.reset} ${label.padEnd(22)} ${C.dim}${detail}${C.reset}`);
}

function todaySendCount() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'agent.db');
    if (!fs.existsSync(dbPath)) return 0;
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(`SELECT COUNT(*) n FROM applications WHERE date(sent_at) = date('now','localtime')`)
      .get();
    db.close();
    return row ? row.n : 0;
  } catch {
    return 0;
  }
}

async function safeJson(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log('AgentHire — limits & balances\n' + '='.repeat(40));

  // Daily sends.
  const sends = todaySendCount();
  line('Daily sends', `${sends}/${GLOBAL_DAILY_SEND_CAP}`, level(sends, GLOBAL_DAILY_SEND_CAP));

  // Hunter.io balance.
  if (process.env.HUNTER_API_KEY) {
    const d = await safeJson(`https://api.hunter.io/v2/account?api_key=${process.env.HUNTER_API_KEY}`);
    const used = d?.data?.requests?.searches?.used;
    const avail = d?.data?.requests?.searches?.available;
    if (used != null && avail != null) line('Hunter searches', `${used}/${avail}`, level(used, avail));
    else line('Hunter', d.error || 'unknown', ['WARNING', C.yellow]);
  }

  // Apify usage.
  if (process.env.APIFY_API_TOKEN) {
    const d = await safeJson(`https://api.apify.com/v2/users/me?token=${process.env.APIFY_API_TOKEN}`);
    const usd = d?.data?.plan?.monthlyUsageUsd ?? d?.data?.monthlyUsage?.usdSpend;
    line('Apify', usd != null ? `$${usd} this month` : d.error || 'ok', usd != null ? level(usd, 5) : ['SAFE', C.green]);
  }

  // Snov (token acquisition proves credentials work).
  if (process.env.SNOV_CLIENT_ID && process.env.SNOV_CLIENT_SECRET) {
    const d = await safeJson('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.SNOV_CLIENT_ID,
        client_secret: process.env.SNOV_CLIENT_SECRET,
      }),
    });
    line('Snov auth', d.access_token ? 'ok' : d.error || 'failed', d.access_token ? ['SAFE', C.green] : ['CRITICAL', C.red]);
  }

  // Prospeo (presence check only — no free balance endpoint).
  line('Prospeo key', process.env.PROSPEO_API_KEY ? 'present' : 'missing', process.env.PROSPEO_API_KEY ? ['SAFE', C.green] : ['WARNING', C.yellow]);

  console.log('='.repeat(40));
}

main().catch((e) => {
  console.error('limits-check failed:', e.message);
  process.exit(1);
});
