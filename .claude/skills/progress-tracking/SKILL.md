---
name: progress-tracking
description: Owns the student dashboard and the progress read model — per-week completion, quiz status, assignment status, unlock state, and the aggregated weekly score. Use for anything about "my progress", the student home dashboard, completion percentages, or what's unlocked. Wave 3 (consumes quizzes + submissions outputs).
---

# progress-tracking

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`progress`, `scoring.ts`).
- auth, ui-shell. Reads state written by quizzes and submissions streams.

## Owns
- `src/app/(app)/dashboard/page.tsx` — student home: week cards with completion,
  current score, next deadline (from `weeks.dueAt`), and unlock state.
- `src/app/api/me/progress/route.ts`, `src/app/api/me/dashboard/route.ts`.
- `src/lib/progress/aggregate.ts` — compute per-week and total score using ONLY
  `scoring.ts` helpers. Never re-implement scoring here.

## Contract
- `getWeeklyScore(studentId, weekId)` = quiz points + assignment points +
  participation points, via scoring.ts.
- Dashboard reads are pure aggregation; no writes to progress here (quizzes and
  submissions own the writes).

## Acceptance / definition of done
- Dashboard reflects a passed quiz and a graded assignment in the week score.
- Next-deadline shown per week from config/DB, in the student's locale.

## Test (e2e)
- Playwright: seed a passed Week 1 quiz + graded assignment, load dashboard,
  assert Week 1 score equals the scoring.ts expectation.
