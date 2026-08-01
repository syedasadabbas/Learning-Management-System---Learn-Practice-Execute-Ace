---
name: shared-contracts
description: Wave 0 foundation. Establishes and freezes the database schema, shared types, scoring rules, validation schemas, API route map, and app config that every other stream builds against. Use FIRST, before any feature stream starts. Nothing else may begin until this is merged, because it is the seam that makes parallel work collision-free.
---

# shared-contracts (Wave 0 — must complete first)

Read `../HOUSE_RULES.md`.

## Why this exists
Parallel streams only avoid collisions if they all code against one agreed set
of tables, types, and function signatures. This stream produces and freezes that
seam. After it merges, feature streams import from it and never redefine it.

## Owns (already scaffolded — verify, wire up, migrate)
- `src/db/schema.ts` — all tables, enums, relations, inferred row types.
- `src/db/index.ts` — Neon + Drizzle client (`db`).
- `src/lib/contracts/scoring.ts` — scoring math (single source of truth).
- `src/lib/contracts/validation.ts` — Zod request schemas.
- `src/lib/contracts/api.ts` — response envelope + route ownership map.
- `src/lib/config/app.config.ts` — branding, course meta, deadlines.
- `drizzle.config.ts`, `.env.example`.

## Tasks
1. `npm install`; confirm `npm run typecheck` passes on the seam files.
2. Provision a Neon database; set `DATABASE_URL`.
3. `npm run db:generate` then `npm run db:migrate` — confirm all tables exist.
4. Write `scripts/seed.ts`: one course, 4 weeks, 4 quizzes, and all 40 MCQs from
   the syllabus (10 per week), plus one instructor and one demo student. Deadlines
   come from `app.config.ts` + `cohorts.startsAt`.
5. Unit-test `scoring.ts` exhaustively — it is the highest-leverage code in the
   repo. Cover: quiz bands (70/60/50/<50), late penalty cap at 20%, star
   shortfall, unlock threshold, letter-grade boundaries.

## Acceptance / definition of done
- Migration applies cleanly to a fresh Neon DB.
- `npm run db:seed` populates course + 40 questions idempotently.
- `scoring.test.ts` green with boundary cases.
- Merged to `develop`. Announce "seam frozen" — this unblocks Wave 1.

## Test (e2e)
- Not user-facing; e2e covered by consuming streams. Unit coverage is the gate.
