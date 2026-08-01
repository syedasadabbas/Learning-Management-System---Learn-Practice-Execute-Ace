// =============================================================================
// STUDENT-FACING EXAM PAYLOAD — the answer-leak barrier for the grand quiz.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream. Follows the pattern established by
// `src/lib/quizzes/payload.ts` and adds the two fields the add-on wave introduced.
//
// THREE THINGS MUST NEVER REACH THE BROWSER BEFORE SUBMIT:
//
//   options.isCorrect        the answer key, literally.
//   questions.explanation    names the right answer in prose, so it IS the key.
//   questions.tests          the hidden tests for a `code_write` item. Leaking
//                            these turns "write a function" into "print these
//                            exact strings", and on a 120-minute one-attempt exam
//                            that is the whole mark.
//
// `questions.tests` is the new one and the easiest to leak, because unlike
// `isCorrect` it lives on the question row itself — the row a naive
// `db.select().from(questions)` hands straight to `Response.json`.
//
// THE DEFENCE IS STRUCTURAL, NOT A REMINDER:
//
//   1. `ExamQuestion` / `ExamOption` have NO `isCorrect`, `explanation` or
//      `tests` field, so assigning a row to one is a type error.
//   2. Every field is copied EXPLICITLY. There is no spread of a database row
//      anywhere in this file. A future `...question` would therefore be a visible
//      edit to a hand-written literal, not an invisible widening.
//   3. `payload.test.ts` round-trips the output through JSON and asserts the keys
//      are ABSENT — not merely undefined — even when the input rows carry a full
//      answer key and a full test suite.
//
// The post-submit shapes (`ExamResult`, `ExamResultAnswer`) DO carry
// `explanation` and correctness, because at that point the exam is terminal (I3)
// and there is nothing left to protect. They still never carry `tests`: those are
// reused across cohorts.
// =============================================================================

import {
  countdownSeed,
  effectiveTimeLimitMinutes,
  elapsedMs,
  type CountdownSeed,
} from "./timing";
// The same score->percentage helper the practice engine uses: one definition, so
// an exam percentage and a quiz percentage can never round differently.
import { percentageOf } from "@/lib/quizzes/grading";

import {
  deferredCandidateCount,
  examPassThreshold,
  provisionalCeiling,
  summariseExam,
  type ExamAnswerRow,
  type ExamSummary,
} from "./grading";
import { isProvisionalStatus } from "./state";

// ---------------------------------------------------------------------------
// Pre-submit shapes (no answer key)
// ---------------------------------------------------------------------------

/** An option as the student may see it. No correctness flag, by design. */
export interface ExamOption {
  id: number;
  optionText: string;
  orderIndex: number;
}

/**
 * A question as the student may see it during the exam.
 *
 * No `explanation` (it names the answer) and no `tests` (they are the answer for
 * a `code_write` item). `points` IS included: a student sitting a weighted exam is
 * entitled to know which questions carry more marks so they can budget 120
 * minutes, and it reveals nothing.
 */
export interface ExamQuestion {
  id: number;
  questionText: string;
  /** `mcq` | `multiple_select` | `code_write` | `code_fix`. */
  type: string;
  orderIndex: number;
  points: number;
  /** Editor language for code items; null for MCQs. */
  language: string | null;
  /** Skeleton for `code_write`, the broken program for `code_fix`. Never a solution. */
  starterCode: string | null;
  options: ExamOption[];
}

export interface ExamMeta {
  id: number;
  weekId: number;
  title: string;
  /** Always `"grand"` for this stream; carried so a client cannot be handed a practice quiz. */
  kind: string;
  totalQuestions: number;
  passingScore: number;
  /** Minutes, as stored. The UI converts; see ./timing.ts for the ms rule. */
  timeLimitMinutes: number;
  /** SUM of `questions.points` — the denominator, which is NOT the question count. */
  totalPoints: number;
}

