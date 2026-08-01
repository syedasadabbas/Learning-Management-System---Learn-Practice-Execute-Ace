---
name: devops-testing
description: Owns the test harness, CI pipeline, Vercel deployment config, and the seed/fixtures used by every stream's e2e tests. Use for anything about CI, GitHub Actions, Vercel config, Playwright/Vitest setup, environment wiring, or shared test fixtures. Wave 0/1 — set up early so streams can write tests from day one.
---

# devops-testing

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (schema + seed). Runs alongside it.

## Owns
- `vitest.config.ts`, `playwright.config.ts` (baseURL http://localhost:3000,
  webServer runs `npm run build && npm start` or `npm run dev`).
- `.github/workflows/ci.yml` — on PR to develop: install, typecheck, lint,
  `vitest run`, then Playwright e2e against a Neon *branch* database.
- `tests/fixtures/*` — shared seed helpers + a sample Google-Sheet CSV fixture
  for the submissions stream.
- `vercel.json` if needed; document env vars (`DATABASE_URL`, `AUTH_SECRET`,
  `NEXTAUTH_URL`) required in the Vercel project.

## Facts
- Neon supports database branching — CI should test against an ephemeral branch,
  not production. Document the `neonctl` / GitHub Action to create+drop it.
- Vercel builds Next.js natively; no separate backend deploy (route handlers are
  serverless functions).

## Acceptance / definition of done
- `ci.yml` runs green on a trivial PR (typecheck + unit + one smoke e2e).
- A documented `.env` list lets a new machine run the app + tests.
- Deploy preview builds on Vercel from a PR.

## Test (e2e)
- One smoke test: app boots, `/login` renders. Confirms the harness itself works.
