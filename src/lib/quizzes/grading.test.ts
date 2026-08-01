// =============================================================================
// UNIT TESTS — quiz grading. Owner: quizzes stream.
// -----------------------------------------------------------------------------
// Assertions are expressed through the frozen scoring contract
// (QUIZ_PASS_PERCENT, QUIZ_FAIL_PERCENT, quizPointsFromPercent) rather than
// hardcoded numbers. If a threshold or a band ever moves in scoring.ts, these
// tests move with it instead of turning red for the wrong reason.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  POINTS,
  QUIZ_FAIL_PERCENT,
  QUIZ_PASS_PERCENT,
  quizPointsFromPercent,
  shouldUnlockNextWeek,
} from "@/lib/contracts/scoring";

import {
  attemptsRemaining,
  bestPercent,
  canAttempt,
  gradeSubmission,
  percentageOf,
  type GradableOption,
  type GradableQuestion,
} from "./grading";

// ---------------------------------------------------------------------------
// Fixture: an N-question quiz, 4 options each, option index 0 is correct.
// Question ids are 1..N; option ids are questionId * 10 + optionIndex.
// ---------------------------------------------------------------------------
const OPTIONS_PER_QUESTION = 4;

function buildQuiz(questionCount: number): {
  questions: GradableQuestion[];
  options: GradableOption[];
  correctOptionFor: (questionId: number) => number;
  wrongOptionFor: (questionId: number) => number;
} {
  const questions: GradableQuestion[] = [];
  const options: GradableOption[] = [];

  for (let q = 1; q <= questionCount; q += 1) {
    questions.push({ id: q, explanation: `Because of reason ${q}.` });
    for (let o = 0; o < OPTIONS_PER_QUESTION; o += 1) {
      options.push({ id: q * 10 + o, questionId: q, isCorrect: o === 0 });
    }
  }

  return {
    questions,
    options,
    correctOptionFor: (questionId) => questionId * 10,
    wrongOptionFor: (questionId) => questionId * 10 + 1,
  };
}

/** The seeded shape: 10 questions per quiz (scripts/seed.ts asserts this). */
const SEEDED_QUESTIONS_PER_QUIZ = 10;

describe("percentageOf", () => {
  it("returns 0 for a quiz with no questions instead of NaN", () => {
    expect(percentageOf(0, 0)).toBe(0);
  });

  it("rounds to two decimal places, matching decimal(5,2) storage", () => {
    // 2/3 = 66.666... -> 66.67, which must be the same value the API compares
    // against the threshold and the value written to the column.
    expect(percentageOf(2, 3)).toBe(66.67);
    expect(percentageOf(1, 3)).toBe(33.33);
  });

  it("scores a full quiz as 100", () => {
    expect(percentageOf(10, 10)).toBe(100);
  });
});

