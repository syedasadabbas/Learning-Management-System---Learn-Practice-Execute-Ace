// =============================================================================
// QUIZ GRADING — pure functions, no database, no I/O.
// -----------------------------------------------------------------------------
// Owner: quizzes stream.
//
// Everything in this file is deterministic and side-effect free so it can be
// unit-tested without a Postgres connection (see grading.test.ts). The route
// handler supplies rows it has already read; this module decides the outcome.
//
// SCORING IS NOT DEFINED HERE. Percentage -> points and the pass/unlock
// thresholds live in `src/lib/contracts/scoring.ts` and are imported. A second
// copy of that maths is the exact defect the frozen seam exists to prevent, so
// this file must never contain a literal 70, 60 or 50.
//
// Units: all durations are milliseconds (ms), per house rule 5.
// =============================================================================

import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The answer key for one option, as read from `options`. */
export interface GradableOption {
  id: number;
  questionId: number;
  isCorrect: boolean;
}

/** One question of the quiz being graded, as read from `questions`. */
export interface GradableQuestion {
  id: number;
  /** Revealed to the student only in the graded result, never in the GET payload. */
  explanation: string | null;
}

/** One `{ questionId, selectedOptionId }` pair from `quizSubmitSchema`. */
export interface SubmittedAnswer {
  questionId: number;
  selectedOptionId: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** Why a submitted pair was not counted. Surfaced for diagnostics, not scored. */
export type IgnoredAnswerReason =
  /** A second (or later) pair for a question already answered in this payload. */
  | "duplicate_question"
  /** The questionId does not belong to this quiz. */
  | "unknown_question"
  /** The optionId exists elsewhere, or nowhere, but not under this question. */
  | "option_not_in_question";

export interface IgnoredAnswer {
  questionId: number;
  selectedOptionId: number;
  reason: IgnoredAnswerReason;
}

/**
 * The graded outcome for one question. There is exactly one of these per
 * question in the quiz, including questions the student left blank — a missing
 * row would make "unanswered" indistinguishable from "not graded yet".
 */
export interface GradedAnswer {
  questionId: number;
  /** Null when unanswered, or when the submitted option was discarded. */
  selectedOptionId: number | null;
  isCorrect: boolean;
  /** The seeded explanation. Safe here: this shape is post-grading only. */
  explanation: string | null;
}

export interface GradeResult {
  /** One entry per quiz question, in the order the questions were supplied. */
  answers: GradedAnswer[];
  /** Number of correct answers. */
  score: number;
  /** Number of questions in the quiz. */
  totalPossible: number;
  /** score / totalPossible as a percentage, rounded to 2 decimal places. */
  percentage: number;
  /** True when `percentage >= QUIZ_PASS_PERCENT`. */
  passed: boolean;
  /** Submitted pairs that were not counted, with the reason. */
  ignored: IgnoredAnswer[];
}

// ---------------------------------------------------------------------------
// Percentage
// ---------------------------------------------------------------------------

/**
 * Percentage rounded to 2 decimal places, matching the
 * `decimal(5,2)` precision of `quiz_attempts.percentage`. Rounding here rather
 * than letting Postgres do it means the value compared against
 * `QUIZ_PASS_PERCENT` in memory is the value stored — otherwise a 69.995 could
 * fail in the API response and pass on the next read.
 *
 * A quiz with no questions scores 0 rather than NaN.
 */
export function percentageOf(score: number, totalPossible: number): number {
  if (totalPossible <= 0) return 0;
  return Math.round((score / totalPossible) * 10_000) / 100;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade a submission against the answer key.
 *
 * Deliberate decisions, each of which a naive implementation gets wrong:
 *
 *  - **Questions drive the result, not the payload.** Iterating the submitted
 *    answers would let a client shrink the denominator by omitting questions it
 *    could not answer, turning 3/10 into 3/3.
 *  - **Duplicates: first pair wins.** A payload with two options for one
 *    question is not a licence to score that question twice; the later pairs
 *    are reported in `ignored`. (Trade-off: rejecting the whole submission was
 *    the alternative. First-wins is chosen because the schema stores one
 *    `selectedOptionId` per answer row, so there is no shape in which a second
 *    pair could be honoured.)
 *  - **Cross-question option ids are discarded, not scored.** Writing an option
 *    belonging to another question into `answers.selectedOptionId` would store
 *    data that renders as somebody else's answer text forever.
 *  - **`type` is ignored.** The schema allows `multiple_select`, but
 *    `quizSubmitSchema` carries a single option per question, so every question
 *    is graded as single-answer. See TODO below.
 *
 * TODO(quizzes): `multiple_select` questions cannot be expressed in
 * `quizSubmitSchema` (one `selectedOptionId` per `questionId`) nor stored in
 * `answers` (one `selected_option_id` column). All 40 seeded questions are
 * `mcq`, so nothing is mis-graded today. Supporting multi-select is a
 * shared-contracts change (schema + validation), not a quizzes-stream change.
 */
export function gradeSubmission(params: {
  questions: readonly GradableQuestion[];
  options: readonly GradableOption[];
  submitted: readonly SubmittedAnswer[];
}): GradeResult {
  const { questions, options, submitted } = params;

  const questionIds = new Set(questions.map((q) => q.id));

  // questionId -> (optionId -> isCorrect). Lets us validate ownership and
  // correctness in one lookup.
  const optionsByQuestion = new Map<number, Map<number, boolean>>();
  for (const opt of options) {
    let forQuestion = optionsByQuestion.get(opt.questionId);
    if (!forQuestion) {
      forQuestion = new Map<number, boolean>();
      optionsByQuestion.set(opt.questionId, forQuestion);
    }
    forQuestion.set(opt.id, opt.isCorrect);
  }

  const ignored: IgnoredAnswer[] = [];
  /** questionId -> the accepted option id. */
  const accepted = new Map<number, number>();

  for (const pair of submitted) {
    if (!questionIds.has(pair.questionId)) {
      ignored.push({ ...pair, reason: "unknown_question" });
      continue;
    }
    if (accepted.has(pair.questionId)) {
      ignored.push({ ...pair, reason: "duplicate_question" });
      continue;
    }
    const forQuestion = optionsByQuestion.get(pair.questionId);
    if (!forQuestion?.has(pair.selectedOptionId)) {
      ignored.push({ ...pair, reason: "option_not_in_question" });
      continue;
    }
    accepted.set(pair.questionId, pair.selectedOptionId);
  }

  const answers: GradedAnswer[] = questions.map((q) => {
    const selectedOptionId = accepted.get(q.id) ?? null;
    const isCorrect =
      selectedOptionId != null &&
      (optionsByQuestion.get(q.id)?.get(selectedOptionId) ?? false);
    return {
      questionId: q.id,
      selectedOptionId,
      isCorrect,
      explanation: q.explanation,
    };
  });

  const score = answers.reduce((n, a) => n + (a.isCorrect ? 1 : 0), 0);
  const totalPossible = questions.length;
  const percentage = percentageOf(score, totalPossible);

  return {
    answers,
    score,
    totalPossible,
    percentage,
    passed: percentage >= QUIZ_PASS_PERCENT,
    ignored,
  };
}

// ---------------------------------------------------------------------------
// Attempt budget
// ---------------------------------------------------------------------------

/**
 * Attempts the student may still take. Never negative: a historical over-count
 * (e.g. `attemptsAllowed` lowered by an admin after the fact) must read as 0
 * remaining, not as a negative that a `> 0` check would mishandle.
 */
export function attemptsRemaining(attemptsAllowed: number, attemptsUsed: number): number {
  return Math.max(0, attemptsAllowed - attemptsUsed);
}

/** May another attempt be started? The server-side gate for the 4th attempt. */
export function canAttempt(attemptsAllowed: number, attemptsUsed: number): boolean {
  return attemptsRemaining(attemptsAllowed, attemptsUsed) > 0;
}

/**
 * Best percentage across attempts. Best counts, not latest — so a student who
 * scores 90 then 40 keeps the unlock earned at 90.
 *
 * Returns null when there are no attempts, which is what
 * `PenaltyRuleInput.quizBestPercent` and `WeekProgress.quizBestPercent` both
 * document as "no attempt yet". A 0 would read as "attempted and scored zero".
 */
export function bestPercent(percentages: readonly number[]): number | null {
  if (percentages.length === 0) return null;
  return percentages.reduce((a, b) => (b > a ? b : a));
}
