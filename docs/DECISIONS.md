# Decisions record

Captures the Pre-Development Decisions you supplied, the architectural
implications, and the items still open. Facts stated; open choices left to you.

## Locked by you
| Area | Decision | Implication in this scaffold |
|---|---|---|
| Team | "Claude" (subagents, spec-driven, parallel) | Work split into 12 SKILL.md streams + a frozen seam so streams parallelize. |
| Students / cohort | 50-80 | `cohorts` table; indexes sized for this; leaderboard denormalized. |
| Hosting | Vercel | Unified Next.js 15 app (route handlers = serverless fns). No separate backend. |
| Database | Neon | Drizzle + `pg` (node-postgres) over the Neon **pooled** endpoint. See the driver note below. |
| File storage | Google Form + Sheet | No upload service. `assignments` hold Form + published-CSV urls; `submissions` ingested idempotently from the sheet. |
| Repo name | `lms-internship-platform` | Matches `package.json`. |
| Git remote | Local only for now | `main` + `develop` + `feature/*` are real and enforced; no remote pushed. Adding one later is a one-command change. |
| Grade ceiling | Derived from config | `courseMaxScore()` = `durationWeeks * WEEK_MAX + FINAL_PROJECT_MAX` (310 for a 4-week course). |
| Build cadence | Autonomous through Wave 3 | Waves gate internally; report at the end or on a blocker. |

## Environment facts established during Wave 0
| Item | State |
|---|---|
| Node.js | **24.18.0 LTS** installed via winget. Nothing existed on the machine before; `engines.node` is set to `>=20.9.0`. |
| Neon database | Live — PostgreSQL 18.4, `neondb`. Migration `0000` applied: **16 tables, 7 enums**, verified by an independent client, not just the migration tool's own report. |
| Seed | Idempotent. 4 weeks, 12 lectures, 4 quizzes, **40 MCQs**, 4 assignments, 3 demo accounts. Re-running creates nothing. |
| Verification | typecheck clean · lint clean · **65/65** unit tests · **3/3** e2e · `next build` passes. |

## Architectural implications worth noting (not choices you made — consequences)
- **Vercel + Neon => Next.js, not React+Express.** The earlier plan's separate
  Express server fits poorly on Vercel; a unified Next.js app deploys natively
  and shares types across client/server. Stack is now: Next.js 15 (App Router,
  React 19) + TypeScript + Tailwind v4 + Drizzle + Neon + Auth.js v5 + Zod +
  Sandpack (live editor) + Vitest/Playwright.
- **W3Schools "Try it Yourself" cannot be iframed** (it sends X-Frame-Options).
  So: course-content links OUT to W3Schools; interactive-exercises provides an
  in-app Sandpack equivalent for embedded live practice. Both requests are met,
  just split across the two mechanisms that actually work.
- **Google Sheet ingestion is pull-based and idempotent** (unique index on
  assignment + sheet row ref). Re-running ingest never duplicates.
- **The database driver is node-postgres, not neon-http.** The HTTP driver has
  no interactive transactions, but submitting a quiz must write attempt +
  answers + progress + unlock atomically — a half-applied write leaves a student
  with a recorded attempt and no unlock, repairable only by hand. node-postgres
  over the `-pooler` (PgBouncer) endpoint gives real transactions and lets CI run
  the *same* code path against a throwaway `postgres:18` service. Cost: a TCP+TLS
  connect on a cold invocation is slower than one HTTP round trip; PgBouncer
  absorbs the churn, and 50-80 students is not a load it notices.
- **Auth.js must use the JWT session strategy.** The schema has no `sessions` or
  `accounts` tables, so there is no database adapter to fall back on. This is a
  constraint on the auth stream, not a preference.
- **Ingestion is split into two routes.** A Vercel cron job cannot supply a path
  parameter, so `POST /api/cron/ingest-submissions` (CRON_SECRET-gated) sweeps
  all active assignments, while `POST /api/assignments/:id/ingest` is a
  staff-triggered manual re-ingest.
- **The live editor's preview is rendered by a third party, not by us.**
  Established 2026-07-30 by reading `@codesandbox/sandpack-client`: the `static`
  template mounts its preview iframe from
  `https://preview.sandpack-static-server.codesandbox.io`. Three consequences,
  all factual, none yet decided on:
  1. **Student code leaves the app.** Whatever a student types in a practice
     exercise is handed to CodeSandbox's preview service to render. It is
     coursework, not personal data, and the editor carries no marks — but it is
     an external processor, so it belongs in any privacy notice the cohort is
     given.
  2. **The practice page needs public internet egress** to `codesandbox.io` to
     preview anything. On a locked-down network the editor mounts and the code
     is editable, but the preview pane stays blank.
  3. **It made an e2e test flaky.** The live-preview spec timed out twice at
     ~30 s and passed on the third attempt in 3.3 s once the remote assets were
     warm. The per-test budget for those cases is now 90 s
     (`EDITOR_TEST_TIMEOUT_MS`), which treats remote latency as latency rather
     than as a defect. CI in a network-restricted runner will still fail them.

  Self-hosting the static preview server, or vendoring it, is the only way to
  remove the dependency. Not attempted: it is a deployment decision, not a code
  change.

