---
name: submissions
description: Implements assignment delivery via Google Forms and ingestion from the linked Google Sheet, late-penalty computation, the student's submission history, and the data side of instructor grading. Use for anything about assignments, submitting work, Google Form/Sheet ingestion, late penalties, or submission status. Wave 3.
---

# submissions

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`assignments`, `submissions`, `scoring.ts` ->
  `assignmentPoints`, `daysLate`; `gradeSubmissionSchema`).
- auth, ui-shell, leaderboard (`onScoringEvent`).

## Model (no file storage — Google Forms + Sheet)
- Each assignment stores a `googleFormUrl` (students submit there) and a
  `googleSheetCsvUrl` (the Form's linked responses sheet, published as CSV).
- We do NOT accept file uploads. We INGEST rows from the published CSV.

## Owns
- `src/app/(app)/course/[weekId]/assignment/page.tsx` — shows requirements +
  an embedded/linked Google Form button + this student's submission status.
- `src/app/api/weeks/[weekId]/assignment/route.ts` — assignment details.
- `src/app/api/assignments/[assignmentId]/ingest/route.ts` — fetch the CSV,
  parse rows, upsert `submissions` keyed by `sheetRowRef` (idempotent), match
  each row to a student by email, compute `isLate` + `daysLate` vs `dueAt`.
- `src/app/api/me/submissions/route.ts` — student history.
- `src/lib/sheets/ingest.ts` — CSV fetch+parse+match; safe to re-run.

## Facts
- Publish the Form's response sheet via File -> Share -> Publish to web (CSV).
  Store that CSV url in `assignments.googleSheetCsvUrl`.
- Match rows to students by the email column captured by the Form.
- Ingestion is idempotent via the `submissions_row_ref_idx` unique index.

## Acceptance / definition of done
- Ingest parses a sample CSV, creates one submission per row, sets late flags.
- Re-running ingest creates no duplicates.
- Grading a submission (via instructor-admin) computes points with
  `assignmentPoints` and calls `onScoringEvent`.

## Test (e2e)
- Playwright + a fixture CSV served locally: run ingest, assert submissions
  appear with correct late flags; re-run and assert count unchanged.
