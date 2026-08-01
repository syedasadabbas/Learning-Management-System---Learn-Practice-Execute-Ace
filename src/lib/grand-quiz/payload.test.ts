// =============================================================================
// THE ANSWER-LEAK BARRIER — asserted after a JSON round trip.
// -----------------------------------------------------------------------------
// Follows the precedent set by `src/lib/quizzes/payload.test.ts`: the input rows
// carry a FULL answer key and a FULL hidden test suite, and the assertions are that
// the keys are ABSENT from the output — not merely undefined. `undefined` would
// disappear through `Response.json` anyway; a key that survives with a value is the
// defect, and only a round trip proves it does not.
//
// The grand quiz adds one field the practice quiz never had: `questions.tests`.
// Leaking it turns "write a function" into "print these exact strings", which on a
// 120-minute one-attempt exam is the whole mark.
// =============================================================================

import { describe, expect, it } from "vitest";

import { quizPointsFromPercent } from "@/lib/contracts/scoring";

import {
  toExamInProgress,
  toExamMeta,
  toExamResultFromStored,
  type ExamAttemptRowLike,
  type ExamOptionRowLike,
  type ExamQuestionRowLike,
  type ExamQuizRowLike,
} from "./payload";

const NOW = new Date("2026-07-30T10:30:00.000Z");

const QUIZ: ExamQuizRowLike = {
  id: 4,
  weekId: 2,
  title: "Week 2 exam",
  kind: "grand",
  totalQuestions: 50,
  passingScore: 70,
  timeLimitMinutes: 120,
};

/** Rows carrying every secret this barrier exists to strip. */
const QUESTIONS: ExamQuestionRowLike[] = [
  {
    id: 1,
    questionText: "Which selector matches by class?",
    type: "mcq",
    orderIndex: 0,
    points: 1,
    language: null,
    starterCode: null,
    explanation: "THE ANSWER IS THE DOT SELECTOR — this names the right answer in prose.",
    tests: null,
  },
  {
    id: 2,
    questionText: "Write a function that squares its input.",
    type: "code_write",
    orderIndex: 1,
    points: 8,
    language: "python",
    starterCode: "def square(n):\n    ...",
    explanation: "Multiply n by itself.",
    tests: [
      { name: "one", input: "1", expected: "1" },
      { name: "two", input: "2", expected: "4" },
      { name: "secret", input: "99", expected: "9801" },
    ],
  },
];

const OPTIONS: ExamOptionRowLike[] = [
  { id: 10, questionId: 1, optionText: ".name", orderIndex: 0, isCorrect: true },
  { id: 11, questionId: 1, optionText: "#name", orderIndex: 1, isCorrect: false },
  { id: 12, questionId: 1, optionText: "name", orderIndex: 2, isCorrect: false },
];

const ATTEMPT: ExamAttemptRowLike = {
  id: 55,
  status: "in_progress",
  startedAt: new Date("2026-07-30T09:00:00.000Z"),
  deadlineAt: new Date("2026-07-30T11:00:00.000Z"),
  submittedAt: null,
  autoSubmitted: false,
  score: 0,
  totalPossible: 9,
};

/** Every key present anywhere in a JSON value, at any depth. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allKeys(entry, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      allKeys(nested, into);
    }
  }
  return into;
}

/** Every string appearing anywhere in a JSON value. */
function allStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const entry of value) allStrings(entry, into);
  else if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value)) allStrings(nested, into);
  }
  return into;
}

describe("toExamInProgress (the barrier)", () => {
  const payload = toExamInProgress({
    quiz: QUIZ,
    questions: QUESTIONS,
    options: OPTIONS,
    attempt: ATTEMPT,
    saved: [
      {
        questionId: 1,
        selectedOptionId: 10,
        codeAnswer: null,
        isCorrect: false,
        awarded: 0,
        maxPoints: 0,
      },
    ],
    now: NOW,
  });
  const roundTripped = JSON.parse(JSON.stringify(payload)) as unknown;
  const keys = allKeys(roundTripped);

  it("carries NO `isCorrect` key anywhere, after a JSON round trip", () => {
    expect(keys.has("isCorrect")).toBe(false);
  });

  it("carries NO `explanation` key anywhere — it names the answer in prose", () => {
    expect(keys.has("explanation")).toBe(false);
  });

  it("carries NO `tests` key anywhere — the hidden tests ARE the answer", () => {
    expect(keys.has("tests")).toBe(false);
  });

  it("does not leak the hidden tests' expected values as loose strings either", () => {
    // A `tests` key stripped but its contents smuggled into some other field would
    // pass the key assertions above. Check the values too.
    const strings = allStrings(roundTripped);
    expect(strings).not.toContain("9801");
    expect(strings.some((text) => text.includes("THE ANSWER IS"))).toBe(false);
  });

  it("does carry what the student legitimately needs", () => {
    expect(payload.questions.map((question) => question.id)).toEqual([1, 2]);
    expect(payload.questions[0]?.options.map((option) => option.optionText)).toEqual([
      ".name",
      "#name",
      "name",
    ]);
    // Marks per question: a student budgeting 120 minutes is entitled to know
    // which questions are worth more, and it reveals nothing.
    expect(payload.questions[1]?.points).toBe(8);
    expect(payload.quiz.totalPoints).toBe(9);
    // Starter code is the skeleton / the broken program, never a solution.
    expect(payload.questions[1]?.starterCode).toBe("def square(n):\n    ...");
  });

  it("restores the student's saved work so a reload loses nothing", () => {
    expect(payload.saved).toEqual([{ questionId: 1, selectedOptionId: 10, codeAnswer: null }]);
  });

  it("seeds the countdown from the SERVER's clock and the STORED deadline (I2)", () => {
    expect(payload.attempt.countdown).toEqual({
      deadlineAtMs: ATTEMPT.deadlineAt?.getTime(),
      serverNowMs: NOW.getTime(),
      remainingMs: 30 * 60_000,
      expired: false,
    });
  });

  it("sorts questions and options by orderIndex, whatever order the rows arrive in", () => {
    const shuffled = toExamInProgress({
      quiz: QUIZ,
      questions: [...QUESTIONS].reverse(),
      options: [...OPTIONS].reverse(),
      attempt: ATTEMPT,
      saved: [],
      now: NOW,
    });
    expect(shuffled.questions.map((question) => question.id)).toEqual([1, 2]);
    expect(shuffled.questions[0]?.options.map((option) => option.id)).toEqual([10, 11, 12]);
  });
});

