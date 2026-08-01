// =============================================================================
// UNIT TESTS — the answer-leak barrier. Owner: quizzes stream.
// -----------------------------------------------------------------------------
// These tests exist because "don't leak answers" is otherwise enforced only by a
// comment. They assert the KEYS ARE ABSENT (not merely undefined) after a
// round-trip through JSON, which is what the browser actually receives.
// =============================================================================

import { describe, expect, it } from "vitest";

import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import { toStudentQuiz, type OptionRowLike, type QuestionRowLike, type QuizRowLike } from "./payload";

const QUIZ: QuizRowLike = {
  id: 7,
  weekId: 1,
  title: "Week 1 — HTML5 Foundations",
  totalQuestions: 2,
  passingScore: QUIZ_PASS_PERCENT,
  attemptsAllowed: 3,
  timeLimitMinutes: null,
};

// Rows carrying a live answer key, deliberately: the point is that it goes in
// and does not come out.
const QUESTIONS: QuestionRowLike[] = [
  {
    id: 20,
    questionText: "Second question",
    type: "mcq",
    orderIndex: 1,
    explanation: "The answer is B because ...",
  },
  {
    id: 10,
    questionText: "First question",
    type: "mcq",
    orderIndex: 0,
    explanation: "The answer is A because ...",
  },
];

const OPTIONS: OptionRowLike[] = [
  { id: 102, questionId: 10, optionText: "A wrong", orderIndex: 1, isCorrect: false },
  { id: 101, questionId: 10, optionText: "A right", orderIndex: 0, isCorrect: true },
  { id: 201, questionId: 20, optionText: "B right", orderIndex: 0, isCorrect: true },
  { id: 202, questionId: 20, optionText: "B wrong", orderIndex: 1, isCorrect: false },
];

function serialised(attemptPercentages: number[] = []): string {
  return JSON.stringify(
    toStudentQuiz({ quiz: QUIZ, questions: QUESTIONS, options: OPTIONS, attemptPercentages }),
  );
}

describe("toStudentQuiz — answer leakage", () => {
  it("emits no isCorrect key anywhere in the serialised payload", () => {
    expect(serialised()).not.toContain("isCorrect");
  });

  it("emits no explanation key or explanation text", () => {
    const json = serialised();
    expect(json).not.toContain("explanation");
    expect(json).not.toContain("because");
  });

  it("options carry only id, text and order", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: [],
    });
    for (const question of payload.questions) {
      for (const option of question.options) {
        expect(Object.keys(option).sort()).toEqual(["id", "optionText", "orderIndex"]);
      }
    }
  });

  it("questions carry no answer-key field", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: [],
    });
    for (const question of payload.questions) {
      expect(Object.keys(question).sort()).toEqual([
        "id",
        "options",
        "orderIndex",
        "questionText",
        "type",
      ]);
    }
  });
});

describe("toStudentQuiz — shape and attempt state", () => {
  it("sorts questions and options by orderIndex regardless of input order", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: [],
    });
    expect(payload.questions.map((q) => q.id)).toEqual([10, 20]);
    expect(payload.questions[0].options.map((o) => o.id)).toEqual([101, 102]);
  });

  it("reports a fresh quiz as never attempted with the full allowance", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: [],
    });
    expect(payload.attemptsUsed).toBe(0);
    expect(payload.attemptsRemaining).toBe(QUIZ.attemptsAllowed);
    expect(payload.bestPercent).toBeNull();
    expect(payload.passed).toBe(false);
    expect(payload.canAttempt).toBe(true);
  });

  it("reports best (not latest) and the pass state from the imported threshold", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: [QUIZ_PASS_PERCENT + 10, 0],
    });
    expect(payload.bestPercent).toBe(QUIZ_PASS_PERCENT + 10);
    expect(payload.passed).toBe(true);
    expect(payload.attemptsUsed).toBe(2);
    expect(payload.attemptsRemaining).toBe(QUIZ.attemptsAllowed - 2);
    expect(payload.canAttempt).toBe(true);
  });

  it("closes the quiz once the allowance is spent", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: Array.from({ length: QUIZ.attemptsAllowed }, () => 10),
    });
    expect(payload.attemptsRemaining).toBe(0);
    expect(payload.canAttempt).toBe(false);
  });

  it("treats a score exactly on the pass mark as passed", () => {
    const payload = toStudentQuiz({
      quiz: QUIZ,
      questions: QUESTIONS,
      options: OPTIONS,
      attemptPercentages: [QUIZ_PASS_PERCENT],
    });
    expect(payload.passed).toBe(true);
  });
});
