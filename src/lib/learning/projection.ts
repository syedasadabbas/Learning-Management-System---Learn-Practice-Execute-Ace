// =============================================================================
// ANSWER-KEY PROJECTIONS — the column lists that decide what a student sees.
// Owner: the API stream.
// -----------------------------------------------------------------------------
// THE RULE, AND WHY IT IS A COLUMN LIST AND NOT A DELETE.
//
// Three tables in this wave hold material that answers the exercise it is
// attached to: `practice_problems` (solution_code, solution_explanation,
// solution_screenshot_url), `interview_questions` (sample_answer,
// answer_explanation, common_mistakes) and `questions` (explanation_html,
// correct_breakdown, incorrect_analysis — added by the learning wave and
// already marked ANSWER-KEY MATERIAL in src/db/schema.ts).
//
// The tempting implementation is `const { solutionCode, ...safe } = row`. It is
// wrong for one reason that matters more than its convenience: the row was
// already fetched, so the secret crossed the database boundary and lives in the
// process, in the query log, and in any error report that serialises the local
// scope. More practically, the next column an author adds to the table is
// included by default and nobody notices until it is in a response.
//
// So the barrier is a SELECT PROJECTION. The safe shape names the columns it
// wants; a new answer-key column is invisible to it until somebody adds it
// deliberately, and `select()` with an explicit object is the mechanism Drizzle
// gives us for exactly this. The types below are inferred from those objects,
// so a projection that leaks compiles into a response type that says so.
//
// =============================================================================
// THE RULE PER RESOURCE, stated once, here, because it is a product decision
// and not an implementation detail:
//
//   practice_problems
//     LIST  (GET /api/lectures/:id/practice-problems)
//           Never any solution material. Carries `solutionAvailable: boolean`
//           and `testCasesCount: number` so the UI can say "solution available"
//           without being handed one.
//     DETAIL(GET /api/practice-problems/:id)
//           Statement, context, criteria, starter code, hints. STILL no
//           solution — the detail view is where a student WORKS, and shipping
//           the answer into the page that hosts the editor puts it one devtools
//           tab away from the person trying to resist it.
//     SOLUTION (GET /api/practice-problems/:id/solution)
//           The only route that returns solution columns, and it is a separate
//           request the student must make on purpose. These problems are
//           UNGRADED and per-lecture (see the schema.learning.ts header), so the
//           solution is published teaching material, not a secret: gating it on
//           a recorded attempt is impossible anyway because no attempt ledger
//           table exists for them. What the split buys is that the answer is
//           never in a payload the student did not ask for.
//     HINTS (GET /api/practice-problems/:id/hints?upTo=n)
//           Hints are a LADDER: the endpoint returns levels 1..n and refuses to
//           return the whole array at once, so "reveal one more" is a server
//           fact rather than a client-side `slice` over data already sent.
//
//   interview_questions
//     LIST  (GET /api/interview-questions)
//           Question text, difficulty, category, and `hasSampleAnswer: boolean`.
//           No `sample_answer`, no `answer_explanation`, no `common_mistakes`.
//           The list is a study index; revealing the model answer in it turns
//           self-testing into reading.
//     DETAIL(GET /api/interview-questions/:id)
//           EVERYTHING, model answer included. This is the deliberate exception
//           and the spec asks for it (TECHNICAL_SPECIFICATION.md:650-682): an
//           interview question is not assessed, so "show answer" is the feature.
//           The barrier is the click, and the click is the separate request.
//
//   assignment_samples, lecture_visualizations
//     No answer-key material at all. A sample IS the answer, published on
//     purpose, and a visualisation is a diagram. Listed here so that "why is
//     there no projection for these two?" has a recorded answer.
//
//   presentation_slides.speaker_notes
//     Handled in the presentations routes, not here: notes are presenter-only
//     (the column comment says so) and are withheld from every viewer who is
//     not the deck's creator or staff.
// =============================================================================

import { interviewQuestions, practiceProblems } from "@/db/schema.learning";

