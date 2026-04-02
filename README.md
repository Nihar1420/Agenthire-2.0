# AgentHire

An autonomous 24/7 job & freelance outreach agent. A headless Node.js service runs on a
small VPS under PM2 and, every 2 hours, scrapes job feeds and browser platforms, scores each
opportunity against a résumé with an LLM, finds decision-maker emails through a 6-method
fallback chain, runs two outbound sales tracks (developer + SMB), discovers LinkedIn hiring
contacts once a day, sends applications and cold emails through Resend (hard daily caps),
watches a Gmail inbox for replies (instant push), emails a daily digest, and self-analyses
weekly. A read-only Next.js dashboard provides monitoring plus a manual hirer-queue send.

## Quick start

```bash
npm install
npm run setup            # interactive .env wizard (live-verifies every credential)
npm run migrate          # create data/agent.db
npm run once             # run a single cycle
```

Run the full system under PM2 (4 processes: orchestrator, imap-watcher, digest, dashboard):

```bash
(cd ui && npm install && npm run build)
pm2 start ecosystem.config.cjs && pm2 save
pm2 status
node limits-check.cjs    # color-coded usage + API balances
```

The dashboard runs at http://localhost:3000.

## Architecture

- **Runtime:** Node.js ≥18, ESM, no TypeScript.
- **DB:** SQLite (`better-sqlite3`, WAL) at `data/agent.db`.
- **LLM:** Gemini `gemini-2.5-flash` → Groq `llama-3.3-70b` fallback.
- **Email:** Resend out (global 90/day cap), IMAP in (reply watcher), FCM push.
- **Browser:** `playwright-extra` + stealth, persistent profiles in `browser-data/`.

See `CLAUDE.md` for the full module map, env-var reference, and cap rules, and
`REBUILD-FROM-SCRATCH.md` for the commit-by-commit build history (Appendix C lists the
intentional quirks — e.g. `scrapers/upwork.js` actually scrapes RemoteOK).

## Browser automation

Browser scrapers use a **persistent** stealth profile in `browser-data/` (gitignored) so
injected session tokens survive between runs. Install browsers once with
`npx playwright install chromium`.

## Configuration

All secrets live in `.env` (gitignored) and are read via `src/core/config.js`. Two secret
**files** are also gitignored: `config/firebase-service-account.json` (FCM) and
`config/proxies.json` (Webshare proxies). Never commit real values — run `npm run setup`.
