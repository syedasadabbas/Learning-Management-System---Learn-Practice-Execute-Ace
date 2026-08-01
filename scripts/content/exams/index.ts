// =============================================================================
// GRAND-EXAM CONTENT — barrel. Owner: curriculum-content stream (seed data only).
// -----------------------------------------------------------------------------
// Four grand quizzes, one per EXISTING week, authored to the blueprint in
// docs/research/CURRICULUM_PLAN.md Section A:
//
//   30 mcq x 2  +  14 code_fix x 3  +  6 code_write x 8
//   = 50 questions / 150 points per exam
//   = 200 questions / 600 points across the four
//
// THE OWNER'S SYLLABUS IS FROZEN. Nothing here modifies a week, a lecture, a
// practice quiz or an existing MCQ. Each exam is a NEW `quizzes` row with
// `kind = 'grand'`, attached to its week by WEEK NUMBER resolved at runtime —
// never by a hardcoded id, because serial ids are reassigned by every reseed and
// an exam attached to a stale id would silently belong to the wrong week.
//
// -----------------------------------------------------------------------------
// WHAT THE `tests` COLUMN HOLDS, PER WEEK — read this before writing a grader
// -----------------------------------------------------------------------------
// `questions.tests` is `Array<{ name, input, expected }>` for every code_write
// item, and the grand-quiz payload layer strips the column before anything
// reaches a browser. But the tests are NOT uniform, and pretending otherwise
// would produce a grader that scores weeks 1 and 2 wrongly:
//
//   Weeks 3 and 4 (`javascript`) — EXECUTABLE AS WRITTEN. `input` is literal
//     stdin, `expected` is the exact trimmed stdout of a complete program. The
//     shared execution surface can run these unchanged, on Piston or in the
//     browser worker, and compare output.
//
//   Weeks 1 and 2 (`html`, `css`) — NOT EXECUTABLE. There is no runtime that
//     "runs" markup or a stylesheet, so `input` names a STRUCTURAL PROBE over
//     the submitted source (`probe:h1Count`, `probe:declaration(.grid,gap)`) and
//     `expected` is the value that probe must yield. Deterministic, and no
//     layout engine needed — but it requires a markup/CSS assertion grader that
//     does not exist yet.
//
//   OPEN DECISION for the grand-quiz owner, stated rather than silently picked:
//   until that grader exists, the 12 code_write items in weeks 1 and 2 (96 of
//   600 points) should be DEFERRED TO INSTRUCTOR GRADING on the same path
//   already built for `rate_limited` / `backend_unavailable`. Invariant I6 then
//   holds unchanged: the total is labelled provisional while they are pending
//   and can only rise. Scoring them zero would be the one outcome that breaks
//   I6, so it must not be the fallback.
// =============================================================================

import { week1Exam } from "./week1-html";
import { week2Exam } from "./week2-css";
import { week3Exam } from "./week3-javascript";
import { week4Exam } from "./week4-git-deploy";

export * from "./types";
export * from "./validate";

/**
 * The four exams, in week order. Order is not load-bearing — each row resolves
 * its own week by number — but keeping it sorted makes the seeder's log readable.
 */
export const grandExams = [week1Exam, week2Exam, week3Exam, week4Exam];

export { week1Exam, week2Exam, week3Exam, week4Exam };
