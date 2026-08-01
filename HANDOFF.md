# HANDOFF — resume here

Rewritten 2026-07-30. Everything below is verified fact unless marked
UNVERIFIED. The 2026-07-29 version of this file is superseded; where it
disagrees with this one, this one is right (one of its central claims was
wrong — see "Corrections" at the bottom).

## State in one paragraph

All 10 feature streams are built, integrated, verified and **committed**. The
working tree is clean. `develop` carries one merge commit per stream plus an
integration commit, in dependency order. The full gate is green: typecheck,
lint, 786 unit tests, and 140 e2e specs across the two required runs, with 0
failures.

```
branch:      develop
uncommitted: nothing
last verify: 2026-07-30 — typecheck ✓ lint ✓ 786/786 unit ✓
             e2e group 1: 123 passed / 6 skipped / 0 failed (1 flaky, see below)
             e2e group 2:  17 passed / 0 failed
```

---

## HOW TO RUN THE GATE

```powershell
# Every PowerShell call needs this prefix — the tool shell has a stale PATH.
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
Set-Location "C:\Users\HP Zbook G9\Downloads\files (3)\lms-scaffold\lms"

npm run typecheck; npm run lint; npm test
npm run db:smoke         # every stream's REAL SQL against Neon, 9 checks
```

E2E, in this order — **the order is load-bearing**:

```powershell
npm run db:seed          # idempotent
npm run db:reset-demo    # returns student@codequeenshub.test to zero activity
$env:CI = "true"         # <-- REQUIRED, see hazard below

# Group 1: everything except the destructive quizzes spec
npx playwright test tests/e2e --project=chromium --grep-invert "grading, unlocking, attempt limit"

npm run db:reset-demo    # again, before the destructive spec

# Group 2: consumes ALL THREE Week-1 attempts (fail -> pass -> exhaustion)
npx playwright test tests/e2e/quizzes --project=chromium
```

**Why `CI=true` matters:** `next dev` and `next start` share `.next`. If a dev
server runs while a production server is serving, the dev build replaces the
production output and every hashed chunk the already-served HTML references
returns **400**. Nothing appears in the server log, pages still render, but no
client JS loads — so only interactivity tests fail and it looks exactly like a
hydration bug. `CI=true` makes Playwright build and start its own server, so
build and server cannot disagree. Documented in `playwright.config.ts`.

`workers` is **1 everywhere**. It was `CI ? 1 : 2`, which contradicted its own
comment and caused false failures (progress-tracking asserted "later weeks
locked" while the quizzes spec unlocked Week 2 in the other worker).

---

## Environment (already done, don't redo)

- **Node 24.18.0 LTS** installed via winget. Nothing existed before.
- **Neon is live** — PostgreSQL 18.4, `neondb`. Migration `0000` applied:
  16 tables, 7 enums. `.env` is populated and gitignored.
- Playwright chromium browser installed.

Bash tool equivalent of the PATH prefix: `export PATH="/c/Program Files/nodejs:$PATH"`.

**Rotate the Neon credential before production** — it was pasted in chat, so it
lives in that conversation history.

---

## Git state

Twelve commits on `develop`, merged with `--no-ff` in dependency order:

```
shared-contracts-events -> auth -> ui-shell -> course-content -> quizzes
-> interactive-exercises -> submissions -> progress-tracking -> leaderboard
-> penalties-attendance -> instructor-admin -> chore/integration
```

The feature branches still exist locally and can be deleted once you are
satisfied with `develop`.

**No PRs were opened, because there is no git remote** (DECISIONS.md records
"local only for now"). House rule 3 asks for a PR into `develop`; the merges
are the local equivalent. Adding a remote and pushing is a one-command change,
after which the rule can be followed literally.

`main` is untouched and still sits at the Wave 0 merge. Promoting `develop` to
`main` is your call, not something done unasked.

---

## WHAT'S LEFT

### 1. The 6 skipped e2e specs, and why each skips
Not one of them is a failure in disguise. Three are blocked on content you must
supply; three are conditional guards that would pass given the right data.

| Spec | Why it skips |
|---|---|
| `submissions` × 3 (cron auth × 2, fixture ingest) | Both Google URLs are `null`, so there is nothing to ingest. |
| `instructor-admin` — 4-star grade | No ingested submission exists to grade (same root cause). |
| `leaderboard` — single-student board | The cohort has 3 ranked students, not exactly 1. Correct skip. |
| `penalties-attendance` — student notices | Needs an instructor-issued penalty in the seed. |

### 2. One flaky spec, cause identified
`interactive-exercises` → "typing HTML updates the preview iframe" failed at
30.1 s, again at 30.3 s, then passed in 3.3 s. Cause: Sandpack's `static`
template renders its preview from **`preview.sandpack-static-server.codesandbox.io`**
— a third-party origin — so the test depends on public internet egress and on
that service's latency. The per-test budget for live-editor cases is now 90 s.
Full consequences (including that student-typed code leaves the app, and that a
network-restricted CI runner will fail these specs) are recorded in
`docs/DECISIONS.md`.

### 3. `GET /api/me/submissions` is UNVERIFIED
Created at integration; no test covers it. Everything else has at least one.

### 4. CHANGELOG.log is complete
All ten streams' entries are appended (the streams were barred from editing the
file concurrently — ten read-modify-writes would have clobbered each other).
The eight reconstructed blocks are marked as such in the file and are derived
from the code, not from agent summaries.

