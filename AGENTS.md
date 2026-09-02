# open-email

## Agent skills

### Issue tracker

GitHub Issues in this repo, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Before commit / push

Run the light CI gate locally (typecheck + UI build + forge build + vitest). Skip heavy jobs (`npm run test:e2e`, Docker image builds, `test:l2`):

```bash
npm run precommit
```

Requires Foundry (`forge`) on PATH — same as CI's `npm test` path without Playwright e2e / `forge test`.