/** The student's own attempt, as the exam page needs it. */
export interface ExamAttemptMeta {
  id: number;
  status: string;
  startedAtMs: number;
  autoSubmitted: boolean;
  /**
   * The server's authoritative timing, for the countdown only (I2). Nothing
   * derived from these values is ever sent back and believed.
   */
  countdown: CountdownSeed;
}

/** One answer the student has already saved, so a reload restores their work. */
export interface ExamSavedSelection {
  questionId: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
}

/** The in-progress exam payload. Carries no answer key of any kind. */
export interface ExamInProgressPayload {
  quiz: ExamMeta;
  attempt: ExamAttemptMeta;
  questions: ExamQuestion[];
  saved: ExamSavedSelection[];
}

// ---------------------------------------------------------------------------
// Row shapes accepted as input
// ---------------------------------------------------------------------------
// Structurally compatible with the Drizzle rows INCLUDING their answer-key
// fields. That is the point: the key goes in, it does not come out.

export interface ExamQuizRowLike {
  id: number;
  weekId: number;
  title: string;
  kind: string;
  totalQuestions: number;
  passingScore: number;
  timeLimitMinutes: number | null;
}

export interface ExamQuestionRowLike {
  id: number;
  questionText: string;
  type: string;
  orderIndex: number;
  points: number;
  language: string | null;
  starterCode: string | null;
  /** The answer key in prose. Read here, never copied out. */
  explanation: string | null;
  /** The hidden tests. Read here, never copied out. */
  tests: unknown;
}

export interface ExamOptionRowLike {
  id: number;
  questionId: number;
  optionText: string;
  orderIndex: number;
  /** The answer key. Read here, never copied out. */
  isCorrect: boolean;
}

export interface ExamAttemptRowLike {
  id: number;
  status: string;
  startedAt: Date;
  deadlineAt: Date | null;
  submittedAt: Date | null;
  autoSubmitted: boolean;
  score: number;
  totalPossible: number;
}

export interface ExamStoredAnswerRowLike {
  questionId: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
  isCorrect: boolean;
  awarded: number;
  maxPoints: number;
}

// ---------------------------------------------------------------------------
// Builders — pre-submit
// ---------------------------------------------------------------------------

/**
 * Build the in-progress exam payload.
 *
 * Ordering is applied here rather than trusted from the query, so a unit test may
 * pass rows in any order and the shape is still deterministic — and so the
 * question numbering a student sees cannot change between two reads of the same
 * attempt.
 */
export function toExamInProgress(params: {
  quiz: ExamQuizRowLike;
  questions: readonly ExamQuestionRowLike[];
  options: readonly ExamOptionRowLike[];
  attempt: ExamAttemptRowLike;
  saved: readonly ExamStoredAnswerRowLike[];
  /** The SERVER's instant. Never a client-supplied time (I2). */
  now: Date;
}): ExamInProgressPayload {
  const { quiz, questions, options, attempt, saved, now } = params;

  const optionsByQuestion = new Map<number, ExamOption[]>();
  for (const option of options) {
    // Explicit field copy. `isCorrect` is not read below, so it cannot be
    // serialised regardless of what the row carries.
    const safe: ExamOption = {
      id: option.id,
      optionText: option.optionText,
      orderIndex: option.orderIndex,
    };
    const list = optionsByQuestion.get(option.questionId);
    if (list) list.push(safe);
    else optionsByQuestion.set(option.questionId, [safe]);
  }
  for (const list of optionsByQuestion.values()) list.sort(compareOrder);

  const safeQuestions: ExamQuestion[] = questions
    .map((question) => ({
      // Explicit field copy. `explanation` and `tests` are not read.
      id: question.id,
      questionText: question.questionText,
      type: question.type,
      orderIndex: question.orderIndex,
      points: question.points,
      language: question.language,
      starterCode: question.starterCode,
      options: optionsByQuestion.get(question.id) ?? [],
    }))
    .sort(compareOrder);

  return {
    quiz: toExamMeta(quiz, questions),
    attempt: toExamAttemptMeta(attempt, now),
    questions: safeQuestions,
    saved: saved.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionId: answer.selectedOptionId,
      codeAnswer: answer.codeAnswer,
    })),
  };
}