describe("toExamMeta", () => {
  it("falls back to the documented 120 minutes when the row has no limit", () => {
    expect(toExamMeta({ ...QUIZ, timeLimitMinutes: null }, QUESTIONS).timeLimitMinutes).toBe(120);
  });

  it("totalPoints is the SUM of question weights, not the question count", () => {
    expect(toExamMeta(QUIZ, QUESTIONS).totalPoints).toBe(9);
    expect(toExamMeta(QUIZ, QUESTIONS).totalQuestions).toBe(2);
  });
});

describe("toExamResultFromStored (the I3 replay path)", () => {
  const submittedAttempt: ExamAttemptRowLike = {
    ...ATTEMPT,
    status: "graded",
    submittedAt: new Date("2026-07-30T10:45:00.000Z"),
    score: 1,
    totalPossible: 9,
  };

  const result = toExamResultFromStored({
    attempt: submittedAttempt,
    quiz: QUIZ,
    questions: QUESTIONS.map((question) => ({
      id: question.id,
      questionText: question.questionText,
      type: question.type,
      orderIndex: question.orderIndex,
      points: question.points,
      explanation: question.explanation,
    })),
    options: OPTIONS,
    stored: [
      {
        questionId: 1,
        selectedOptionId: 10,
        codeAnswer: null,
        isCorrect: true,
        awarded: 1,
        maxPoints: 1,
      },
      {
        questionId: 2,
        selectedOptionId: null,
        codeAnswer: null,
        isCorrect: false,
        awarded: 0,
        maxPoints: 8,
      },
    ],
    quizPointsFor: quizPointsFromPercent,
    replayed: true,
  });

  it("is the STORED sum, so a replay shows the same number as the first submit", () => {
    expect(result.score).toBe(1);
    expect(result.totalPossible).toBe(9);
    expect(result.percentage).toBe(11.11);
    expect(result.replayed).toBe(true);
  });

  it("has one answer entry per question (I4), even for questions never touched", () => {
    expect(result.answers).toHaveLength(2);
    expect(result.unansweredCount).toBe(1);
  });

  it("MAY reveal the explanation — the attempt is terminal, so nothing is at risk", () => {
    expect(result.answers[0]?.explanation).toContain("THE ANSWER IS");
  });

  it("still does NOT carry the hidden tests", () => {
    const keys = allKeys(JSON.parse(JSON.stringify(result)) as unknown);
    expect(keys.has("tests")).toBe(false);
    expect(allStrings(result)).not.toContain("9801");
  });

  it("is self-contained: each answer carries its own question and chosen option text", () => {
    // So the result renders on a cold page load with no in-progress payload around.
    expect(result.answers[0]?.questionText).toBe("Which selector matches by class?");
    expect(result.answers[0]?.selectedOptionText).toBe(".name");
    expect(result.answers[1]?.selectedOptionText).toBeNull();
  });

  it("a `graded` attempt is never labelled provisional", () => {
    expect(result.deferredCount).toBe(0);
    expect(result.provisional).toBe(false);
    // And the ceiling equals the score, because nothing is outstanding.
    expect(result.provisionalCeiling).toBe(result.score);
  });

  it("a `submitted` attempt with an unscored code item IS labelled provisional, and can only rise", () => {
    const provisional = toExamResultFromStored({
      attempt: { ...submittedAttempt, status: "submitted" },
      quiz: QUIZ,
      questions: QUESTIONS.map((question) => ({
        id: question.id,
        questionText: question.questionText,
        type: question.type,
        orderIndex: question.orderIndex,
        points: question.points,
        explanation: question.explanation,
      })),
      options: OPTIONS,
      stored: [
        {
          questionId: 1,
          selectedOptionId: 10,
          codeAnswer: null,
          isCorrect: true,
          awarded: 1,
          maxPoints: 1,
        },
        {
          questionId: 2,
          selectedOptionId: null,
          codeAnswer: "def square(n): return n*n",
          isCorrect: false,
          awarded: 0,
          maxPoints: 8,
        },
      ],
      quizPointsFor: quizPointsFromPercent,
      replayed: false,
    });

    expect(provisional.deferredCount).toBe(1);
    expect(provisional.provisional).toBe(true);
    expect(provisional.provisionalCeiling).toBe(9);
    expect(provisional.provisionalCeiling).toBeGreaterThanOrEqual(provisional.score);
  });

  it("records elapsed time from the stored start and submit instants", () => {
    expect(result.elapsedMs).toBe(105 * 60_000);
  });
});
