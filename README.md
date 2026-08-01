# LMS — Code Queens Hub Web Development Internship

A Next.js learning platform: sequential week unlocking, auto-graded MCQ quizzes,
live in-browser coding practice, Google-Form assignment ingestion, instructor
grading, penalties, and a cohort leaderboard.

## Stack
Next.js 15 (App Router, React 19) · TypeScript · Tailwind v4 · Drizzle ORM ·
Neon Postgres (via node-postgres over the pooled endpoint) · Auth.js v5 · Zod ·
Sandpack · Vitest · Playwright · Vercel.

Requires **Node.js >= 20.9** (developed on 24.18.0 LTS).

## Getting started
```bash
npm install
cp .env.example .env        # fill DATABASE_URL (Neon), AUTH_SECRET, CRON_SECRET
npm run db:migrate          # applies src/db/migrations to the database
npm run db:seed             # 4 weeks, 12 lectures, 40 MCQs, 4 assignments, 3 demo users
npm run dev                 # http://localhost:3000
```

`db:seed` is idempotent — running it repeatedly creates nothing new, which is
why CI can run it before every e2e job.

Use `npm run db:generate` only after editing `src/db/schema.ts`; it writes a new
migration rather than applying one.

### Demo accounts
All three share the password `Passw0rd!demo`:

| Email | Role |
|---|---|
| `student@codequeenshub.test` | student |
| `instructor@codequeenshub.test` | instructor |
| `admin@codequeenshub.test` | admin |

These are development accounts. See the `TODO(security)` in `scripts/seed.ts` —
delete or rotate them before a real cohort enrols.

## Verifying
```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . (flat config; `next lint` is deprecated)
npm test             # Vitest unit + component tests
npm run test:e2e     # Playwright; starts a server itself
```

Playwright needs its browser once: `npx playwright install chromium`.

E2E runs against a **real, seeded database**, because the behaviour under test
(week unlocking, attempt limits, late penalties) *is* database state. Specs run
serially for that reason — parallel workers sharing one demo student would
exhaust the 3-attempt quiz limit unpredictably.

## How the build is organized
This repo is spec-driven. The parallelizable work is defined as skills in
`.claude/skills/`, one per stream, against a frozen seam:
- `src/db/schema.ts` — database schema + types
- `src/lib/contracts/*` — scoring, validation, API route map + authorization
- `src/lib/config/app.config.ts` — branding, course meta, deadlines

Read `docs/BUILD_ORCHESTRATION.md` for the dependency waves and what runs in
parallel, and `docs/DECISIONS.md` for locked vs open decisions, the driver
trade-off, and the defects found in the seam before it was frozen.

### Two constraints worth knowing before you write code
- **Authorization comes from `ROUTE_AUTH`** in `src/lib/contracts/api.ts`, typed
  as `Record<RouteKey, RouteAuth>` — every route must be classified or the build
  fails. `public` is an explicit, reviewed choice, never a default.
- **Auth.js uses the JWT session strategy.** There are no `sessions`/`accounts`
  tables, so there is no database adapter to fall back on.

## Deploying, and the add-on wave

Three features — learning enhancements, live classes, presentations — landed in
the add-on wave behind environment flags that **default to off**. Four documents
cover them; read them in this order:

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — migration state (`0006` and `0007` are
  already applied to production), every environment variable, the rollback
  story, the recommended rollout order, and a post-deploy verification
  checklist.
- **[DEPLOYMENT_LIVE_CLASSES.md](./DEPLOYMENT_LIVE_CLASSES.md)** — the standalone
  Socket.io service in `services/realtime/`: hosting, cost, and its own
  environment. Section 9 is the current-state addendum.
- **[SECURITY_REVIEW_ADDON_WAVE.md](./SECURITY_REVIEW_ADDON_WAVE.md)** — findings
  with severities and line numbers, and the list of things that were checked and
  found clean. Two Medium authorization gaps are preconditions on enabling
  features, not footnotes.
- **[RELEASE_NOTES_ADDON_WAVE.md](./RELEASE_NOTES_ADDON_WAVE.md)** — what shipped
  and, at greater length, **what is not verified**. Lighthouse and accessibility
  targets are unmeasured; read it before telling anyone the wave is done.

Schema detail is in [SCHEMA_ENHANCEMENT.md](./SCHEMA_ENHANCEMENT.md); decisions
in [DECISIONS.md](./DECISIONS.md).

## Conventions
See `.claude/skills/HOUSE_RULES.md` — change log, git/PR workflow, mandatory
end-to-end tests, metric units.

Every change gets a line in `CHANGELOG.log` with a justification. Branches are
`feature/<skill-name>` off `develop`; `main` is production.
