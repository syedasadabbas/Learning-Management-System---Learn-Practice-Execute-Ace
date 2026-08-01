---
name: leaderboard
description: Builds the cohort leaderboard — denormalized ranking rebuilt on grading events, sortable overall and by week, with the current user highlighted. Use for anything about rankings, "top students", standings, or competitive scoring. Wave 3 (consumes quizzes + submissions).
---

# leaderboard

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`leaderboard`, `scoring.ts`, `cohorts`).
- auth, ui-shell.

## Owns
- `src/app/(app)/leaderboard/page.tsx` — table: rank, name, total, avg stars;
  highlight the signed-in user; filter by cohort; tab overall vs per-week.
- `src/app/api/leaderboard/route.ts`, `src/app/api/leaderboard/me/route.ts`.
- `src/lib/leaderboard/rebuild.ts` — `rebuildLeaderboard(cohortId)` recomputes
  every student's totals via scoring.ts and writes ranks. Called by quizzes and
  submissions after any grading event (export a thin hook they import).

## Contract exposed
- `onScoringEvent(studentId)` — cheap trigger other streams call after grading;
  it schedules/executes a rebuild for that student's cohort.

## Ranking order
1) totalScore desc, 2) avg instructor stars desc, 3) finalProjectScore desc,
4) earliest submission time.

## Acceptance / definition of done
- After a grading event, ranks reflect new totals.
- Current user row is visually highlighted and reachable via /leaderboard/me.

## Test (e2e)
- Playwright: seed three students with different totals; assert ordering and
  that the signed-in user is highlighted.
