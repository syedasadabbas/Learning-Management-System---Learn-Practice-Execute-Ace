// =============================================================================
// GRAND-QUIZ GRADING — invariants I4, I5 and I6, as pure functions.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream. No database, no I/O, no clock.
//
// SCORING MATHS IS NOT DEFINED HERE. The pass threshold and the
// percentage→points bands live in `src/lib/contracts/scoring.ts`; the
// score→percentage conversion already exists as `percentageOf` in
// `src/lib/quizzes/grading.ts` and is IMPORTED, not copied. A second copy of that
// rounding is how an exam and a dashboard come to disagree about 69.995%.
// (`src/lib/quizzes/**` is read-only for this stream — imported, never modified.)
//
// The three invariants this file carries:
//
//  I4  `buildExamAnswerRows` returns exactly one row per question in the quiz,
//      including questions the student never opened. Those carry
//      `selectedOptionId: null`, `codeAnswer: null`, `awarded: 0`. There is no
//      code path that returns fewer rows than it was given questions.
//
//  I5  `clampAwarded` is the ONLY way `awarded` is produced, and it clamps to
//      [0, maxPoints]. `sumAwarded` derives the score by summation — there is no
//      running total anywhere in this stream that could drift from its parts.
//      A wrong answer awards 0; nothing subtracts.
//
//  I6  `summariseExam` reports `deferredCount` and marks the total `provisional`
//      if and only if that count is above zero. Because a deferred item currently
//      holds 0 and I5 forbids a negative award, grading it later can only RAISE
//      the total. `provisionalCeiling` states the bound explicitly.
// =============================================================================

import { percentageOf } from "@/lib/quizzes/grading";
import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A question as the grader needs it. `points` is the ceiling; `type` decides
 * whether an option or a code run produces the mark.
 */
export interface ExamGradableQuestion {
  id: number;
  /** `mcq` | `multiple_select` | `code_write` | `code_fix`. */
  type: string;
  points: number;
  orderIndex: number;
}

/** The answer key for one option. Never serialised to a client — see ./payload.ts. */
export interface ExamGradableOption {
  id: number;
  questionId: number;
  isCorrect: boolean;
}

/**
 * What the student had stored when the exam closed, as read back from `answers`.
 *
 * Note this is the SAVED state, not a request body. Submit does not accept a
 * final payload of answers: everything is autosaved as the student works, so a
 * browser that dies at minute 119 loses nothing and a submit cannot smuggle in a
 * 51st answer for a question that is not in the quiz.
 */
export interface ExamSavedAnswer {
  questionId: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
}

/**
 * The outcome of running one `code_write` answer. Produced by ./code-grading.ts.
 *
 * `deferred` exists as a distinct member from `scored: 0` because they mean
 * opposite things: "we ran it and it failed" versus "we could not run it". A
 * busy shared Piston instance says nothing about the student's code, so scoring
 * it zero would be a fabricated grade.
 */
export type CodeOutcome =
  | { questionId: number; kind: "scored"; awarded: number; note: string | null }
  | {
      questionId: number;
      kind: "deferred";
      reason: string;
      /**
       * True when the runner itself was unavailable (rate-limited or down), as
       * opposed to a per-question authoring gap. Machine-readable rather than
       * pattern-matched out of `reason`, because ./code-grading.ts short-circuits
       * the rest of the exam on this flag and a prose match would break the
       * moment the wording was edited.
       */
      infrastructure: boolean;
    };

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * One graded answer row, ready to be written to `answers` and to be shown back
 * to the student. There is one of these per question in the quiz — always.
 */
export interface ExamAnswerRow {
  questionId: number;
  type: string;
  orderIndex: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
  isCorrect: boolean;
  awarded: number;
  maxPoints: number;
  /**
   * True when this item was handed to instructor grading instead of being
   * scored. Reported to the student in the submit response; NOT a column — the
   * schema is frozen and `answers` has none. It is persisted indirectly as the
   * attempt's `submitted` (rather than `graded`) status. See ./state.ts.
   */
  deferred: boolean;
  /** Why it was deferred, or a note about how a code answer scored. Never an answer key. */
  note: string | null;
  /** True when the student left this question entirely alone. Invariant I4's visible half. */
  unanswered: boolean;
}