describe("gradeSubmission", () => {
  it("all correct: full score, passes, and earns the top quiz band", () => {
    const { questions, options, correctOptionFor } = buildQuiz(SEEDED_QUESTIONS_PER_QUIZ);

    const result = gradeSubmission({
      questions,
      options,
      submitted: questions.map((q) => ({
        questionId: q.id,
        selectedOptionId: correctOptionFor(q.id),
      })),
    });

    expect(result.score).toBe(SEEDED_QUESTIONS_PER_QUIZ);
    expect(result.totalPossible).toBe(SEEDED_QUESTIONS_PER_QUIZ);
    expect(result.percentage).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.ignored).toEqual([]);
    expect(result.answers.every((a) => a.isCorrect)).toBe(true);
    // Contract-driven, not hardcoded:
    expect(quizPointsFromPercent(result.percentage)).toBe(POINTS.QUIZ_MAX);
    expect(shouldUnlockNextWeek(result.percentage)).toBe(true);
  });

  it("all wrong: zero score, fails, earns no points, no unlock", () => {
    const { questions, options, wrongOptionFor } = buildQuiz(SEEDED_QUESTIONS_PER_QUIZ);

    const result = gradeSubmission({
      questions,
      options,
      submitted: questions.map((q) => ({
        questionId: q.id,
        selectedOptionId: wrongOptionFor(q.id),
      })),
    });

    expect(result.score).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.percentage).toBeLessThan(QUIZ_FAIL_PERCENT);
    expect(quizPointsFromPercent(result.percentage)).toBe(0);
    expect(shouldUnlockNextWeek(result.percentage)).toBe(false);
    // Every question still produces a graded row — "wrong" is not "missing".
    expect(result.answers).toHaveLength(SEEDED_QUESTIONS_PER_QUIZ);
    expect(result.answers.every((a) => a.selectedOptionId != null)).toBe(true);
  });

  it("partial at exactly the pass mark passes and unlocks", () => {
    // 7/10 == QUIZ_PASS_PERCENT. The boundary is inclusive per scoring.ts.
    const correctCount = (QUIZ_PASS_PERCENT / 100) * SEEDED_QUESTIONS_PER_QUIZ;
    const { questions, options, correctOptionFor, wrongOptionFor } =
      buildQuiz(SEEDED_QUESTIONS_PER_QUIZ);

    const result = gradeSubmission({
      questions,
      options,
      submitted: questions.map((q, i) => ({
        questionId: q.id,
        selectedOptionId: i < correctCount ? correctOptionFor(q.id) : wrongOptionFor(q.id),
      })),
    });

    expect(result.score).toBe(correctCount);
    expect(result.percentage).toBe(QUIZ_PASS_PERCENT);
    expect(result.passed).toBe(true);
    expect(shouldUnlockNextWeek(result.percentage)).toBe(true);
    expect(quizPointsFromPercent(result.percentage)).toBe(POINTS.QUIZ_MAX);
  });

  it("partial one mark below the pass mark fails but still scores a band", () => {
    const correctCount = (QUIZ_PASS_PERCENT / 100) * SEEDED_QUESTIONS_PER_QUIZ - 1;
    const { questions, options, correctOptionFor, wrongOptionFor } =
      buildQuiz(SEEDED_QUESTIONS_PER_QUIZ);

    const result = gradeSubmission({
      questions,
      options,
      submitted: questions.map((q, i) => ({
        questionId: q.id,
        selectedOptionId: i < correctCount ? correctOptionFor(q.id) : wrongOptionFor(q.id),
      })),
    });

    expect(result.passed).toBe(false);
    expect(shouldUnlockNextWeek(result.percentage)).toBe(false);
    // Above the hard-fail line, so the banded scale still awards something.
    expect(result.percentage).toBeGreaterThanOrEqual(QUIZ_FAIL_PERCENT);
    expect(quizPointsFromPercent(result.percentage)).toBeGreaterThan(0);
    expect(quizPointsFromPercent(result.percentage)).toBeLessThan(POINTS.QUIZ_MAX);
  });

  it("an unanswered question is graded incorrect with a null selection, and still counts in the denominator", () => {
    const { questions, options, correctOptionFor } = buildQuiz(SEEDED_QUESTIONS_PER_QUIZ);
    const skipped = questions[3];

    const result = gradeSubmission({
      questions,
      options,
      submitted: questions
        .filter((q) => q.id !== skipped.id)
        .map((q) => ({ questionId: q.id, selectedOptionId: correctOptionFor(q.id) })),
    });

    // The denominator is the quiz, not the payload: omitting a question must not
    // turn 9/10 into 9/9.
    expect(result.totalPossible).toBe(SEEDED_QUESTIONS_PER_QUIZ);
    expect(result.score).toBe(SEEDED_QUESTIONS_PER_QUIZ - 1);
    expect(result.percentage).toBe(percentageOf(SEEDED_QUESTIONS_PER_QUIZ - 1, SEEDED_QUESTIONS_PER_QUIZ));

    const skippedAnswer = result.answers.find((a) => a.questionId === skipped.id);
    expect(skippedAnswer).toBeDefined();
    expect(skippedAnswer?.selectedOptionId).toBeNull();
    expect(skippedAnswer?.isCorrect).toBe(false);
  });

  it("duplicate answers for one question: the first is graded, the rest are ignored", () => {
    const { questions, options, correctOptionFor, wrongOptionFor } = buildQuiz(2);

    const result = gradeSubmission({
      questions,
      options,
      submitted: [
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
        // A second pair for question 1 must not be able to overwrite or double-count.
        { questionId: 1, selectedOptionId: wrongOptionFor(1) },
        { questionId: 2, selectedOptionId: correctOptionFor(2) },
      ],
    });

    expect(result.score).toBe(2);
    expect(result.answers).toHaveLength(2);
    expect(result.answers[0].selectedOptionId).toBe(correctOptionFor(1));
    expect(result.ignored).toEqual([
      { questionId: 1, selectedOptionId: wrongOptionFor(1), reason: "duplicate_question" },
    ]);
  });

  it("duplicates cannot inflate the score past the question count", () => {
    const { questions, options, correctOptionFor } = buildQuiz(2);

    const result = gradeSubmission({
      questions,
      options,
      submitted: [
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
      ],
    });

    expect(result.score).toBe(1);
    expect(result.percentage).toBe(percentageOf(1, 2));
    expect(result.ignored).toHaveLength(2);
  });

  it("an option id belonging to a different question is discarded, not scored", () => {
    const { questions, options, correctOptionFor } = buildQuiz(3);

    // Question 2 is answered with question 1's CORRECT option id. Accepting it
    // would both award a mark and store another question's option on the answer row.
    const result = gradeSubmission({
      questions,
      options,
      submitted: [
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
        { questionId: 2, selectedOptionId: correctOptionFor(1) },
        { questionId: 3, selectedOptionId: correctOptionFor(3) },
      ],
    });

    expect(result.score).toBe(2);
    const q2 = result.answers.find((a) => a.questionId === 2);
    expect(q2?.selectedOptionId).toBeNull();
    expect(q2?.isCorrect).toBe(false);
    expect(result.ignored).toEqual([
      { questionId: 2, selectedOptionId: correctOptionFor(1), reason: "option_not_in_question" },
    ]);
  });

  it("an option id that does not exist at all is discarded", () => {
    const { questions, options } = buildQuiz(1);

    const result = gradeSubmission({
      questions,
      options,
      submitted: [{ questionId: 1, selectedOptionId: 999_999 }],
    });

    expect(result.score).toBe(0);
    expect(result.ignored[0].reason).toBe("option_not_in_question");
  });

  it("a question id from another quiz is ignored and does not change the denominator", () => {
    const { questions, options, correctOptionFor } = buildQuiz(2);

    const result = gradeSubmission({
      questions,
      options,
      submitted: [
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
        { questionId: 4242, selectedOptionId: 42_420 },
      ],
    });

    expect(result.totalPossible).toBe(2);
    expect(result.score).toBe(1);
    expect(result.ignored).toEqual([
      { questionId: 4242, selectedOptionId: 42_420, reason: "unknown_question" },
    ]);
  });

  it("submitting nothing grades every question incorrect rather than throwing", () => {
    const { questions, options } = buildQuiz(SEEDED_QUESTIONS_PER_QUIZ);

    const result = gradeSubmission({ questions, options, submitted: [] });

    expect(result.score).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.answers).toHaveLength(SEEDED_QUESTIONS_PER_QUIZ);
    expect(result.answers.every((a) => a.selectedOptionId === null)).toBe(true);
  });

  it("carries the seeded explanation onto every graded answer, right or wrong", () => {
    const { questions, options, correctOptionFor, wrongOptionFor } = buildQuiz(2);

    const result = gradeSubmission({
      questions,
      options,
      submitted: [
        { questionId: 1, selectedOptionId: correctOptionFor(1) },
        { questionId: 2, selectedOptionId: wrongOptionFor(2) },
      ],
    });

    expect(result.answers[0].explanation).toBe("Because of reason 1.");
    expect(result.answers[1].explanation).toBe("Because of reason 2.");
  });

  it("preserves the supplied question order in the graded answers", () => {
    const { questions, options } = buildQuiz(5);
    const result = gradeSubmission({ questions, options, submitted: [] });
    expect(result.answers.map((a) => a.questionId)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("attemptsRemaining / canAttempt", () => {
  /** The seeded and configured allowance (app.config quiz.attemptsAllowed). */
  const ALLOWED = 3;

  it("counts down from the allowance", () => {
    expect(attemptsRemaining(ALLOWED, 0)).toBe(ALLOWED);
    expect(attemptsRemaining(ALLOWED, 1)).toBe(ALLOWED - 1);
    expect(attemptsRemaining(ALLOWED, 2)).toBe(1);
  });

  it("reaches zero on the last allowed attempt and blocks the next one", () => {
    expect(attemptsRemaining(ALLOWED, ALLOWED)).toBe(0);
    expect(canAttempt(ALLOWED, ALLOWED)).toBe(false);
  });

  it("permits attempts 1..3 and refuses the 4th", () => {
    expect(canAttempt(ALLOWED, 0)).toBe(true);
    expect(canAttempt(ALLOWED, 1)).toBe(true);
    expect(canAttempt(ALLOWED, 2)).toBe(true);
    // The 4th attempt: three already used.
    expect(canAttempt(ALLOWED, 3)).toBe(false);
  });

  it("never returns a negative remaining count when the allowance is lowered later", () => {
    expect(attemptsRemaining(ALLOWED, ALLOWED + 5)).toBe(0);
    expect(canAttempt(ALLOWED, ALLOWED + 5)).toBe(false);
  });

  it("treats a zero allowance as no attempts at all", () => {
    expect(attemptsRemaining(0, 0)).toBe(0);
    expect(canAttempt(0, 0)).toBe(false);
  });
});

describe("bestPercent", () => {
  it("is null with no attempts, distinguishing 'not attempted' from 'scored zero'", () => {
    expect(bestPercent([])).toBeNull();
  });

  it("returns the maximum, so best counts rather than latest", () => {
    expect(bestPercent([90, 40])).toBe(90);
    expect(bestPercent([10, 55.5, 33])).toBe(55.5);
  });

  it("keeps a pass earned on an earlier attempt", () => {
    const best = bestPercent([QUIZ_PASS_PERCENT + 20, 0]);
    expect(best).not.toBeNull();
    expect(shouldUnlockNextWeek(best as number)).toBe(true);
  });

  it("returns 0 (not null) when every attempt scored zero", () => {
    expect(bestPercent([0, 0])).toBe(0);
  });
});
