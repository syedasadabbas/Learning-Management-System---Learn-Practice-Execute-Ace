# Add-on streams — ownership, contracts and prohibitions

The brief every add-on stream builds against. Written 2026-07-30 by the
shared-contracts owner, after the Wave 0′ seam was frozen and merged.

**Why one file and not nine `SKILL.md`s.** The thing that actually makes parallel
agents collision-free is the file-ownership matrix, and it must have exactly one
copy — nine files each restating a slice of it is nine chances for two streams to
believe they own `src/lib/quizzes/`. The per-stream sections below carry
everything a stream needs; the matrix is stated once.

---

## Global rules (all streams)

Read `.claude/skills/HOUSE_RULES.md` first. In addition:

1. **The seam is frozen again.** `src/db/schema.ts`, `src/lib/contracts/*`,
   `src/lib/config/app.config.ts` and `src/db/migrations/**` are off limits. The
   add-on migration `0001` is already applied. If you need a schema change, stop
   and report it — do not add a migration.
2. **Write only inside your allowlist.** If you need something outside it, report
   the need; do not reach across. This is how the previous wave stayed
   collision-free across ten concurrent agents.
3. **Do not edit `CHANGELOG.log`.** Nine concurrent read-modify-writes clobber
   each other. Report your entries in your final message, in the house format,
   and the coordinator appends them.
4. **Free stack only.** `FREE_STACK.md` is authoritative: no paid API, no paid
   key. Piston (`PISTON_URL`, defaults to the free public instance) for
   server-side execution; Web Worker / Pyodide / sql.js in the browser; keyless
   YouTube oEmbed; the org's own SMTP or nothing.
5. **Metric units** everywhere a unit appears; durations in ms.
6. **Tests are part of done.** Vitest for logic, Playwright for the flow. Do not
   run the full e2e suite yourself — a dev server is already running on port 3000
   and the suites share one database and one demo student. Author the specs, run
   only your own, and report.
7. **State facts, offer options.** Where a design choice is open, report the
   trade-off rather than silently picking.

---

## File-ownership matrix

| Stream | Owns (write here only) |
|---|---|
| `code-execution` | `src/lib/execution/**`, `src/app/api/execute/route.ts`, `src/components/execution/**` |
| `account` | `src/lib/account/**`, `src/app/(app)/settings/**`, `src/app/(auth)/forgot-password/**`, `src/app/(auth)/reset-password/**`, `src/app/api/account/**`, `src/lib/mail/**`, `src/components/account/**` |
| `video-ingestion` | `src/lib/videos/**`, `src/app/(staff)/admin/videos/**`, `src/components/videos/**`, `scripts/harvest-videos.ts` |
| `realtime-quiz` | `src/lib/realtime-quiz/**`, `src/components/realtime-quiz/**` |
| `grand-quiz` | `src/lib/grand-quiz/**`, `src/app/(app)/exams/**`, `src/app/api/exams/**`, `src/components/grand-quiz/**` |
| `curriculum-content` | `scripts/content/**` (seed data only — no app code) |
| `coding-problems` | `src/lib/problems/**`, `src/app/(app)/interview/**`, `src/app/(app)/problems/**`, `src/app/api/problems/**`, `src/components/problems/**` |
| `interactive-learning` | `src/lib/learn/**`, `src/app/(app)/learn/**`, `src/components/learn/**` |
| `qa-hardening` | no source ownership — reports findings, applies fixes only where told |

Shared, read-only for everyone: `src/components/ui/**`, `src/components/nav/**`,
`src/lib/guard.ts`, `src/lib/auth.ts`, `src/db/**`, `src/lib/contracts/**`.

Every stream may add its own tests under `tests/e2e/<stream>/` and colocated
`*.test.ts`.

---

## `code-execution` — build first, two streams depend on it

**Delivers.** One internal execution surface with two backends.

- `POST /api/execute` — server-side run via Piston. Body: language, source,
  stdin, and a per-run timeout in ms. `ROUTE_AUTH` is not frozen for this path,
  so guard it with `apiGuard("student")`: signed-in users only, never anonymous.
- Browser runners: Web Worker for JavaScript, Pyodide for Python, sql.js for SQL.
  Lazy-loaded — Pyodide is ~10 MB and must never enter a page's initial bundle
  (the lecture page already went 377 kB → 116 kB by lazy-loading Sandpack; do not
  undo that lesson).