## Defects found and fixed in the seam before freezing
Recorded because these were live bugs, not stylistic choices:
1. `letterGrade` used a hardcoded ceiling of `330` with a comment claiming
   `360`; the real total is `4 * 70 + 30 = 310`. Every letter grade was deflated
   by roughly 6% — a student on 279 points scored an A but was graded B.
2. `letterGrade` divided by the ceiling with no guard, so a `0` ceiling produced
   `NaN`, which compares false against every band and reached `F` only by
   accident.
3. `courseMaxScore`'s parameter was inferred from `appConfig` (`as const`), which
   narrowed it to the literal type `4` and rejected any caller passing a variable
   week count. Caught by typecheck once the tests existed.
4. `POST /api/assignments/:id/ingest` writes submission rows and had **no stated
   authorization** — any visitor could trigger ingestion. Now covered by
   `ROUTE_AUTH`, typed as `Record<RouteKey, RouteAuth>` so an unclassified route
   is a compile error rather than an accidental public endpoint.
5. `next lint` is deprecated in Next 15 and **prompts interactively** when no
   config exists, which would have hung CI indefinitely instead of failing it.
   Replaced with the ESLint CLI and a flat config.

## Blocks launch, not the build — ten blanks still unanswered
These were left as `___` in the Pre-Development Decisions form. Every one lives
only in `app.config.ts` or seed data, so no code path depends on the value and
the build is unaffected. They must be settled before a real cohort enrols:

**app name · logo (yes/no) · brand colours · course description source ·
instructor count · concurrent cohorts · Week 1 start date · assignment due
dates · grace period (0-3 days) · final project deadline**

Two further content gaps, both marked `TODO(content)` in `scripts/seed-content.ts`:
- **No YouTube video IDs.** Every `lecture.youtubeUrl` is `null`. Inventing IDs
  would produce embeds that 404, so the course owner must supply real ones; the
  course-content stream renders a placeholder until then.
- **The curriculum was authored from `app.config.description`, not from the
  original syllabus document**, which was not available. Question wording and
  week ordering need review against that syllabus.

And one security item:
- **`TODO(security)` in `scripts/seed.ts`** — the three demo accounts share the
  known password `Passw0rd!demo`. A live instructor account with a published
  password would let anyone grade submissions. Delete or rotate before launch.
- The Neon connection string was shared in chat, so it exists in that
  conversation history. Rotating it in the Neon dashboard before production is
  worth considering.

## Still open (does NOT block the build — all are config or data)
All of these live in `src/lib/config/app.config.ts` or in seed data, marked
`TODO(decision)`. Editing one file changes them; no code depends on the values.

| Item | Placeholder in scaffold | Where to set |
|---|---|---|
| App name | "Code Queens LMS" | app.config.ts → branding.appName |
| Logo | `/public/logo.svg` (file not yet supplied) | drop the file in |
| Brand colors | indigo #4f5bd5 / amber #f4b942 (from syllabus cover) | app.config.ts → branding.colors |
| Course description | syllabus-derived default | app.config.ts → course.description |
| Cohorts concurrent? | false (one at a time) | app.config.ts → course.concurrentCohorts |
| Week 1 start date | 2026-09-01 placeholder | app.config.ts → schedule + cohorts.startsAt |
| Assignment due dates | +7/+14/+21/+28 days from start | app.config.ts → schedule.weekDueOffsetsDays |
| Grace period | 2 days | app.config.ts → schedule.gracePeriodDays |
| Final project deadline | +28 days | app.config.ts → schedule.finalProjectDueOffsetDays |
| Instructor count | role-based; unlimited | seed instructors as `role = "instructor"` |
| GitHub account type | repo initialized locally, no remote yet | org account is better for multiple maintainers; personal works for solo |

## Feature phasing (as you prioritized)
- **MVP (must-have):** auth, course structure + unlock, lectures with YouTube +
  W3Schools links, interactive exercises + live editor + animated concepts,
  auto-graded MCQ quizzes, progress tracking, simple leaderboard, dashboard.
- **Should-have:** submissions (Google Form/Sheet), instructor grading + stars +
  feedback, penalties, attendance, advanced leaderboard.
- **Nice-to-have:** richer interactive code editor, certificates.
  (Certificates and any AI assistant are out of scope for this scaffold.)