---

## DECISIONS WAITING ON YOU (do not let an agent silently pick)

1. **A submitted-but-UNGRADED assignment scores full 40/40.**
   `scoring.assignmentPoints` treats `stars: null` as "not yet rated", so a
   student's score *drops* when an instructor grades them, and dashboards plus the
   leaderboard overstate scores during grading. Changing it is a seam change.

2. **Google Forms date format — silent-wrongness risk.** Submissions parses
   month-first slashed dates only. A day-first locale misreads `8/9/2026`, and the
   two are indistinguishable for days 1–12, so it fails silently with wrong late
   penalties. "Code Queens Hub" suggests a DD/MM locale. Also `NAIVE_TIMESTAMP_IS_UTC`
   assumes zoneless Forms timestamps are UTC — confirm the real sheet's timezone.

3. **No manual/admin unlock.** Unlock is derived purely from quiz percentages, so
   staff cannot open a week for illness or an appeal.

4. **No `cohorts.courseId`.** "The student's course" resolves by matching
   `appConfig.course.title` with a lowest-id fallback. Exact for one course, wrong
   the day a second exists — ties directly to your unanswered "concurrent cohorts".

5. **Leaderboard weekly awards are not exactly repeat-immune.** `final_project`
   uses `max()` and all components are clamped to `scoring.ts` ceilings, so damage
   is bounded, but a duplicated weekly award can inflate a component up to its
   ceiling. This was hit for real in the seed (totals doubled on a second run) and
   fixed by deleting the board row before re-firing events. Exact immunity needs
   a per-`(source, week)` ledger. `rebuildLeaderboard(cohortId)` is the repair path.
   A *downward* final-project regrade also needs it.

6. **`penalties` has no `resolvedBy` column** — no audit trail of who cleared a
   penalty.

7. **No HTTP endpoints for penalties/attendance.** Frozen `ROUTES` has none;
   penalties-attendance requested 6. Callers currently use
   `@/lib/penalties/service` and `@/lib/attendance/service` directly.

8. **`multiple_select` unsupported** by `quizSubmitSchema` and the `answers` table.
   All 40 seeded questions are `mcq`, so nothing mis-grades today.

9. **Vercel Cron uses GET, `ROUTE_AUTH` says POST** for
   `/api/cron/ingest-submissions`. Submissions exports both with identical
   `requireCron`. Reconcile the contract or document it.

10. **Gate `/practice` by week unlock?** Left ungated deliberately — it carries no
    marks, and re-deriving unlock there would be a second source of truth.

11. **Self-host the Sandpack static preview server?** New, from the flake above.
    Today every practice exercise's preview is rendered by CodeSandbox. It is a
    deployment decision, not a code change.

---

## CONTENT YOU MUST SUPPLY

- **YouTube video IDs.** Every `lecture.youtubeUrl` is `null`. No IDs were
  invented — fabricated ones produce embeds that 404. The embed path is complete
  and switches on automatically the moment a real ID lands.
- **The real syllabus.** The 40 MCQs and week ordering were authored from
  `appConfig.course.description`, not your syllabus document. Needs review.
- **Google Form URL + published-CSV URL** per assignment. Both `null`, so
  submissions cannot be ingested and 4 e2e tests skip. Live-Sheet ingestion is
  **unverified**: the real Form's header text, the sheet's timestamp format and
  timezone, and whether `docs.google.com` 307-redirects to `googleusercontent.com`
  as `fetch-csv.ts` assumes.
- **Ten `app.config.ts` blanks**, still `___` from your form: app name, logo,
  brand colours, course description source, instructor count, concurrent cohorts,
  Week 1 start date, assignment due dates, grace period, final project deadline.
  None blocks the build; all block launch.
- **`TODO(security)` in `scripts/seed.ts`** — demo accounts share the published
  password `Passw0rd!demo`, including an **instructor** account. Delete or rotate
  before a real cohort.
- **`TODO(ops)`** — `e2e-%` users accumulate in live Neon from auth's e2e runs.

---

## Corrections to the 2026-07-29 handoff

That file said the in-flight edit to `src/lib/exercises/diagnostics.ts` fixed a
real product bug: that `diagnoseFiles` rejected Sandpack's `{ code }` file shape,
leaving the in-editor diagnostics panel permanently silent. **That diagnosis was
wrong.** `LiveEditor`'s `EditorDiagnostics` already flattened `{ code }` to plain
strings before calling in, and the panel was confirmed working live end-to-end —
it emits both the missing-asset error and the tag-balance warning as the student
types.