**Requirements.**
- A `runCode()` interface both backends satisfy, so callers do not branch on
  backend. Return shape carries stdout, stderr, exit status, runtime in ms, and a
  discriminated failure reason (`timeout` | `unsupported_language` |
  `backend_unavailable` | `rate_limited`).
- **Never throw at a caller.** Grand-quiz submission calls this during an exam; a
  rejected promise there costs a student their marks. Every failure is a value.
- Piston is rate-limited on the public instance. Treat `429` as
  `rate_limited`, and make that distinguishable from a wrong answer — the
  grand-quiz stream defers those items to instructor grading rather than scoring
  them zero.
- Per-user rate limiting of your own, so one student cannot exhaust the shared
  public instance for the cohort.
- Cap and truncate stdout/stderr before returning; an infinite print loop must
  not become a multi-megabyte response.

**Prohibitions.** Never `eval` untrusted code in the Node process. Never pass a
student's language string straight through to Piston — map it through an
allow-list.

**Tests.** Unit-test the language allow-list, the truncation, the timeout
mapping, and every failure branch with `fetch` injected. No network in unit tests.

---

## `account` — profile, password change, password reset

**Delivers.** `/settings` for all three roles; `/forgot-password`;
`/reset-password`.

**Requirements.**
- Profile edit: name, avatar URL, bio, GitHub and LinkedIn. Email and **role are
  not editable** — a self-service role change is privilege escalation. Validate
  with Zod; the existing columns already exist.
- Password change requires the **current** password, verified with bcrypt, even
  though the user holds a session. A stolen session must not be upgradable into a
  permanent account takeover.
- Reset flow: request → token → set new password. Store only `sha256(token)` in
  `auth_tokens` (the column is already there); 30-minute expiry; single-use via
  `used_at` inside the consuming transaction; invalidate that user's other
  outstanding reset tokens on success.
- **The request endpoint must not reveal whether an email exists.** Same response
  and comparable timing either way.
- Mailer behind an interface with two transports: Nodemailer over the org's own
  SMTP when `SMTP_*` is set, and a dev transport that logs the link otherwise.
  Nothing may crash when SMTP is unset — that is the default state.
- Rate-limit reset requests per email and per IP.

**Prohibitions.** Do not touch `src/lib/auth.ts` or `src/middleware.ts`; report
if you believe you need to.

**Tests.** Token hashing, expiry boundary, single-use, the no-enumeration
property, and that a wrong current password is refused. E2E the full reset using
the dev transport.

---

## `video-ingestion` — keyless, review-gated

**Delivers.** `scripts/harvest-videos.ts`, an admin review screen at
`/admin/videos`, and the read model the lecture view uses.

**Requirements.**
- Two sources, no API key: a curated ID list (CSV or JSON supplied by staff) and
  optional channel RSS (`youtube.com/feeds/videos.xml?channel_id=…`).
- Validate **every** ID through the keyless oEmbed endpoint
  (`youtube.com/oembed?url=…&format=json`), which both proves the ID resolves and
  yields title and channel for the review screen. A 404 there means reject, not
  store.
- Rows land `candidate`. Only `approved` renders to a student. Approval records
  `reviewed_by`/`reviewed_at`.
- Re-running the harvester must be idempotent — the unique index on
  `(topic_key, youtube_id)` is there for it.
- **Invent nothing.** If no candidate exists for a topic, the lecture keeps its
  existing "video coming soon" placeholder, which is already built.

**Known limit to state plainly in your report.** Channel RSS returns only a
channel's ~15 most recent videos, so it cannot cover 40+ specific topics.
Curated IDs are the primary path; RSS is a supplement.

**Tests.** oEmbed validation with `fetch` injected (no network), the idempotent
re-harvest, and that a `candidate` row never reaches a student-facing payload.

---

## `realtime-quiz` — inline, ungraded

**Delivers.** An inline knowledge-check component for lecture pages, backed by
`quizzes.kind = 'realtime'`.

**Requirements.** Instant per-question feedback; **no marks, no penalties, no
leaderboard events, no progress writes**. It must be impossible for a realtime
quiz to affect a grade — that is its entire distinction from the other two kinds.
Attempts are unlimited. Keep it accessible: answers reachable by keyboard, result
announced via a live region.

**Prohibitions.** Do not call `onScoringEvent`, do not write `progress`, do not
touch `src/lib/quizzes/**` (that is the practice engine).

**Tests.** That taking one writes no progress row, fires no scoring event, and
changes no leaderboard total.

---

## `grand-quiz` — the exam; strictest stream

