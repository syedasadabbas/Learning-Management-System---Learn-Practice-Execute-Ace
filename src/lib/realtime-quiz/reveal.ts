// =============================================================================
// PER-QUESTION REVEAL — pure feedback maths for an inline knowledge check.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// WHY a separate module from the payload builder: these two are opposites and
// keeping them apart makes the barrier readable. `payload.ts` produces what the
// browser may hold BEFORE the student commits (no answer key). This produces what
// the browser may hold AFTER (the answer key for that one question, and only
// that one). One question's key at a time is what makes instant feedback
// possible without handing over the whole check.
//
// WHY it returns no score, no points and no percentage. It cannot be
// accidentally wired into grading, because there is no number in the return
// shape to add to anything. `isCorrect` here is a teaching signal, not a mark:
// nothing persists it, nothing totals it. The negative tests in
// ./no-grade-effects.test.ts hold that line against future refactors.
//
// PURE: no database, no React, never throws. Every failure is a value, so a
// malformed authoring row degrades to "we cannot check this right now" instead of
// a 500 inside a lecture page the student was reading.
// =============================================================================

/**
 * What the student is told once they commit an answer.
 *
 * `explanation` is revealed HERE and nowhere earlier — it names the right answer
 * in prose, which is exactly why `payload.ts` omits it.
 */
export interface AnswerReveal {
  questionId: number;
  selectedOptionId: number;
  /** Teaching signal only. Not a mark; nothing stores or totals this. */
  isCorrect: boolean;
  /** Which option was right, so the UI can point at it after the fact. */
  correctOptionId: number;
  explanation: string | null;
}

export type RevealFailureCode =
  /** The submitted option does not belong to the submitted question. */
  | "unknown_option"
  /** The question has no `isCorrect` option — an authoring error, not the student's. */
  | "no_answer_key"
  /** More than one option is flagged correct; ambiguous, so refuse rather than guess. */
  | "ambiguous_answer_key";

export type RevealOutcome =
  | { ok: true; reveal: AnswerReveal }
  | { ok: false; code: RevealFailureCode; error: string };

export interface AnswerKeyOptionRow {
  id: number;
  isCorrect: boolean;
}

/**
 * Decide the feedback for one committed answer.
 *
 * @param question    id and explanation of the question being answered
 * @param options     every option of that question, with the answer key
 * @param selectedOptionId what the student committed to
 */
export function revealAnswer(params: {
  question: { id: number; explanation: string | null };
  options: readonly AnswerKeyOptionRow[];
  selectedOptionId: number;
}): RevealOutcome {
  const { question, options, selectedOptionId } = params;

  if (!options.some((o) => o.id === selectedOptionId)) {
    // Checked before the answer key is consulted: a client that posts an option
    // id from a different question must not learn anything about this one.
    return {
      ok: false,
      code: "unknown_option",
      error: "That answer does not belong to this question.",
    };
  }

  const correct = options.filter((o) => o.isCorrect);
  if (correct.length === 0) {
    return {
      ok: false,
      code: "no_answer_key",
      error: "This question has no correct answer recorded, so it cannot be checked.",
    };
  }
  if (correct.length > 1) {
    return {
      ok: false,
      code: "ambiguous_answer_key",
      error: "This question has more than one correct answer recorded, so it cannot be checked.",
    };
  }

  const correctOption = correct[0];
  return {
    ok: true,
    reveal: {
      questionId: question.id,
      selectedOptionId,
      isCorrect: correctOption.id === selectedOptionId,
      correctOptionId: correctOption.id,
      explanation: question.explanation,
    },
  };
}