export function toExamMeta(
  quiz: ExamQuizRowLike,
  questions: readonly { points: number }[],
): ExamMeta {
  return {
    id: quiz.id,
    weekId: quiz.weekId,
    title: quiz.title,
    kind: quiz.kind,
    totalQuestions: questions.length,
    passingScore: quiz.passingScore,
    // Normalised through ./timing so the page and the grader agree on the limit
    // even when the row was authored without one.
    timeLimitMinutes: effectiveTimeLimitMinutes(quiz.timeLimitMinutes),
    totalPoints: questions.reduce((sum, q) => sum + Math.max(0, Math.floor(q.points)), 0),
  };
}

export function toExamAttemptMeta(attempt: ExamAttemptRowLike, now: Date): ExamAttemptMeta {
  return {
    id: attempt.id,
    status: attempt.status,
    startedAtMs: attempt.startedAt.getTime(),
    autoSubmitted: attempt.autoSubmitted,
    countdown: countdownSeed(attempt.deadlineAt, now),
  };
}

// ---------------------------------------------------------------------------
// Builders — post-submit
// ---------------------------------------------------------------------------

/**
 * One question's outcome, as shown after submit.
 *
 * `explanation` appears here and only here: the attempt is terminal, so revealing
 * it cannot help anyone re-answer. `tests` still does NOT appear — hidden tests
 * outlive one attempt and are reused for the next cohort.
 */
export interface ExamResultAnswer {
  questionId: number;
  /**
   * The question, restated in the result.
   *
   * Carried on the answer rather than looked up from a separate `questions` prop
   * so the result view is SELF-CONTAINED: a student who reloads the page after
   * submitting has no in-progress payload in memory, and a result that could only
   * render beside one would show "Question 7" with no question.
   */
  questionText: string;
  /** The text of the option they chose, or null. Safe post-submit; the attempt is terminal. */
  selectedOptionText: string | null;
  type: string;
  orderIndex: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
  isCorrect: boolean;
  awarded: number;
  maxPoints: number;
  /** Awaiting instructor grading. `awarded` is 0 now and can only rise (I6). */
  deferred: boolean;
  note: string | null;
  unanswered: boolean;
  explanation: string | null;
}

/**
 * The submit response, and the result view's payload — one shape, so the two can
 * never disagree about a score (I6).
 */
export interface ExamResult {
  attemptId: number;
  quizId: number;
  weekId: number;
  status: string;
  /** SUM of `awarded` (I5). */
  score: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  passingScore: number;
  /** Weekly quiz points from the frozen banded scale. Never recomputed here. */
  quizPoints: number;
  /** Items awaiting instructor grading. */
  deferredCount: number;
  /** True iff `deferredCount > 0`. The only condition under which the UI says "provisional". */
  provisional: boolean;
  /** The most the total can become. Never below `score` — that is the I6 guarantee. */
  provisionalCeiling: number;
  unansweredCount: number;
  /** Closed by the timer rather than by the student pressing Submit. */
  autoSubmitted: boolean;
  startedAtMs: number;
  submittedAtMs: number | null;
  elapsedMs: number | null;
  answers: ExamResultAnswer[];
  /** True when this response replayed an already-recorded result rather than scoring (I3). */
  replayed: boolean;
}

/**
 * Build the result from rows this process just graded.
 *
 * `quizPoints` comes from `quizPointsFromPercent` in the frozen scoring contract,
 * imported by the caller and passed in, so this module holds no band maths.
 */