export interface ExamSummary {
  /** SUM of `awarded` across every row. Never a running total (I5). */
  score: number;
  /** SUM of `maxPoints` — the quiz's own weight, not a question count. */
  totalPossible: number;
  /** score/totalPossible, rounded to the 2dp of `quiz_attempts.percentage`. */
  percentage: number;
  /** Against the frozen threshold. Provisional totals can only rise, so this can too. */
  passed: boolean;
  /** How many items are awaiting instructor grading. Zero means the total is final. */
  deferredCount: number;
  /** `deferredCount > 0`. The word "provisional" appears in the UI iff this is true. */
  provisional: boolean;
  /** Questions with no selection and no code. Reported so "attempted 50, answered 12" is legible. */
  unansweredCount: number;
  /** Marks still reachable from the deferred items — the amount the total can RISE by. */
  deferredPointsOutstanding: number;
}

export interface ExamGradeResult extends ExamSummary {
  rows: ExamAnswerRow[];
}

// ---------------------------------------------------------------------------
// I5 — the clamp
// ---------------------------------------------------------------------------

/**
 * The only producer of `awarded` in this stream.
 *
 * Clamps to [0, maxPoints]:
 *   * a negative raw mark becomes 0 — there is NO negative marking, so a wrong
 *     answer cannot eat marks earned elsewhere;
 *   * a raw mark above the question's own weight is capped, so one mis-weighted
 *     item cannot push a total past `totalPossible`;
 *   * a non-finite or non-integer raw mark is floored to an integer, because the
 *     column is `integer` and Postgres would otherwise round it behind our back.
 *
 * A negative `maxPoints` (an authoring error) yields 0 rather than a negative
 * ceiling — `Math.min(x, -3)` would otherwise let the clamp itself go negative.
 */
export function clampAwarded(raw: number, maxPoints: number): number {
  const ceiling = Number.isFinite(maxPoints) ? Math.max(0, Math.floor(maxPoints)) : 0;
  if (!Number.isFinite(raw)) return 0;
  const floored = Math.floor(raw);
  if (floored <= 0) return 0;
  return Math.min(floored, ceiling);
}

/** A question's ceiling, normalised the same way the clamp normalises it. */
export function maxPointsOf(points: number): number {
  return Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
}

/**
 * The score, by summation over the parts (I5).
 *
 * Deliberately not `rows.reduce` over a mutable accumulator held elsewhere: the
 * only way to know the score is to add up the rows that were written, so a row
 * that failed to persist cannot leave a total claiming it did.
 */
export function sumAwarded(rows: readonly { awarded: number }[]): number {
  return rows.reduce((total, row) => total + row.awarded, 0);
}

/** The quiz's total weight, by summation over the same rows. */
export function sumMaxPoints(rows: readonly { maxPoints: number }[]): number {
  return rows.reduce((total, row) => total + row.maxPoints, 0);
}

// ---------------------------------------------------------------------------
// I4 — a row for every question
// ---------------------------------------------------------------------------

/**
 * Build one graded row per question in the quiz.
 *
 * QUESTIONS DRIVE THE RESULT, never the saved answers. Iterating the saved rows
 * would let a student with 12 answers out of 50 be scored 12/12: the denominator
 * would shrink with the numerator. The output length is therefore always
 * `questions.length`, which `grading.test.ts` asserts directly.
 *
 * Per type:
 *   `mcq`, `multiple_select`, `code_fix`
 *       auto-graded from the option key. `code_fix` is a code-correction item —
 *       broken code plus candidate fixes — so it grades exactly like an MCQ and
 *       shares this path rather than touching Piston at all.
 *   `code_write`
 *       graded from `codeOutcomes`, which ./code-grading.ts produced by running
 *       the question's hidden tests. No outcome for a question means no code was
 *       submitted, which scores 0 — there was nothing to run, and that is a
 *       genuine zero rather than an infrastructure failure.
 *
 * OPTION OWNERSHIP IS RE-VALIDATED. The autosave path already refuses an option
 * belonging to another question, so this is defence in depth; the cost is one
 * map lookup and the failure it prevents is an answer row that renders as
 * somebody else's answer text forever.
 *
 * `multiple_select` NOTE (inherited limit, not a new one): `answers` holds one
 * `selected_option_id`, so a multi-select question is graded as single-answer —
 * correct only if the one stored option is a correct one. The same TODO stands in
 * `src/lib/quizzes/grading.ts`; fixing it is a frozen-schema change, not a
 * grand-quiz change. No seeded question uses the type.
 */
