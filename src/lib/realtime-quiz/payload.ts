// =============================================================================
// INLINE CHECK PAYLOAD — the answer-leak barrier for `quizzes.kind = 'realtime'`.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// WHY this is stricter than src/lib/quizzes/payload.ts rather than a copy of it.
// A realtime check gives feedback the instant the student answers, which makes
// "just ship the answer key and decide in the browser" the obvious cheap
// implementation — and a pointless one: a knowledge check whose answers are in
// the network tab before the student commits teaches nothing. So the client
// payload here carries LESS than the graded quiz payload does:
//
//   * no `isCorrect` and no `explanation` (same as the graded barrier);
//   * no `tests` / `starterCode` — realtime is MCQ only, and those columns are
//     answer-key material for the grand-quiz kind;
//   * no `passingScore`, `attemptsAllowed`, `timeLimitMinutes` — a realtime check
//     has no pass mark and unlimited attempts, so shipping those fields would
//     imply a grade exists. There is none. See ./reveal.ts for how feedback is
//     obtained instead: one server round trip AFTER the student commits.
//
// The defence is structural, exactly as in the graded barrier: the output types
// have no such fields and every value is copied field by field. Nothing here
// spreads a database row, so no future column can leak by accident.
//
// This module is PURE — no database, no React. It is unit-tested by
// ./payload.test.ts against rows whose answer key is populated.
// =============================================================================

/** An option as the student may see it before answering. No correctness flag. */
export interface InlineOption {
  id: number;
  optionText: string;
  orderIndex: number;
}

/** A question as the student may see it. No explanation — it names the answer. */
export interface InlineQuestion {
  id: number;
  questionText: string;
  orderIndex: number;
  options: InlineOption[];
}

/**
 * One inline knowledge check, ready to render inside a lecture.
 *
 * Deliberately has no score, no attempt count and no pass threshold: there is
 * nothing to total up. A caller that wants to award marks for this cannot,
 * because this shape gives it nothing to award them from.
 */
export interface InlineCheck {
  quizId: number;
  weekId: number;
  title: string;
  questions: InlineQuestion[];
}

// ---------------------------------------------------------------------------
// Row shapes accepted as input — structurally compatible with the Drizzle rows
// INCLUDING their answer-key fields. That is the point: they go in, and the
// unit test proves they do not come out.
// ---------------------------------------------------------------------------

export interface RealtimeQuizRowLike {
  id: number;
  weekId: number;
  title: string;
  kind: string;
}

export interface RealtimeQuestionRowLike {
  id: number;
  questionText: string;
  type: string;
  orderIndex: number;
  explanation: string | null;
}

export interface RealtimeOptionRowLike {
  id: number;
  questionId: number;
  optionText: string;
  orderIndex: number;
  isCorrect: boolean;
}

/** The one `quizzes.kind` value this stream is allowed to touch. */
export const REALTIME_KIND = "realtime" as const;

/**
 * Is this quiz row a realtime check?
 *
 * Every read and every reveal in this stream funnels through this predicate, so
 * a realtime code path can never be pointed at a practice or grand quiz — which
 * would turn the instant-feedback endpoint into a universal answer-key oracle
 * for graded work. Kind is checked against the stored column, never inferred
 * from `attemptsAllowed` (see the enum comment in src/db/schema.ts).
 */
export function isRealtimeQuiz(row: { kind: string }): boolean {
  return row.kind === REALTIME_KIND;
}

/**
 * The question types a realtime check renders. MCQ only: instant client-side
 * feedback for free-form code would need Piston, which is the grand-quiz
 * stream's concern, and a half-supported type renders as a broken question.
 */
const RENDERABLE_TYPES: readonly string[] = ["mcq"];

/**
 * Build the student-safe inline check.
 *
 * Questions and options are sorted here rather than relying on the query's
 * ORDER BY so the shape is deterministic for tests that pass rows in any order.
 * Questions with no options are dropped: an MCQ with nothing to pick is an
 * authoring error and rendering it as an empty fieldset is worse than omitting
 * it.
 */
export function toInlineCheck(params: {
  quiz: RealtimeQuizRowLike;
  questions: readonly RealtimeQuestionRowLike[];
  options: readonly RealtimeOptionRowLike[];
}): InlineCheck {
  const { quiz, questions, options } = params;

  const byQuestion = new Map<number, InlineOption[]>();
  for (const opt of options) {
    // Explicit field copy. `isCorrect` is read nowhere below, so it cannot be
    // serialised regardless of what the row carries.
    const safe: InlineOption = {
      id: opt.id,
      optionText: opt.optionText,
      orderIndex: opt.orderIndex,
    };
    const list = byQuestion.get(opt.questionId);
    if (list) list.push(safe);
    else byQuestion.set(opt.questionId, [safe]);
  }
  for (const list of byQuestion.values()) list.sort(compareOrder);

  const safeQuestions: InlineQuestion[] = questions
    .filter((q) => RENDERABLE_TYPES.includes(q.type))
    .map((q) => ({
      id: q.id,
      questionText: q.questionText,
      orderIndex: q.orderIndex,
      options: byQuestion.get(q.id) ?? [],
    }))
    .filter((q) => q.options.length > 0)
    .sort(compareOrder);

  return {
    quizId: quiz.id,
    weekId: quiz.weekId,
    title: quiz.title,
    questions: safeQuestions,
  };
}

function compareOrder(
  a: { orderIndex: number; id: number },
  b: { orderIndex: number; id: number },
): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}
