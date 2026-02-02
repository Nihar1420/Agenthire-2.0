# CLAUDE.md — AgentHire Project Context

## Mission

AgentHire is a headless Node.js agent that runs permanently on a $6/mo VPS under PM2.
Every 2 hours it scrapes job feeds and browser platforms, scores every job/lead 0–100
against the candidate résumé with an LLM, finds decision-maker emails through a 6-method
fallback chain, runs two outbound sales tracks (developer + SMB), discovers LinkedIn
hiring contacts once/day, sends applications & cold emails through Resend (hard daily
caps), watches a Gmail inbox over IMAP for replies (instant FCM push), emails a daily
digest, self-analyses weekly, and exposes a read-only Next.js dashboard.

## Hard constraints

| Concern | Choice | Rule |
|---|---|---|
| Runtime | Node.js ≥18 (20 on VPS), **ESM** (`"type":"module"`) | No TypeScript |
| DB | SQLite via `better-sqlite3` (WAL) | No Postgres/Mongo/Redis |
| Queue | In-memory priority queue | No BullMQ |
| Process mgr | PM2 — 4 processes | A crash in one never kills the others |
| Secrets | `process.env` via hand-rolled `.env` loader | Never hardcode; `.env` + `data/` + `logs/` gitignored |
| Browser | `playwright-extra` + stealth plugin | Persistent profiles, cookie injection, gaussian delays |
| LLM | Gemini `gemini-2.5-flash` → Groq `llama-3.3-70b` | Never a paid model unless told |
| Email out | Resend (global cap 90/day) | Always from `SENDING_DOMAIN`, plain-text |
| Caps | Upwork 8 · dev 10 · SMB 35 · contact 50 · email-apply 15 (per day) | Re-check cap mid-loop |
| Prospeo gate | Only when `score >= 75` AND LinkedIn URL exists | Paid credits — never waste |
| Delays | `humanDelay()` gaussian (Box-Muller) | Never `Math.random()` |
| Apollo | Disabled by default (`APOLLO_ENABLED=false`) | Free plan 403s the REST API |

## Folder map

```
src/
  core/         config.js queue.js orchestrator.js run-once.js
  db/           schema.js queries.js
  utils/        logger.js delay.js proxy-rotator.js keyword-match.js
  intelligence/ llm.js scorer.js writer.js
  scrapers/     upwork.js apply.js wwr.js remotive.js remoteok.js hackernews.js wellfound.js email-apply.js
  email/        hunter.js sender.js sequence.js verifier.js imap-watcher.js imap-watcher-run.js
  crawler/      index.js http.js text.js  adapters/{rss,json-api,html}.js
  leads/        company-hunter.js enricher.js outreach.js
  business/     idea-generator.js company-finder.js qualifier.js smb-outreach.js
                business-email.js places-finder.js linkedin-profiles.js linkedin-posts.js post-filter.js
  learning/     reflector.js
  notify/       push.js digest.js digest-run.js
ui/             Next.js 14 App-Router dashboard (own package.json)
config/         resume.md skills.json templates.json  (proxies.json + firebase-service-account.json gitignored)
scripts/        setup.js + diagnostics
ecosystem.config.cjs  limits-check.cjs  package.json  CLAUDE.md
```

## Environment variables

Required: `GEMINI_API_KEY`, `RESEND_API_KEY`, `SENDING_DOMAIN`, `IMAP_USER`, `IMAP_PASS`,
`HUNTER_API_KEY`, `SNOV_CLIENT_ID`, `SNOV_CLIENT_SECRET`, `PROSPEO_API_KEY`.
Conditional: `APOLLO_API_KEY` (only when `APOLLO_ENABLED=true`).
Recommended: `GROQ_API_KEY`.
Optional: `GOOGLE_PLACES_API_KEY`, `APIFY_API_TOKEN`, `FCM_*`, `PERSONAL_EMAIL`,
`BCC_EMAIL`, `UPWORK_SESSION_TOKEN`, `WELLFOUND_SESSION`, `OUTREACH_DRY_RUN`,
`LINKEDIN_PROFILE_SEARCH_ENABLED`, `LINKEDIN_PROFILE_DAILY_CAP`, `DB_PATH`, crawler tunables.

Non-env secret files (gitignored): `config/firebase-service-account.json`, `config/proxies.json`.

## DB schema (SQLite, WAL)

Tables: `jobs`, `leads`, `applications`, `outcomes`, `email_patterns`, `learnings`,
`cycle_logs`, `contacts`, `business_ideas`. See `src/db/schema.js` for authoritative DDL.

## Module interfaces (key exports)

- `db/schema.js` → `getDb()`, `migrate()`, `closeDb()`
- `core/config.js` → `config` (keys + caps), `validateEnv()`
- `intelligence/llm.js` → `complete(prompt, opts)`
- `intelligence/scorer.js` → `scoreJob(job)`, `scoreUnscoredJobs(limit)`
- `intelligence/writer.js` → `writeProposal(job)`, `writeColdEmail(lead)`, `writeFollowUp(app, n)`
- `email/sender.js` → `sendEmail()`, `sendBulk()`
- `email/hunter.js` → `findEmail(lead)`, `findEmailsForLeads(limit)`, `findEmailsForContacts(limit)`
- `core/orchestrator.js` → `runCycle()`, `startOrchestrator()`

## PM2 layout (4 processes)

1. `orchestrator` — run-once, cron every 2h (`autorestart:false`)
2. `imap-watcher` — always-on reply watcher (5s restart)
3. `digest` — always-on daily digest scheduler
4. `dashboard` — `next start` from `./ui` on PORT 3000

## Cap rules

Every send path re-checks its daily cap **mid-loop** (counts can change during a cycle).
Global Resend cap 90/day sits above the per-track caps. Prospeo is hard-gated on score≥75.