export function buildExamAnswerRows(params: {
  questions: readonly ExamGradableQuestion[];
  options: readonly ExamGradableOption[];
  saved: readonly ExamSavedAnswer[];
  codeOutcomes: readonly CodeOutcome[];
}): ExamAnswerRow[] {
  const { questions, options, saved, codeOutcomes } = params;

  /** questionId -> (optionId -> isCorrect). One lookup proves ownership AND correctness. */
  const keyByQuestion = new Map<number, Map<number, boolean>>();
  for (const option of options) {
    let forQuestion = keyByQuestion.get(option.questionId);
    if (!forQuestion) {
      forQuestion = new Map<number, boolean>();
      keyByQuestion.set(option.questionId, forQuestion);
    }
    forQuestion.set(option.id, option.isCorrect);
  }

  const savedByQuestion = new Map<number, ExamSavedAnswer>();
  for (const answer of saved) {
    // First write wins. `answers` has UNIQUE (attempt_id, question_id) so a
    // duplicate cannot exist in the database; this only guards a caller that
    // passed one.
    if (!savedByQuestion.has(answer.questionId)) savedByQuestion.set(answer.questionId, answer);
  }

  const outcomeByQuestion = new Map<number, CodeOutcome>();
  for (const outcome of codeOutcomes) {
    if (!outcomeByQuestion.has(outcome.questionId)) {
      outcomeByQuestion.set(outcome.questionId, outcome);
    }
  }

  return questions
    .slice()
    .sort(compareOrder)
    .map((question) => {
      const maxPoints = maxPointsOf(question.points);
      const savedAnswer = savedByQuestion.get(question.id);
      const key = keyByQuestion.get(question.id);

      // Only an option that belongs to THIS question is honoured.
      const selectedOptionId =
        savedAnswer?.selectedOptionId != null && key?.has(savedAnswer.selectedOptionId)
          ? savedAnswer.selectedOptionId
          : null;
      const codeAnswer = normaliseCode(savedAnswer?.codeAnswer);
      const unanswered = selectedOptionId == null && codeAnswer == null;

      if (question.type === "code_write") {
        const outcome = outcomeByQuestion.get(question.id);
        if (outcome?.kind === "deferred") {
          return {
            questionId: question.id,
            type: question.type,
            orderIndex: question.orderIndex,
            selectedOptionId: null,
            codeAnswer,
            // Not "incorrect" — unknown. Stored false because the column is not
            // nullable; the `deferred` flag is what the student is shown.
            isCorrect: false,
            // Zero for now, and only ever upward from here (I6).
            awarded: 0,
            maxPoints,
            deferred: true,
            note: outcome.reason,
            unanswered,
          };
        }
        const awarded = outcome ? clampAwarded(outcome.awarded, maxPoints) : 0;
        return {
          questionId: question.id,
          type: question.type,
          orderIndex: question.orderIndex,
          selectedOptionId: null,
          codeAnswer,
          isCorrect: maxPoints > 0 && awarded === maxPoints,
          awarded,
          maxPoints,
          deferred: false,
          note: outcome?.kind === "scored" ? outcome.note : null,
          unanswered,
        };
      }

      // Option-keyed types: mcq, multiple_select, code_fix.
      const isCorrect = selectedOptionId != null && (key?.get(selectedOptionId) ?? false);
      return {
        questionId: question.id,
        type: question.type,
        orderIndex: question.orderIndex,
        selectedOptionId,
        codeAnswer: null,
        isCorrect,
        // clampAwarded, not `isCorrect ? points : 0`, so the ceiling rule has one
        // implementation for every question type.
        awarded: clampAwarded(isCorrect ? maxPoints : 0, maxPoints),
        maxPoints,
        deferred: false,
        note: null,
        unanswered,
      };
    });
}

// ---------------------------------------------------------------------------
// I6 — the summary
// ---------------------------------------------------------------------------

/**
 * Summarise graded rows into the totals the student is shown.
 *
 * `provisional` is `deferredCount > 0` — an if-and-only-if, not a heuristic. A
 * total labelled final never changes afterwards, and a total labelled provisional
 * can only rise: every deferred row currently holds `awarded: 0`, and I5 forbids
 * a negative award, so instructor grading adds between 0 and `maxPoints`.
 * `deferredPointsOutstanding` is exactly that headroom.
 */
/**
 * The pass threshold to judge an exam against, as a percentage.
 *
 * Takes the EXAM'S OWN `quizzes.passing_score` when it has one, and only falls
 * back to the frozen practice threshold when it does not.
 *
 * This was `QUIZ_PASS_PERCENT` unconditionally, which produced two contradictory
 * numbers on one screen: the seeder writes `passing_score = 60` for every grand
 * exam and the result card renders that as "Pass mark 60%", while `passed` was
 * computed against 70 — so a student on 65% saw "Not passed" beside "Pass mark
 * 60%", on an exam they cannot retake. Reading the row makes the badge and the
 * chip the same fact.
 *
 * This is NOT a second copy of the scoring contract's maths: the comparison and
 * the fallback both still come from `@/lib/contracts/scoring`. It only lets a
 * quiz row override its own threshold, which is what that column is for.
 */
