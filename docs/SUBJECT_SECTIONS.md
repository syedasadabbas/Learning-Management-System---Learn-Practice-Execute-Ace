# Subject sections and the release switch

How the course is divided into subjects, how a subject is opened or withheld,
and what it would take to make that switch editable at runtime.

## What this is

The course is authored as a flat list of weeks (`weeks.week_number` 1–4, see
`scripts/seed-content.ts`). Students should see it as **subjects**, and the
course owner needs to withhold subjects that the cohort has not reached yet.

Those are two different decisions, and the app keeps them as two layers:

| Layer | Question it answers | Where it lives | Can a student change it? |
|---|---|---|---|
| **Section release** | Has the cohort been given this subject at all? | `appConfig.curriculumSections[].enabled` | No. Nothing they do affects it. |
| **Quiz progression** | Within an open subject, has the previous week been passed? | `shouldUnlockNextWeek` in `src/lib/contracts/scoring.ts` | Yes — by passing the quiz. |

A week is readable only when **both** allow it. On conflict the section switch
wins.

## Current configuration

| Section | Weeks | State |
|---|---|---|
| HTML5 | 1 | **Open** |
| CSS3 | 2 | Withheld |
| JavaScript | 3 | Withheld |
| Git & Deployment | 4 | Withheld |

## To open the next subject

1. Edit `src/lib/config/app.config.ts` and set that section's `enabled` to `true`.
2. Update the assertion in `src/components/course/sections.test.ts`
   (`"opens HTML and only HTML"`) to name the new set. It will fail until you do —
   deliberately, so releasing a subject is a decision someone states out loud
   rather than a config edit that slips through review.
3. Commit and deploy.

Progression then applies inside the newly opened subject: a student still has to
pass the previous week's quiz at `QUIZ_PASS_PERCENT` to reach the next week.

## Why the switch is in version control, not the database

It is auditable, reviewed, and cannot be flipped by accident from a logged-in
browser. The cost is that opening a subject requires a deploy.

**To make it runtime-editable** would need, in order:

1. A migration adding `sections` (`slug`, `title`, `subtitle`, `description`,
   `order_index`, `enabled`) and `weeks.section_id`.
2. A seeder translating the current `appConfig.curriculumSections` into rows.
3. `getCurriculumSections()` in `src/components/course/sections.ts` reading the
   table instead of the config. **Nothing else changes** — that function is the
   only place the configuration is read, which is why it exists as a function
   rather than as a direct `appConfig` reference at each call site.
4. An admin screen under `src/app/(staff)/admin/`, and a re-validation that
   every week is still claimed by exactly one section (the invariant
   `sections.test.ts` currently asserts against the config).

Note that step 3 turns a zero-cost config read into a database read on every
gated page. Given that a Neon round trip costs ~245 ms (see below), that read
should be cached across requests — sections change on the order of once a week,
unlike progress, which must never be stale.

## The enforcement path

There is no per-route section check. Everything funnels through one derivation:

```
appConfig.curriculumSections
  └─ getCurriculumSections()            src/components/course/sections.ts
       ├─ isWeekNumberEnabled()
       │    ├─ deriveWeekLockStates()   src/components/course/lock-state.ts   (rule 0)
       │    │    └─ getWeekList() ─ gateWeek() / gateLecture()
       │    │         └─ 12 call sites: /weeks, /weeks/:id, lectures, quizzes,
       │    │            exams, and their five API routes
       │    └─ deriveUnlocked()         src/lib/progress/unlock.ts
       │         └─ the dashboard and currentWeekNumber
       └─ groupWeeksBySection()         the /weeks page layout
```

`deriveUnlocked` is a **second, independent** unlock derivation — it drives the
dashboard, not content access. It consults the same switch on purpose: if it did
not, the dashboard would offer a "continue to Week 2" action that `gateWeek`
then refuses, sending a student somewhere they are turned away from.

## Rules that the tests pin

These are the ones worth knowing about, because each is a way the switch could
quietly become advisory:

- A withheld subject beats **`progress.week_unlocked = true`**. A student who
  passed Week 1 before CSS3 was withdrawn does not keep CSS3.