The real cause of the failing spec: CodeMirror's html mode runs `autoCloseTags`,
so typing `<div>` inserts `</div>` immediately. The document was balanced, the
linter was correct to stay silent, and the assertion could never pass. It was a
**spec bug**, not a product bug — the fifth one in this project to present as a
product bug. The spec now types `<script src="nope.js">`, whose missing-asset
check reads the `src` attribute rather than tag balance and so fires regardless
of autoclose.

The `sourceOf()` helper was kept — accepting both shapes is cheap and the
`files: unknown` signature invites a caller to pass `sandpack.files` straight
through — but its comment no longer claims to have fixed a defect, and the
3 unit tests are labelled as guards rather than regression tests. A comment that
records a defect that never happened sends the next reader hunting the wrong
seam.

---

## DEFECTS FIXED (context, so you don't "re-fix" them)

Seam, before freezing:
1. `letterGrade` used a hardcoded `330` ceiling (comment claimed 360); real total
   is `4×70+30 = 310`. Every grade was deflated ~6%. Now derived via
   `courseMaxScore()`.
2. `letterGrade` returned `F` for a zero ceiling only by accident via `NaN`.
3. `courseMaxScore`'s parameter was narrowed to the literal `4` by `appConfig`'s
   `as const`, rejecting variable week counts.
4. The Google Sheet ingest endpoint had **no stated authorization**. Added
   `ROUTE_AUTH` as `Record<RouteKey, RouteAuth>` so an unclassified route is a
   compile error.
5. `next lint` is deprecated and **prompts interactively**, which would hang CI.
   Replaced with the ESLint CLI + flat config.
6. DB driver switched from `neon-http` to **node-postgres over the Neon pooler**:
   the HTTP driver has no interactive transactions, and quiz submission must write
   attempt+answers+progress+unlock atomically.

Integration:
7. `src/lib/progress/query.ts` — unescaped **backticks inside a SQL comment**
   terminated the `` sql`…` `` template. Broke `tsc` and every build. The stream
   had reported "clean typecheck".
8. `src/lib/exercises/diagnostics.ts` — invalid `d is Diagnostic` type predicate
   (`file` is `string | null`). Rewrote as `flatMap`.
9. **`/course` never existed as a route segment** (a dispatch error: the brief
   said `(app)/weeks/**`, the SKILL.md said `(app)/course/**`). Repointed
   `nav-links.ts`, `progress/dashboard.ts`, the quizzes back-link and
   `instructor/actions.ts`'s `revalidatePath`.
10. **Quiz week-lock gate.** `GET /api/weeks/:weekId/quiz` and `POST
    /api/quizzes/:quizId/submit` did not check unlock — a student could take
    Week 4's quiz. Both now gated via `gateWeek`. Option ids are sequential
    integers, which is why POST needed it too.
11. `src/middleware.ts` protected `/submissions` but pages live at `/assignments`
    — the edge gated nothing. Added `/assignments` and `/attendance`.
12. `(app)/layout.tsx` wired to `AppShell` + a new `SignOutButton`.
13. `AFTER_LOGIN_PATH` `/` → `/dashboard`.
14. Lecture page now mounts the live editor via a **lazy** import (377 kB → 116 kB
    First Load JS).
15. Seed extended with 3 activity profiles + a reset script.

Test bugs found by the serial runs (all were spec bugs, not product bugs):
16. Leaderboard spec used the bare `request` fixture after logging in via `page`
    — that fixture has its own cookie jar, so 5 tests 401'd.
17. `${ROW} [data-testid="lb-total"]` — CSS comma binds looser than the descendant
    combinator, so it matched whole `<tr>`s and every total parsed as `NaN`.
18. Attendance spec asserted `not.toContainText("0/10")`, but full marks render
    `10/10`, which *contains* `0/10`. The test could never pass.
19. Attendance spec raced the server actions (`setChecked` awaits the DOM, not the
    write) — only 2 of 3 lectures landed.
20. Quizzes spec resolved weeks by probing the quiz endpoint, which the new gate
    correctly 403s for locked weeks. Now resolves from `/api/courses`.
21. Interactive-exercises spec typed `<div>` and expected an unclosed-tag
    diagnostic, which CodeMirror's `autoCloseTags` makes impossible. See
    "Corrections" above.
22. Live-editor specs had a 30 s expect timeout inside a 30 s test budget, so any
    slowness surfaced as a bare timeout naming no assertion.

**Naming that looks wrong and is deliberate — do not "tidy":**
- `src/app/%5Fui/page.tsx` — a literal leading `_` is a private folder with **no
  route**; `%5F` is Next's documented escape.
- `src/middleware.ts`, not repo root — root is **silently ignored** when the app
  dir is `src/app`, leaving every protected route open.
- `src/components/exercises/` plural, vs the SKILL's singular.
- `(app)/quizzes/**`, not `(app)/course/**` — see integration defect 9.
