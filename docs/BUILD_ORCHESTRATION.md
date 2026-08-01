# Build orchestration — how the parallel work is divided

This is the plan a coordinator (you in Claude Code via the Task tool, or a human
running one branch per stream) follows to build the app in parallel without
collisions. The key idea: **freeze the seam first, then fan out.**

## The seam (why parallel work is safe)
Every stream imports from three frozen locations and never edits them:
- `src/db/schema.ts` — tables + inferred types
- `src/lib/contracts/*` — scoring, validation, API route ownership
- `src/lib/config/app.config.ts` — branding, course meta, deadlines

Because the data shapes and function signatures are fixed up front, two streams
can build against the same `submissions` table on different branches and merge
cleanly. Contract changes are the only thing that force cross-stream coordination.

## Dependency graph
```
                       shared-contracts  (Wave 0)
                              │
              ┌───────────────┼───────────────┐
           devops-testing   ui-shell         auth        (Wave 1)
                              │                │
        ┌─────────────────────┼────────────────┼───────────────┐
  course-content          quizzes    interactive-exercises      │   (Wave 2)
        │                     │                                  │
        └──────────┬──────────┴───────────────┬─────────────────┘
             progress-tracking          submissions   leaderboard  (Wave 3)
                                               │
                              penalties-attendance   instructor-admin (Wave 3→4)
```

## Waves (what runs concurrently)

### Wave 0 — foundation (serial, blocks everything)
- `shared-contracts` — build + migrate + seed + unit-test scoring.
- `devops-testing` — stand up Vitest/Playwright/CI so streams test from day one.
  (Can start the moment the schema file exists; finalize CI after Wave 1.)

Gate: announce **"seam frozen"** when shared-contracts merges to `develop`.

### Wave 1 — cross-cutting (3 streams in parallel)
- `ui-shell` — layout + primitives.
- `auth` — identity + guards.
- `devops-testing` — finish CI + fixtures.

Gate: `requireUser`, `requireRole`, and the UI primitives are importable.

### Wave 2 — student-facing features (3 streams in parallel)
- `course-content` — weeks/lectures/videos/links + unlock read model.
- `quizzes` — MCQ engine + auto-grade + unlock write.
- `interactive-exercises` — Sandpack live editor + concept animations.

These three touch different tables/routes and only share ui-shell + auth, so
they parallelize cleanly.

### Wave 3 — aggregation + Phase-2 features (parallel, with light coupling)
- `progress-tracking` — dashboard (reads quiz/submission state).
- `submissions` — Google Sheet ingestion + student history.
- `leaderboard` — ranking + `onScoringEvent` hook (quizzes/submissions call it).
- `penalties-attendance` — penalty rules + attendance.

Coupling note: quizzes and submissions call `leaderboard.onScoringEvent` and the
`penalties` rule functions. Land `leaderboard`'s hook signature and the penalty
rule signatures early in the wave (thin stubs first), so the callers can wire to
them without waiting for full implementations.

### Wave 4 — staff tooling
- `instructor-admin` — grading UI, admin console, analytics, export.

Depends on submissions (grading writes) + leaderboard + penalties being present.

## Merge discipline
- One branch per stream: `feature/<skill-name>` off `develop`.
- PR into `develop`; CI must be green (typecheck + unit + that stream's e2e).
- `main` is production; only release merges land there.
- If a stream discovers the seam is wrong, it stops and files a contract-change
  request — it does not patch the schema on its feature branch.

## If running as Claude Code subagents
Dispatch one Task per stream **within a wave**, not across waves. Wait for a
wave's gate before dispatching the next. Give each subagent: its `SKILL.md`
path, the frozen seam paths (read-only), and its branch name. Each subagent
runs its own tests and opens its PR; the coordinator merges in dependency order.