export function toExamResultFromGraded(params: {
  attempt: { id: number; startedAt: Date; submittedAt: Date | null; autoSubmitted: boolean };
  quiz: { id: number; weekId: number; passingScore: number };
  status: string;
  rows: readonly ExamAnswerRow[];
  summary: ExamSummary;
  quizPoints: number;
  /** questionId -> its text and explanation. */
  questionMeta: ReadonlyMap<number, { questionText: string; explanation: string | null }>;
  /** optionId -> its text, for restating the student's choice. */
  optionText: ReadonlyMap<number, string>;
  replayed: boolean;
}): ExamResult {
  const {
    attempt,
    quiz,
    status,
    rows,
    summary,
    quizPoints,
    questionMeta,
    optionText,
    replayed,
  } = params;

  return {
    attemptId: attempt.id,
    quizId: quiz.id,
    weekId: quiz.weekId,
    status,
    score: summary.score,
    totalPossible: summary.totalPossible,
    percentage: summary.percentage,
    passed: summary.passed,
    passingScore: quiz.passingScore,
    quizPoints,
    deferredCount: summary.deferredCount,
    provisional: summary.provisional,
    provisionalCeiling: provisionalCeiling(summary),
    unansweredCount: summary.unansweredCount,
    autoSubmitted: attempt.autoSubmitted,
    startedAtMs: attempt.startedAt.getTime(),
    submittedAtMs: attempt.submittedAt ? attempt.submittedAt.getTime() : null,
    elapsedMs: attempt.submittedAt ? elapsedMs(attempt.startedAt, attempt.submittedAt) : null,
    answers: rows.map((row) => ({
      questionId: row.questionId,
      questionText: questionMeta.get(row.questionId)?.questionText ?? "",
      selectedOptionText:
        row.selectedOptionId == null ? null : optionText.get(row.selectedOptionId) ?? null,
      type: row.type,
      orderIndex: row.orderIndex,
      selectedOptionId: row.selectedOptionId,
      codeAnswer: row.codeAnswer,
      isCorrect: row.isCorrect,
      awarded: row.awarded,
      maxPoints: row.maxPoints,
      deferred: row.deferred,
      note: row.note,
      unanswered: row.unanswered,
      explanation: questionMeta.get(row.questionId)?.explanation ?? null,
    })),
    replayed,
  };
}

/**
 * Rebuild the result from STORED rows, for a repeat submit or a result-view read.
 *
 * This is the I3 replay path: nothing is re-scored and nothing is written. The
 * score is the stored `awarded` sum, so it is byte-for-byte the number the
 * student saw the first time.
 *
 * The one thing that cannot be read back exactly is which items were deferred —
 * `answers` has no such column. `deferredCandidateCount` derives it
 * over-inclusively from the attempt status; see its doc comment for why
 * over-counting is the safe direction.
 */