**Delivers.** `/exams/[weekId]`, `POST /api/exams/...` start / autosave / submit,
and the result view.

**Requirements.** Implement `docs/GRAND_QUIZ_INVARIANTS.md` I1–I6 exactly; read
it before writing code. In particular:
- Start is idempotent and one-attempt-only, relying on the unique index rather
  than a read-then-write check.
- `deadline_at` computed server-side at start, never updated, never taken from a
  client.
- Autosave upserts on `(attempt_id, question_id)` and is refused once status is
  terminal.
- Submit inserts a row for **every** question — unanswered ones with no selection
  and `awarded = 0`.
- `awarded` clamped to `[0, max_points]`; score is the SUM; no negative marking.
- The submit response carries the score, per-question outcomes, and a deferred
  count; label the total provisional only while deferred items exist.
- Expiry has three independent triggers, because any one alone fails: a client
  auto-submit, a lazy finalize whenever an expired attempt is read, and a cron
  sweeper. All three must converge on the same result — submission is idempotent
  (I3), which is what makes that safe.
- Free-form code items go to Piston; on `rate_limited` or `backend_unavailable`
  they are **deferred to instructor grading**, never scored zero.

**Prohibitions.** Do not modify `src/lib/quizzes/**`. Reuse
`src/lib/contracts/scoring.ts` for any band or threshold; introduce no second
copy of that maths.

**Tests.** One test per invariant minimum, including the two concurrency cases
(double start, double submit) and the expiry-with-skewed-clock case.

---

## `curriculum-content` — seed data only

**Delivers.** Under `scripts/content/`: four 50-question grand quizzes (mixed
MCQ / code-reading / code-correction / free-form code, weighted via
`questions.points` to a sensible total), plus content for the new tracks: OOP,
Database Management, DSA, Prompt Engineering, Claude usage, building with LLMs,
Cryptography, Cybersecurity.

**Requirements.**
- Validate before writing, as `scripts/seed-content.ts` already does: exactly one
  correct option per MCQ, every question's points > 0, 50 questions per grand
  quiz, every `code_write` question carrying at least one test.
- Idempotent by natural key, like the existing seed.
- **Original prose only.** No pasted LeetCode/HackerRank statements.
- **Cybersecurity is defensive and sandboxed only**: input validation, secure
  headers, hashing, XSS demonstrated inside a sandboxed iframe against our own
  fixture. No operational exploit against any real target.
- Cryptography labs use browser `SubtleCrypto`.

**State plainly in your report** that this content was authored from
`appConfig.course.description` and general curriculum knowledge, **not** from the
owner's syllabus document, which has still not been supplied — so it needs review
before a cohort sees it.

---

## `coding-problems` — practice + interview banks

**Delivers.** `/problems` and `/interview`, problem view with editor, run against
visible tests, submit against all tests, level progression.

**Requirements.** Original statements only. Completion is **derived** from
`coding_attempts` (a passing run exists) — do not add a `solved` flag. Hidden
tests must never appear in a client payload; only visible ones are sent. Level
progression (beginner → intermediate → advanced) is derived from completion
counts per track. Tracks: JavaScript, Python, HTML, CSS, C++, SQL, and agentic/AI.
C++ runs via Piston or, if unavailable, is presented with reference solution and
no execution.

**Tests.** The hidden-test barrier (assert absence after a JSON round-trip, as
`src/lib/quizzes/payload.test.ts` does), and the derivation of completion.

---

## `interactive-learning` — the concept tracks

**Delivers.** `/learn`, track and module views, stepped modules with try-it labs,
per-step completion.

**Requirements.** Steps are `explain` | `lab` | `check`. Labs use the browser
runners only — a concept lab must work with no server and no Piston. Per-step
completion so a closed tab loses nothing. Unpublished modules are invisible to
students. Respect `prefers-reduced-motion` in every animated explainer, degrading
to a static diagram rather than removing information — the existing
`src/lib/exercises/reduced-motion.ts` sets the precedent and the rule.

---

## `qa-hardening` — the release gate

**Delivers.** A findings report, not a refactor.

Review every add-on stream against: the invariants in
`docs/GRAND_QUIZ_INVARIANTS.md`; the answer-key and hidden-test barriers; the
no-negative-marking and no-overstated-score properties; authorization on every
new route and server action (a server action is a public POST target); absence of
`passwordHash` from any payload; and no fabricated content or invented video IDs.

Report each finding with file, line, the concrete failure scenario, and severity.
Apply fixes only where the coordinator says so.
