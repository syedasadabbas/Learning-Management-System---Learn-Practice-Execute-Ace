// =============================================================================
// Inline-check payload tests — the answer-leak barrier.
// -----------------------------------------------------------------------------
// Modelled on src/lib/quizzes/payload.test.ts, and stricter: the assertions check
// the keys are ABSENT after a JSON round trip, not merely undefined. `undefined`
// disappears in JSON, so `toBeUndefined()` would pass even for a payload that
// carries the answer key as `isCorrect: undefined` and later stops doing so.
//
// Every input row here has its answer key populated on purpose. That is the whole
// experiment: the key goes in, and must not come out.
// =============================================================================

import { describe, expect, it } from "vitest";

import { isRealtimeQuiz, REALTIME_KIND, toInlineCheck } from "./payload";

const quiz = { id: 7, weekId: 2, title: "Quick check: flexbox", kind: REALTIME_KIND };

const questions = [
  {
    id: 20,
    questionText: "Which axis does justify-content act on?",
    type: "mcq",
    orderIndex: 1,
    explanation: "justify-content distributes space along the MAIN axis.",
  },
  {
    id: 10,
    questionText: "What does display:flex do to children?",
    type: "mcq",
    orderIndex: 0,
    explanation: "It makes them flex items.",
  },
];

const options = [
  { id: 201, questionId: 20, optionText: "Cross axis", orderIndex: 1, isCorrect: false },
  { id: 200, questionId: 20, optionText: "Main axis", orderIndex: 0, isCorrect: true },
  { id: 100, questionId: 10, optionText: "Makes them flex items", orderIndex: 0, isCorrect: true },
  { id: 101, questionId: 10, optionText: "Nothing", orderIndex: 1, isCorrect: false },
];

describe("toInlineCheck strips the answer key", () => {
  const payload = toInlineCheck({ quiz, questions, options });
  const serialised = JSON.stringify(payload);

  it("emits no isCorrect anywhere in the wire form", () => {
    expect(serialised).not.toContain("isCorrect");
  });

  it("emits no explanation anywhere in the wire form", () => {
    expect(serialised).not.toContain("explanation");
    // The explanation text itself names the answer, so its prose must be gone too.
    expect(serialised).not.toContain("MAIN axis");
  });

  it("options have exactly the three student-safe keys", () => {
    for (const question of payload.questions) {
      for (const option of question.options) {
        expect(Object.keys(option).sort()).toEqual(["id", "optionText", "orderIndex"]);
      }
    }
  });

  it("questions have exactly the four student-safe keys", () => {
    for (const question of payload.questions) {
      expect(Object.keys(question).sort()).toEqual([
        "id",
        "options",
        "orderIndex",
        "questionText",
      ]);
    }
  });

  it("carries no pass mark, attempt budget or time limit — there is no grade to describe", () => {
    // Stricter than the graded barrier on purpose: shipping any of these would
    // imply a realtime check can be passed or failed. It cannot.
    expect(Object.keys(payload).sort()).toEqual(["questions", "quizId", "title", "weekId"]);
    for (const forbidden of [
      "passingScore",
      "attemptsAllowed",
      "attemptsRemaining",
      "timeLimitMinutes",
      "score",
      "percentage",
      "passed",
      "points",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("toInlineCheck ordering and filtering", () => {
  it("sorts questions and options by orderIndex regardless of input order", () => {
    const payload = toInlineCheck({ quiz, questions, options });
    expect(payload.questions.map((q) => q.id)).toEqual([10, 20]);
    expect(payload.questions[1].options.map((o) => o.id)).toEqual([200, 201]);
  });

  it("breaks an orderIndex tie on id so the shape is deterministic", () => {
    const tied = [
      { ...questions[0], id: 31, orderIndex: 0 },
      { ...questions[1], id: 30, orderIndex: 0 },
    ];
    const tiedOptions = [
      { id: 310, questionId: 31, optionText: "a", orderIndex: 0, isCorrect: true },
      { id: 300, questionId: 30, optionText: "b", orderIndex: 0, isCorrect: true },
    ];
    const payload = toInlineCheck({ quiz, questions: tied, options: tiedOptions });
    expect(payload.questions.map((q) => q.id)).toEqual([30, 31]);
  });

  it("drops non-MCQ questions rather than rendering a type it cannot check inline", () => {
    const withCode = [
      ...questions,
      {
        id: 40,
        questionText: "Write a flex container",
        type: "code_write",
        orderIndex: 2,
        explanation: null,
      },
    ];
    const payload = toInlineCheck({ quiz, questions: withCode, options });
    expect(payload.questions.map((q) => q.id)).toEqual([10, 20]);
  });

  it("drops a question with no options instead of emitting an empty fieldset", () => {
    const payload = toInlineCheck({
      quiz,
      questions,
      options: options.filter((o) => o.questionId === 10),
    });
    expect(payload.questions.map((q) => q.id)).toEqual([10]);
  });
});

describe("isRealtimeQuiz", () => {
  it("accepts only the stored realtime kind", () => {
    expect(isRealtimeQuiz({ kind: "realtime" })).toBe(true);
    expect(isRealtimeQuiz({ kind: "practice" })).toBe(false);
    expect(isRealtimeQuiz({ kind: "grand" })).toBe(false);
    expect(isRealtimeQuiz({ kind: "" })).toBe(false);
  });
});
