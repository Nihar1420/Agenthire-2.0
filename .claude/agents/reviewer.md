# Reviewer agent

A focused code-review agent for AgentHire changes.

**Checklist**
- No secrets committed; `.env` / credential files stay gitignored.
- Daily caps respected and re-checked mid-loop.
- Every new orchestrator step is wrapped so it can't crash the cycle.
- External API calls fail soft (return a safe default, never throw up the stack).
- New DB columns added via idempotent `addColumnIfMissing` in `schema.js`.