export function toExamResultFromStored(params: {
  attempt: ExamAttemptRowLike;
  quiz: { id: number; weekId: number; passingScore: number };
  questions: readonly {
    id: number;
    questionText: string;
    type: string;
    orderIndex: number;
    points: number;
    explanation: string | null;
  }[];
  /** Every option of every question, for restating the student's choice. */
  options: readonly { id: number; optionText: string }[];
  stored: readonly ExamStoredAnswerRowLike[];
  quizPointsFor: (percent: number) => number;
  replayed: boolean;
}): ExamResult {
  const { attempt, quiz, questions, options, stored, quizPointsFor, replayed } = params;

  const storedByQuestion = new Map<number, ExamStoredAnswerRowLike>();
  for (const row of stored) storedByQuestion.set(row.questionId, row);

  const provisionalNow = isProvisionalStatus(attempt.status);
  const deferredEstimate = deferredCandidateCount(
    attempt.status,
    questions.map((question) => {
      const row = storedByQuestion.get(question.id);
      return {
        type: question.type,
        awarded: row?.awarded ?? 0,
        maxPoints: row?.maxPoints ?? Math.max(0, Math.floor(question.points)),
      };
    }),
  );
  const deferredIds = new Set<number>();
  if (provisionalNow) {
    for (const question of questions) {
      if (question.type !== "code_write") continue;
      const row = storedByQuestion.get(question.id);
      const maxPoints = row?.maxPoints ?? Math.max(0, Math.floor(question.points));
      if (maxPoints > 0 && (row?.awarded ?? 0) === 0) deferredIds.add(question.id);
    }
  }

  const rows: ExamAnswerRow[] = questions
    .slice()
    .sort(compareOrder)
    .map((question) => {
      const row = storedByQuestion.get(question.id);
      const maxPoints = row?.maxPoints ?? Math.max(0, Math.floor(question.points));
      return {
        questionId: question.id,
        type: question.type,
        orderIndex: question.orderIndex,
        selectedOptionId: row?.selectedOptionId ?? null,
        codeAnswer: row?.codeAnswer ?? null,
        isCorrect: row?.isCorrect ?? false,
        awarded: row?.awarded ?? 0,
        maxPoints,
        deferred: deferredIds.has(question.id),
        note: deferredIds.has(question.id)
          ? "Awaiting instructor grading. Your total can only go up."
          : null,
        unanswered: (row?.selectedOptionId ?? null) === null && (row?.codeAnswer ?? null) === null,
      };
    });

  // The exam's own pass mark (see examPassThreshold): judging a replayed result
  // against the practice threshold made the badge disagree with the pass-mark
  // chip rendered next to it.
  const summary = summariseExam(rows, quiz.passingScore);
  const questionMeta = new Map(
    questions.map((question) => [
      question.id,
      { questionText: question.questionText, explanation: question.explanation },
    ]),
  );
  const optionText = new Map(options.map((option) => [option.id, option.optionText]));

  // THE RECORDED TOTALS WIN over anything recomputed here.
  //
  // `summary` is rebuilt by iterating the CURRENT `questions` rows, which means
  // its denominator tracks the quiz as it is now, not as it was when the student
  // sat it. An admin adding a 51st question to a graded exam (which
  // /admin/quizzes permits) turned a final 45/50 = 90% into 45/55 = 81.8% on the
  // next page load, and deleting a question moved it the other way. Either
  // direction is an I6 violation: a total labelled FINAL must never change.
  //
  // `quiz_attempts.score` and `.total_possible` are what the submit transaction
  // committed, so they are the student's actual result. They are preferred here
  // and `summary` is used only as a fallback for a row predating those columns.
  // The per-question breakdown below still comes from `summary`, which is correct
  // — it is a view of the stored answers, not a re-scoring of them.
  const recordedTotal =
    Number.isFinite(attempt.totalPossible) && attempt.totalPossible > 0
      ? attempt.totalPossible
      : summary.totalPossible;
  const recordedScore = Number.isFinite(attempt.score) ? attempt.score : summary.score;
  const recordedPercentage = percentageOf(recordedScore, recordedTotal);

  return {
    attemptId: attempt.id,
    quizId: quiz.id,
    weekId: quiz.weekId,
    status: attempt.status,
    score: recordedScore,
    totalPossible: recordedTotal,
    percentage: recordedPercentage,
    passed: recordedPercentage >= examPassThreshold(quiz.passingScore),
    passingScore: quiz.passingScore,
    quizPoints: quizPointsFor(summary.percentage),
    deferredCount: deferredEstimate,
    provisional: deferredEstimate > 0,
    provisionalCeiling: provisionalCeiling(summary),
    unansweredCount: summary.unansweredCount,
    autoSubmitted: attempt.autoSubmitted,
    startedAtMs: attempt.startedAt.getTime(),
    submittedAtMs: attempt.submittedAt ? attempt.submittedAt.getTime() : null,
    elapsedMs: attempt.submittedAt ? elapsedMs(attempt.startedAt, attempt.submittedAt) : null,
    answers: rows.map((row) => ({
      questionId: row.questionId,
      questionText: questionMeta.get(row.questionId)?.questionText ?? "",
      selectedOptionText:
        row.selectedOptionId == null ? null : optionText.get(row.selectedOptionId) ?? null,
      type: row.type,
      orderIndex: row.orderIndex,
      selectedOptionId: row.selectedOptionId,
      codeAnswer: row.codeAnswer,
      isCorrect: row.isCorrect,
      awarded: row.awarded,
      maxPoints: row.maxPoints,
      deferred: row.deferred,
      note: row.note,
      unanswered: row.unanswered,
      explanation: questionMeta.get(row.questionId)?.explanation ?? null,
    })),
    replayed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareOrder(
  a: { orderIndex: number; id: number },
  b: { orderIndex: number; id: number },
): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}