/**
 * Practice problem, LIST shape.
 *
 * `hints` is included: the ladder endpoint exists to meter them, but the list
 * needs the count to render "3 hints available", and the hint TEXT is not an
 * answer — a hint that gives the answer away is a badly written hint, and the
 * scaffolding is the pedagogy. Callers reduce it to a count; see
 * `practiceProblemListItem`.
 */
export const practiceProblemListColumns = {
  id: practiceProblems.id,
  lectureId: practiceProblems.lectureId,
  title: practiceProblems.title,
  description: practiceProblems.description,
  difficultyLevel: practiceProblems.difficultyLevel,
  learningObjectives: practiceProblems.learningObjectives,
  problemContext: practiceProblems.problemContext,
  problemStatement: practiceProblems.problemStatement,
  starterCode: practiceProblems.starterCode,
  starterLanguage: practiceProblems.starterLanguage,
  execution: practiceProblems.execution,
  problemOrder: practiceProblems.problemOrder,
  hints: practiceProblems.hints,
  testCases: practiceProblems.testCases,
  // Presence, not content. Selecting the column and testing it in SQL keeps the
  // solution text out of the result set entirely.
  createdAt: practiceProblems.createdAt,
} as const;

/**
 * Practice problem, DETAIL shape.
 *
 * Identical to the list shape plus acceptance criteria. Deliberately NOT a
 * superset that adds solution columns — see the rule block above.
 */
export const practiceProblemDetailColumns = {
  ...practiceProblemListColumns,
  acceptanceCriteria: practiceProblems.acceptanceCriteria,
} as const;

/**
 * Practice problem, SOLUTION shape. The ONLY projection naming solution columns.
 *
 * `id` is carried so a client can assert the answer it rendered belongs to the
 * problem it is showing; a bare solution blob is impossible to key.
 */
export const practiceProblemSolutionColumns = {
  id: practiceProblems.id,
  lectureId: practiceProblems.lectureId,
  solutionCode: practiceProblems.solutionCode,
  solutionExplanation: practiceProblems.solutionExplanation,
  solutionScreenshotUrl: practiceProblems.solutionScreenshotUrl,
} as const;

/** Interview question, LIST shape. No answer material of any kind. */
export const interviewQuestionListColumns = {
  id: interviewQuestions.id,
  lectureId: interviewQuestions.lectureId,
  weekId: interviewQuestions.weekId,
  title: interviewQuestions.title,
  difficultyLevel: interviewQuestions.difficultyLevel,
  category: interviewQuestions.category,
  questionText: interviewQuestions.questionText,
  context: interviewQuestions.context,
  questionOrder: interviewQuestions.questionOrder,
  createdAt: interviewQuestions.createdAt,
} as const;

/**
 * Interview question, DETAIL shape — model answer included, by design.
 *
 * Written out in full rather than as `...listColumns` plus the answer fields,
 * so that a reader of this file can see the whole answer-bearing payload in one
 * place instead of reconstructing it from a spread.
 */
export const interviewQuestionDetailColumns = {
  id: interviewQuestions.id,
  lectureId: interviewQuestions.lectureId,
  weekId: interviewQuestions.weekId,
  title: interviewQuestions.title,
  difficultyLevel: interviewQuestions.difficultyLevel,
  category: interviewQuestions.category,
  questionText: interviewQuestions.questionText,
  context: interviewQuestions.context,
  sampleAnswer: interviewQuestions.sampleAnswer,
  answerExplanation: interviewQuestions.answerExplanation,
  commonMistakes: interviewQuestions.commonMistakes,
  followUpQuestions: interviewQuestions.followUpQuestions,
  visualWalkthroughHtml: interviewQuestions.visualWalkthroughHtml,
  codeExample: interviewQuestions.codeExample,
  relatedConcepts: interviewQuestions.relatedConcepts,
  relatedPracticeId: interviewQuestions.relatedPracticeId,
  questionOrder: interviewQuestions.questionOrder,
  createdAt: interviewQuestions.createdAt,
} as const;

