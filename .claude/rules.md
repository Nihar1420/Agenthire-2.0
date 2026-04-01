# AgentHire — Agent Rules

These rules apply to any AI assistant working in this repository.

- **ESM only, no TypeScript.** Match the existing module style.
- **Never hardcode secrets.** Everything comes from `process.env` via `src/core/config.js`.
- **Respect caps.** Re-check daily caps mid-loop; never exceed the global Resend cap (90/day).
- **Prospeo is gated.** Only call it when `score >= 75` and a LinkedIn URL exists.
- **Never `Math.random()` for timing.** Use `humanDelay()`.
- **A step must never crash the cycle.** Wrap risky work so failures are logged, not fatal.
- **Preserve the intentional quirks** documented in `REBUILD-FROM-SCRATCH.md` Appendix C.
