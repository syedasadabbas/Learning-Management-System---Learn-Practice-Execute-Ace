# Decisions record

Captures the Pre-Development Decisions you supplied, the architectural
implications, and the items still open. Facts stated; open choices left to you.

## Locked by you
| Area | Decision | Implication in this scaffold |
|---|---|---|
| Team | "Claude" (subagents, spec-driven, parallel) | Work split into 12 SKILL.md streams + a frozen seam so streams parallelize. |
| Students / cohort | 50-80 | `cohorts` table; indexes sized for this; leaderboard denormalized. |
| Hosting | Vercel | Unified Next.js 15 app (route handlers = serverless fns). No separate backend. |
| Database | Neon | Drizzle + `pg` (node-postgres) over the Neon **pooled** endpoint; CI uses Neon DB branching. |
| File storage | Google Form + Sheet | No upload service. `assignments` hold Form + published-CSV urls; `submissions` ingested idempotently from the sheet. |

> **Corrected 2026-07-30.** The Database row above previously read
> "Drizzle + `@neondatabase/serverless`". That is the neon-http driver, and it was
> deliberately abandoned during Wave 0 because **it has no interactive
> transactions** — see the driver note below, defect 6 in `docs/DECISIONS.md`, and
> the header of `src/db/index.ts`. The grand quiz needs that atomicity even more
> than the practice quiz does: one attempt, up to 50 answers, a score and a
> finalize must commit or roll back as a single unit. The line was corrected
> rather than left standing, because an add-on stream following it would have
> reintroduced a known and already-fixed defect.
>
> Note also that `docs/DECISIONS.md` is the fuller record — it carries the Wave
> 0-3 defect history and the environment facts. Where the two disagree, the code
> and `docs/DECISIONS.md` win.

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

---

## v2 additions (advanced scope) — now FULLY FREE / keyless
Superseded by `FREE_STACK.md` (authoritative). No paid APIs or keys anywhere.

| Item | Free choice | Needs |
|---|---|---|
| Code-execution backend | Piston (open source): public keyless instance, or self-host via Docker for load | set `PISTON_URL` (defaults to the free public one). Never run untrusted code in-process. |
| Practice / lab runs | In-browser Web Worker (JS), Pyodide (Python), sql.js (SQL) | none — runs in the browser, free + unlimited. |
| YouTube videos | Curated IDs validated via keyless oEmbed; optional channel RSS | no key. Embed by ID via free IFrame. Data API dropped. |
| Password-reset email | Nodemailer via the org's OWN free SMTP (e.g. Gmail app password); admin-mediated fallback if unset | `SMTP_*` (own mailbox) or nothing. Resend dropped. |
| Grand-quiz sweeper | Free GitHub Actions cron (or Vercel Cron hobby) + lazy finalize | `CRON_SECRET` (own random value). |
| Cybersecurity content | defensive, sandboxed labs only | confirm scope; no operational exploits against real targets. |
| Coding problem text | original statements only | do not paste proprietary LeetCode/HackerRank text. |

## Correctness posture ("bug-proof")
Not claimed as bug-proof — instead the risky parts are correct-by-construction
and test-gated: grand-quiz invariants I1-I6 (validated 16/16), idempotent
submit/ingest via unique indexes + transactions, server-authoritative timing,
untrusted-code isolation, and the qa-hardening agent pass as the release gate.

---

## Learning-enhancement wave — schema decisions (2026-08-01, `feature/lms-complete-enhancement`)

Recorded because in each case the spec was silent, ambiguous, or in tension with
what already exists, and the rule is "prefer what exists".

| Point | Spec said | Decided | Why |
|---|---|---|---|
| Column naming | `LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md` §1.2 uses snake_case **TypeScript keys** (`week_id: integer('week_id')`) | camelCase TS keys, snake_case SQL names | Every table in `src/db/schema.ts` and in all ten sibling modules does this. A snake_case island would be the only place a query reads differently. |
| Presentation submission status | `ENUM('submitted','under_review','graded')` | reuse the existing `submission_status` pgEnum | It already has those three labels plus `'returned'`. A second enum gives the instructor queue two spellings of "graded". `'returned'` is simply unused by this surface. |
| Difficulty / execution | `proficiency_level`, `executionMode` referenced by name | reuse `proficiency_level` and `execution_mode` from `schema.ts` | They exist (schema.ts:61, 86). A parallel varchar is a filter that returns nothing the day someone writes `'Beginner'`. |
| `interview_questions` parentage | two conditional `UNIQUE ... WHERE` clauses, no rule about which parent | two **partial** unique indexes plus `CHECK ((lecture_id IS NULL) <> (week_id IS NULL))` | A plain composite unique does not constrain the NULL half at all in Postgres. The CHECK makes the exclusivity the spec implies actually true. |
| `slides_json` vs `presentation_slides` | both specified, relationship unstated | `slides_json` is the editor document and WINS; `presentation_slides` is its queryable projection | Two sources of truth with no stated precedence is the defect. Rule is recorded in the module header and at the save call site. |
| `practice_problems` vs existing `coding_problems` | spec unaware of `coding_problems` | kept separate | `coding_problems` are graded, standalone, with an attempts ledger; these are ungraded, per-lecture, with hints and a published solution. Merging means half the columns null for half the rows. |
| `class_attendance` vs existing `attendance` | spec unaware of `attendance` | kept separate | The existing table is per-LECTURE and manually marked; this is per live SESSION and written by the join handler. Merging makes the existing unique key ambiguous. |
| Columns on `lectures` / `assignments` / `questions` | `ALTER TABLE ... ADD COLUMN` | added directly to the frozen `src/db/schema.ts` | A column cannot live outside its table; the sibling-module rule covers new TABLES. Precedent: the add-on wave did exactly this (`lectures.topic_key`, `questions.points`, `questions.tests`) under a `// --- add-on wave ---` marker. All seventeen are nullable or defaulted, so nothing downstream breaks. |
| Primary keys | `SERIAL` in the SQL, mixed in the Drizzle sketch | `serial` + integer FKs throughout | Same argument as `schema.peer-review.ts`: every table in the repo is `serial`, and a uuid island needs its own join casts. |
| `class_recordings.class_id` | `.unique().references(() => liveClasses.id)` with no `onDelete` | `cascade` + explicit `uniqueIndex` | A recording of a deleted class is unreachable. The named unique index is also the ON CONFLICT target the ingest job needs. |
