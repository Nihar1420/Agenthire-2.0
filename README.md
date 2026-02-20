# AgentHire

## Browser automation

Browser scrapers (`apply.js`, `wellfound.js`) use `playwright-extra` with the
`puppeteer-extra-plugin-stealth` plugin and a **persistent** browser profile stored in
`browser-data/` (gitignored). The persistent context preserves cookies/session between
runs so injected session tokens (`UPWORK_SESSION_TOKEN`, `WELLFOUND_SESSION`) survive.

Install browsers once with `npx playwright install chromium`.

