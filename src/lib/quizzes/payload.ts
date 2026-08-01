// =============================================================================
// STUDENT-FACING QUIZ PAYLOAD — the answer-leak barrier.
// -----------------------------------------------------------------------------
// Owner: quizzes stream.
//
// `GET /api/weeks/:weekId/quiz` must not tell the client which option is right.
// Passing the Drizzle rows straight through would do exactly that: `options`
// carries `isCorrect`, and `questions` carries `explanation` (which names the
// right answer in prose). Either one turns the browser network tab into an
// answer key.
//
// The defence is structural rather than a reminder in a comment:
//
//   1. `StudentOption` / `StudentQuestion` have NO `isCorrect` or `explanation`
//      field, and are built by explicit field copy — never by spreading a row.
//      A later `...option` would fail typecheck under `exactOptionalPropertyTypes`
//      only sometimes, so spreading is banned by construction here instead.
//   2. `toStudentQuiz` is the only way the route builds its body, and it is
//      unit-tested to assert the keys are absent (not merely undefined) even
//      when handed rows whose answer key is set.
// =============================================================================

import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import { attemptsRemaining, bestPercent } from "./grading";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** An option as the student may see it. No correctness flag, by design. */
export interface StudentOption {
  id: number;
  optionText: string;
  orderIndex: number;
}

/** A question as the student may see it. No explanation — it names the answer. */
export interface StudentQuestion {
  id: number;
  questionText: string;
  type: string;
  orderIndex: number;
  options: StudentOption[];
}

export interface StudentQuizMeta {
  id: number;
  weekId: number;
  title: string;
  totalQuestions: number;
  passingScore: number;
  attemptsAllowed: number;
  /** Null when untimed. Minutes, as stored; the UI converts to ms. */
  timeLimitMinutes: number | null;
}

export interface StudentQuizPayload {
  quiz: StudentQuizMeta;
  questions: StudentQuestion[];
  attemptsUsed: number;
  attemptsRemaining: number;
  /** Best percentage so far, or null when never attempted. */
  bestPercent: number | null;
  /** Derived from bestPercent so the UI never re-implements the threshold. */
  passed: boolean;
  /** False once the attempt budget is spent. The UI hides the form; the API still enforces. */
  canAttempt: boolean;
}

// ---------------------------------------------------------------------------
// Row shapes accepted as input (structurally compatible with the Drizzle rows,
// including their answer-key fields — which is the point: they go in, they do
// not come out).
// ---------------------------------------------------------------------------

export interface QuizRowLike {
  id: number;
  weekId: number;
  title: string;
  totalQuestions: number;
  passingScore: number;
  attemptsAllowed: number;
  timeLimitMinutes: number | null;
}

export interface QuestionRowLike {
  id: number;
  questionText: string;
  type: string;
  orderIndex: number;
  explanation: string | null;
}

export interface OptionRowLike {
  id: number;
  questionId: number;
  optionText: string;
  orderIndex: number;
  isCorrect: boolean;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the student-safe quiz payload.
 *
 * Questions and options are sorted by `orderIndex` (then `id` as a stable
 * tiebreak) here rather than relying on the query's ORDER BY, so the shape is
 * deterministic in unit tests that pass rows in any order.
 */
export function toStudentQuiz(params: {
  quiz: QuizRowLike;
  questions: readonly QuestionRowLike[];
  options: readonly OptionRowLike[];
  /** Percentages of every existing attempt by this student on this quiz. */
  attemptPercentages: readonly number[];
}): StudentQuizPayload {
  const { quiz, questions, options, attemptPercentages } = params;

  const byQuestion = new Map<number, StudentOption[]>();
  for (const opt of options) {
    // Explicit field copy. `isCorrect` is read nowhere below and therefore
    // cannot be serialised, regardless of what the row carries.
    const safe: StudentOption = {
      id: opt.id,
      optionText: opt.optionText,
      orderIndex: opt.orderIndex,
    };
    const list = byQuestion.get(opt.questionId);
    if (list) list.push(safe);
    else byQuestion.set(opt.questionId, [safe]);
  }
  for (const list of byQuestion.values()) list.sort(compareOrder);

  const safeQuestions: StudentQuestion[] = questions
    .map((q) => ({
      id: q.id,
      questionText: q.questionText,
      type: q.type,
      orderIndex: q.orderIndex,
      options: byQuestion.get(q.id) ?? [],
    }))
    .sort(compareOrder);

  const used = attemptPercentages.length;
  const best = bestPercent(attemptPercentages);
  const remaining = attemptsRemaining(quiz.attemptsAllowed, used);

  return {
    quiz: {
      id: quiz.id,
      weekId: quiz.weekId,
      title: quiz.title,
      totalQuestions: quiz.totalQuestions,
      passingScore: quiz.passingScore,
      attemptsAllowed: quiz.attemptsAllowed,
      timeLimitMinutes: quiz.timeLimitMinutes,
    },
    questions: safeQuestions,
    attemptsUsed: used,
    attemptsRemaining: remaining,
    bestPercent: best,
    // Imported threshold, never a literal — see scoring.ts.
    passed: best != null && best >= QUIZ_PASS_PERCENT,
    canAttempt: remaining > 0,
  };
}

function compareOrder(
  a: { orderIndex: number; id: number },
  b: { orderIndex: number; id: number },
): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}