- A withheld subject beats **"week 1 is always unlocked"**.
- A week claimed by **no section** is locked, not open. Adding week 5 to the
  curriculum does not publish it before someone writes a section for it. Such
  weeks are shown on `/weeks` under "Not yet assigned to a subject" rather than
  dropped, so the misconfiguration is visible instead of silently deleting
  content from the page.
- A section refusal never says *"Locked until you pass the Week N quiz"*. No quiz
  result opens a withheld subject, and that message would send a student to
  spend one of their three attempts for nothing. `WeekLockState.lockedBy`
  distinguishes the two cases.
- A locked week's card renders **no anchor at all** (`WeekCard.tsx`), and the
  server refuses the URL anyway — asserted by direct-URL e2e specs, because
  hiding a link is not access control.

## Staff

`gateWeek` is student-scoped and takes no role. An instructor or admin browsing
`/weeks` sees the same section locks. This is unchanged from the pre-existing
behaviour (staff have no progress rows, so weeks 2–4 were already locked for
them) and is not a regression, but it does mean **there is currently no staff
preview of a withheld subject**. If one is wanted, it belongs as an explicit
role check in `deriveWeekLockStates`, not as a bypass in a page.

---

# Appendix: why the app was slow

Recorded here because the fix is non-obvious and the next person to tune this
should not have to re-derive it. Measure with `npx tsx scripts/perf-roundtrips.ts`.

Against the Neon instance in `us-east-2`:

| Operation | Cost |
|---|---|
| Opening a new pooled connection (TCP + TLS + PgBouncer auth) | **~1700 ms** |
| A query on an existing connection | **~245 ms** |
| `fetchWeekAggregates` (4 rows, one statement) | ~245 ms |

Two conclusions, both counter-intuitive:

1. **Query complexity is irrelevant.** A four-row aggregate costs the same as
   `SELECT 1`. The number is the network round trip. So the metric that matters
   is a page's **sequential depth** — the longest chain of statements where each
   had to wait for the previous — not how many statements it runs.
2. **Connection setup costs seven times a query.** The pool's
   `idleTimeoutMillis` was 30 seconds, so any gap in a cohort's bursty traffic
   closed every connection and the next student paid the full handshake. The
   pages were not slow because of their queries; they kept re-introducing
   themselves to the database.

What changed (`src/db/index.ts`, `src/components/course/data.ts`):

- `idleTimeoutMillis` 30 s → 300 s, plus `keepAlive`.
- Pre-warm 3 connections at import — the widest fan-out any page performs — so
  handshakes happen at server start, not inside a request.
- `loadCourseAndWeeks` joins the weeks to the active course in one statement,
  removing a forced serial pair (course → then its weeks).
- React `cache()` on the four hottest reads, so `gateWeek` and the page that
  called it do not each pay for the same rows. Request-scoped only —
  deliberately **not** `unstable_cache`, because progress must never be stale.
- `gateLecture` issues its lecture row and the week list concurrently.

Measured at request time:

| Page | Before | After |
|---|---|---|
| `/weeks` | 3 statements, depth 2, 2202 ms | 2, depth 1, **251 ms** |
| `/weeks/:weekId` | 4, depth 3, 727 ms | 3, depth 2, **493 ms** |
| lecture page | 5, depth 4, 974 ms | 4, depth 2, **491 ms** |

## What is still on the table

- **The 245 ms baseline is distance.** Running the app far from `us-east-2` pays
  it on every round trip. Deployed on Vercel in a US-east region this falls to
  roughly 5–20 ms and every number above shrinks with it. Testing locally from
  outside the US, it does not — that latency is geography, not code.
- **Neon's free tier suspends the compute after ~5 minutes idle.** The first
  request after a quiet period pays a wake-up (~2 s here). No application change
  avoids this; it is a Neon plan setting.
- Cross-request caching of the curriculum (courses, weeks, lectures — identical
  for every student, changed only by an admin edit) would remove another round
  trip. It needs tag invalidation on the admin deadline/week writes, which is why
  it was not done blind.
