---
name: quizzes
description: Implements the MCQ quiz engine — taking a quiz, auto-grading on submit, recording attempts (max 3, best counts), computing the pass percentage, and firing the week-unlock event when the student scores at or above the pass threshold. Use for anything about quizzes, grading MCQs, attempts, or unlocking the next week. Wave 2.
---

# quizzes

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`quizzes`, `questions`, `options`, `quizAttempts`, `answers`,
  `progress`; `scoring.ts` -> `quizPointsFromPercent`, `shouldUnlockNextWeek`;
  `quizSubmitSchema`).
- auth (`requireUser`), ui-shell.

## Owns
- `src/app/(app)/course/[weekId]/quiz/page.tsx` — renders questions, collects
  answers, submits, shows results + per-question explanations.
- `src/app/api/weeks/[weekId]/quiz/route.ts` — returns quiz WITHOUT `isCorrect`
  flags (never leak answers to the client).
- `src/app/api/quizzes/[quizId]/submit/route.ts` — validate with `quizSubmitSchema`,
  grade server-side against `options.isCorrect`, insert attempt + answers,
  compute percentage, and if `shouldUnlockNextWeek(bestPercent)` set the next
  week's `progress.weekUnlocked = true`. Enforce `attemptsAllowed`.
- `src/app/api/quizzes/[quizId]/attempts/route.ts` — student's attempt history.

## Critical rules
- Grade ONLY on the server. The GET quiz payload must strip correctness.
- Best attempt counts toward score/unlock. Block the 4th attempt.
- Unlocking is idempotent — re-submitting a passed quiz does not regress state.

## Acceptance / definition of done
- Submitting a >=70% attempt unlocks the next week exactly once.
- A <50% attempt does not unlock and records the attempt.
- 4th attempt is rejected with a clear error.

## Test (e2e)
- Playwright: take Week 1 quiz with all-correct answers -> see pass -> Week 2
  becomes unlocked. Separate case: all-wrong -> Week 2 stays locked.