export function examPassThreshold(passingScore: number | null | undefined): number {
  if (typeof passingScore !== "number" || !Number.isFinite(passingScore)) {
    return QUIZ_PASS_PERCENT;
  }
  // Clamp: a hand-edited row must not make an exam unpassable or free.
  return Math.min(100, Math.max(0, passingScore));
}

export function summariseExam(
  rows: readonly ExamAnswerRow[],
  passingScore?: number | null,
): ExamSummary {
  const score = sumAwarded(rows);
  const totalPossible = sumMaxPoints(rows);
  const deferredRows = rows.filter((row) => row.deferred);
  const deferredCount = deferredRows.length;
  const threshold = examPassThreshold(passingScore);

  return {
    score,
    totalPossible,
    percentage: percentageOf(score, totalPossible),
    passed: percentageOf(score, totalPossible) >= threshold,
    deferredCount,
    provisional: deferredCount > 0,
    unansweredCount: rows.filter((row) => row.unanswered).length,
    deferredPointsOutstanding: sumMaxPoints(deferredRows),
  };
}

/** Grade an exam end to end: rows for every question (I4) plus the totals (I5, I6). */
export function gradeExam(params: {
  questions: readonly ExamGradableQuestion[];
  options: readonly ExamGradableOption[];
  saved: readonly ExamSavedAnswer[];
  codeOutcomes: readonly CodeOutcome[];
  /** The exam's own `quizzes.passing_score`. Omitted falls back to the practice threshold. */
  passingScore?: number | null;
}): ExamGradeResult {
  const rows = buildExamAnswerRows(params);
  return { rows, ...summariseExam(rows, params.passingScore) };
}

/**
 * The most the total can become once the deferred items are graded.
 *
 * Exists so the claim in I6 — "a provisional total can only rise, never fall" —
 * is a function with a test rather than a sentence in a comment.
 */
export function provisionalCeiling(summary: ExamSummary): number {
  return summary.score + summary.deferredPointsOutstanding;
}

// ---------------------------------------------------------------------------
// Reading a STORED attempt back (the repeat-submit path)
// ---------------------------------------------------------------------------

/**
 * How many items of a stored attempt are (or may be) awaiting instructor grading.
 *
 * WHY THIS IS AN ESTIMATE, AND WHY THE ESTIMATE IS SAFE.
 *
 * `answers` has no `deferred` column — the schema is frozen and this stream may
 * not add one. At submit time the exact count is known in process and returned
 * in the response; on a LATER read (a repeat submit, a page refresh, the result
 * view) it has to be derived from stored columns, and a `code_write` row holding
 * `awarded = 0` is genuinely ambiguous: the code may have failed its tests, or
 * Piston may have been unreachable.
 *
 * The derivation is therefore deliberately OVER-inclusive, gated on the attempt
 * still being `submitted` rather than `graded`. Over-counting keeps the total
 * labelled provisional for slightly too long, which is harmless: the number
 * shown is still the sum of awarded marks and can still only rise. UNDER-counting
 * would be the dangerous direction — it would print "final" over a total that
 * later moved.
 *
 * Returns 0 for a `graded` attempt, because nothing was deferred when it closed.
 *
 * TODO(shared-contracts): an `answers.deferred boolean not null default false`
 * column would make this exact. Reported rather than added — the seam is frozen.
 */
export function deferredCandidateCount(
  status: string,
  rows: readonly { type: string; awarded: number; maxPoints: number }[],
): number {
  if (status !== "submitted") return 0;
  return rows.filter(
    (row) => row.type === "code_write" && row.maxPoints > 0 && row.awarded === 0,
  ).length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whitespace-only code is not an answer. Normalising to null here means an
 * empty editor is `unanswered` in the result AND is never sent to Piston, which
 * matters: 50 students each submitting 8 empty programs would exhaust the shared
 * free instance for the cohort to grade nothing.
 */
function normaliseCode(code: string | null | undefined): string | null {
  if (code == null) return null;
  return code.trim().length === 0 ? null : code;
}

function compareOrder(
  a: { orderIndex: number; id: number },
  b: { orderIndex: number; id: number },
): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}
