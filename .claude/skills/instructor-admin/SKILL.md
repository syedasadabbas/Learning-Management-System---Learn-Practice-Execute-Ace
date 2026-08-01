---
name: instructor-admin
description: Builds the instructor grading interface (queue of submissions, star ratings, written feedback) and the admin console (create/edit quizzes and assignments, manage students, configure deadlines, export reports, view analytics like pass rates). Use for anything instructor- or admin-facing. Wave 3-4, Phase 2 feature.
---

# instructor-admin

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (all tables), auth (`requireRole`), ui-shell,
  submissions (grading writes), leaderboard (`onScoringEvent`),
  penalties-attendance (issuing).

## Owns
- `src/app/(instructor)/grade/page.tsx` — queue of `status = submitted` rows;
  open one, view github/live links, give 1-5 stars + feedback, save.
- `src/app/api/instructor/submissions/route.ts`,
  `.../submissions/[id]/grade/route.ts` — validate with `gradeSubmissionSchema`,
  set score via `assignmentPoints`, mark graded, call `onScoringEvent`.
- `src/app/(admin)/console/*` — CRUD for quizzes/questions and assignments;
  student management; deadline config (writes `weeks.dueAt`, `cohorts`).
- `src/app/api/instructor/students/route.ts`, `.../analytics/route.ts` —
  pass rates, average scores, late counts, at-risk (>=3 penalties).
- `src/app/api/instructor/export/route.ts` — CSV export of grades.

## Acceptance / definition of done
- Instructor grades a submission; leaderboard + student dashboard update.
- Admin edits a deadline; the new date shows on the student dashboard.
- Analytics returns pass rate and average score per week.

## Test (e2e)
- Playwright: instructor logs in, grades a queued submission with 4 stars,
  assert score = assignmentPoints(stars:4) and student dashboard reflects it.