// ---------------------------------------------------------------------------
// The names, as data. This is what the unit test asserts against.
// ---------------------------------------------------------------------------

/**
 * Every field in this codebase that answers the exercise it belongs to.
 *
 * Kept as a plain string list, separate from the Drizzle column objects, so a
 * test can assert "no student-facing projection contains any of these" without
 * a database and without importing the schema's runtime. Adding a column to the
 * schema and forgetting to add it here is the failure mode this cannot catch;
 * adding it here and forgetting to strip it from a projection is the one it can,
 * and that is the more common of the two.
 */
export const ANSWER_KEY_FIELDS = [
  "solutionCode",
  "solutionExplanation",
  "solutionScreenshotUrl",
  "sampleAnswer",
  "answerExplanation",
  "commonMistakes",
  "explanationHtml",
  "correctBreakdown",
  "incorrectAnalysis",
] as const;

export type AnswerKeyField = (typeof ANSWER_KEY_FIELDS)[number];

/**
 * Does a projection leak answer-key material?
 *
 * Returns the offending field names, empty when clean. Used by the unit test
 * and available to any future projection that wants to assert about itself.
 *
 * @param projection any `select()` column map
 * @param allow fields this projection is ALLOWED to carry — the solution
 *        endpoint's projection is not a leak, it is the whole point of that
 *        route, and an allowlist makes that exemption explicit rather than
 *        implicit in which projections the test happens to check.
 */
export function answerKeyLeaks(
  projection: Readonly<Record<string, unknown>>,
  allow: readonly string[] = [],
): AnswerKeyField[] {
  return ANSWER_KEY_FIELDS.filter(
    (field) => field in projection && !allow.includes(field),
  );
}

// ---------------------------------------------------------------------------
// Derived list-item shaping
// ---------------------------------------------------------------------------

/** `hints` and `test_cases` are jsonb; a stored blob is untrusted, not a type. */
function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Reduce a fetched practice-problem row to the LIST payload.
 *
 * Replaces `hints` and `testCases` with counts. Both are carried in the
 * projection because the count has to come from somewhere and a correlated
 * `jsonb_array_length` per row is a worse trade than transferring the arrays
 * for one lecture's worth of problems; the reduction happens here so no route
 * decides it independently.
 *
 * @param row a row selected with `practiceProblemListColumns`
 * @param solutionAvailable computed in SQL as `solution_code IS NOT NULL`, so
 *        the solution text itself never enters the result set
 */
export function practiceProblemListItem<
  T extends { hints: unknown; testCases: unknown },
>(row: T, solutionAvailable: boolean) {
  const { hints, testCases, ...rest } = row;
  return {
    ...rest,
    hintCount: arrayLength(hints),
    testCasesCount: arrayLength(testCases),
    solutionAvailable,
  };
}

/**
 * The hint ladder, metered.
 *
 * @param hints the raw jsonb value from `practice_problems.hints`
 * @param upTo highest level to reveal, 1-based
 * @returns hints whose `level` is <= `upTo`, in ascending level order
 *
 * Rows that are not `{ level: number; text: string }` are DROPPED rather than
 * passed through. jsonb accepts anything, and a malformed hint rendered as
 * `[object Object]` under a "Hint 2" heading is worse than one fewer hint.
 */
export function hintsUpTo(hints: unknown, upTo: number): Array<{ level: number; text: string }> {
  if (!Array.isArray(hints)) return [];
  return hints
    .filter(
      (h): h is { level: number; text: string } =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as { level?: unknown }).level === "number" &&
        typeof (h as { text?: unknown }).text === "string",
    )
    .filter((h) => h.level <= upTo)
    .sort((a, b) => a.level - b.level);
}

/**
 * Highest hint level present, so a client knows whether "reveal another" has
 * anything behind it. Zero when there are no well-formed hints.
 */
export function maxHintLevel(hints: unknown): number {
  const all = hintsUpTo(hints, Number.MAX_SAFE_INTEGER);
  return all.reduce((max, h) => Math.max(max, h.level), 0);
}
