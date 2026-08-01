---
name: penalties-attendance
description: Implements the penalty/warning system (late, quiz failure, missed deadline, low score, with warning/notice/serious severities) and per-lecture attendance plus participation scoring. Use for anything about penalties, warnings, notices, deadline enforcement consequences, attendance, or participation points. Wave 3, Phase 2 feature.
---

# penalties-attendance

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`penalties`, `attendance`, `progress`, scoring points).
- auth (instructor/admin only for issuing), ui-shell.

## Owns
- `src/lib/penalties/rules.ts` — pure functions mapping events to penalties:
  quiz <50% -> serious; assignment 1-3 days late -> warning; >3 days -> notice;
  no submission by due -> serious; >=3 accumulated -> escalation flag.
- `src/app/api/penalties/route.ts` — issue (instructor), list-by-student.
- `src/app/(app)/me/notices/page.tsx` — student sees their warnings/notices.
- `src/components/attendance/*` + `src/app/api/attendance/route.ts` — instructor
  marks attendance per lecture; participation points feed weekly score (max 10).

## Contract
- `evaluateSubmissionPenalty(daysLate)` and `evaluateQuizPenalty(percent)`
  return a penalty descriptor or null; submissions/quizzes call these.

## Acceptance / definition of done
- A <50% quiz records a serious penalty; a 4-days-late submission records a
  notice. Student notices page lists them.
- Attendance below 80% in a week yields zero participation points that week.

## Test (e2e)
- Playwright: instructor issues a warning; student sees it. Attendance toggles
  update participation in the weekly score.
