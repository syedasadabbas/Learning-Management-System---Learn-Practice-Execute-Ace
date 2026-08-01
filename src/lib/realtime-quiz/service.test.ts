// =============================================================================
// Realtime-quiz service tests — THE DATABASE IS MOCKED AT THE QUERY BOUNDARY.
// -----------------------------------------------------------------------------
// tests/setup.ts points DATABASE_URL at a deliberately unreachable host, so `./queries`
// is replaced wholesale (it is the only module in this stream that imports @/db).
//
// The most valuable assertions in this file are the NEGATIVE ones in the last
// block. A realtime check that gains a progress write or a scoring event would
// still pass every positive test here while quietly corrupting grades, so:
//
//   * `@/db` is mocked with a pool whose insert/update/delete THROW. Taking a
//     realtime check must never reach them, so a future write shows up as a
//     failed test rather than as a row.
//   * `@/lib/leaderboard/on-scoring-event` is mocked with a spy asserted to have
//     zero calls across the whole flow.
//   * `@/lib/progress/read-model` is mocked likewise.
//
// Those mocks are intentionally set up even though the module under test does not
// import any of them today. That is the point: the test fails the moment it does.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  onScoringEvent: vi.fn(),
  getWeekProgress: vi.fn(),
  write: vi.fn(),
}));

// A realtime code path must never write. Any of these being reached is a defect,
// so they throw rather than record.
vi.mock("@/db", () => {
  const forbid = (statement: string) => () => {
    spies.write(statement);
    throw new Error(
      `[realtime-quiz] db.${statement}() was called. The realtime kind must never write.`,
    );
  };
  return {
    db: {
      select: () => {
        throw new Error("[realtime-quiz] the service must read through ./queries, not @/db.");
      },
      insert: forbid("insert"),
      update: forbid("update"),
      delete: forbid("delete"),
      transaction: forbid("transaction"),
    },
  };
});

vi.mock("@/lib/leaderboard/on-scoring-event", () => ({
  onScoringEvent: spies.onScoringEvent,
}));

vi.mock("@/lib/progress/read-model", () => ({
  getWeekProgress: spies.getWeekProgress,
}));

const queries = vi.hoisted(() => ({
  selectRealtimeQuizzesForWeek: vi.fn(),
  selectQuestionsAndOptions: vi.fn(),
  selectAnswerKeyContext: vi.fn(),
}));

vi.mock("./queries", () => queries);

import { checkInlineAnswer, loadInlineCheckForWeek, loadInlineChecksForWeek } from "./service";

const REALTIME_QUIZ = { id: 7, weekId: 2, title: "Quick check: flexbox", kind: "realtime" };

const QUESTION_SET = {
  questions: [
    {
      id: 10,
      questionText: "Which axis does justify-content act on?",
      type: "mcq",
      orderIndex: 0,
      explanation: "It distributes space along the main axis.",
    },
  ],
  options: [
    { id: 100, questionId: 10, optionText: "Main axis", orderIndex: 0, isCorrect: true },
    { id: 101, questionId: 10, optionText: "Cross axis", orderIndex: 1, isCorrect: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  queries.selectRealtimeQuizzesForWeek.mockResolvedValue([REALTIME_QUIZ]);
  queries.selectQuestionsAndOptions.mockResolvedValue(QUESTION_SET);
  queries.selectAnswerKeyContext.mockResolvedValue({
    question: { id: 10, explanation: QUESTION_SET.questions[0].explanation },
    quizKind: "realtime",
    options: [
      { id: 100, isCorrect: true },
      { id: 101, isCorrect: false },
    ],
  });
});

describe("loadInlineChecksForWeek", () => {
  it("returns the week's realtime check with the answer key stripped", async () => {
    const checks = await loadInlineChecksForWeek(2);
    expect(checks).toHaveLength(1);
    expect(JSON.stringify(checks)).not.toContain("isCorrect");
    expect(JSON.stringify(checks)).not.toContain("main axis");
  });

  it("takes no studentId — there is no per-student state for an ungraded check", () => {
    // Arity is the assertion: a studentId parameter appearing here would mean
    // attempt history, a best score or a budget crept in.
    expect(loadInlineChecksForWeek.length).toBe(1);
  });

  it("returns [] for a week with no realtime quiz, so the lecture still renders", async () => {
    queries.selectRealtimeQuizzesForWeek.mockResolvedValue([]);
    await expect(loadInlineChecksForWeek(2)).resolves.toEqual([]);
  });

  it("returns [] for a non-positive week id without querying at all", async () => {
    await expect(loadInlineChecksForWeek(0)).resolves.toEqual([]);
    await expect(loadInlineChecksForWeek(-1)).resolves.toEqual([]);
    await expect(loadInlineChecksForWeek(1.5)).resolves.toEqual([]);
    expect(queries.selectRealtimeQuizzesForWeek).not.toHaveBeenCalled();
  });

  it("drops a graded quiz even if the query stopped filtering on kind", async () => {
    // Defence in depth. If this ever regressed, a practice quiz's questions would
    // be served through the ungraded reveal path.
    queries.selectRealtimeQuizzesForWeek.mockResolvedValue([
      { ...REALTIME_QUIZ, kind: "practice" },
      { ...REALTIME_QUIZ, id: 8, kind: "grand" },
    ]);
    await expect(loadInlineChecksForWeek(2)).resolves.toEqual([]);
  });

  it("skips a realtime quiz whose questions are all unrenderable", async () => {
    queries.selectQuestionsAndOptions.mockResolvedValue({ questions: [], options: [] });
    await expect(loadInlineChecksForWeek(2)).resolves.toEqual([]);
  });
});

describe("loadInlineCheckForWeek picks positionally", () => {
  it("returns the requested index", async () => {
    queries.selectRealtimeQuizzesForWeek.mockResolvedValue([
      REALTIME_QUIZ,
      { ...REALTIME_QUIZ, id: 8, title: "Quick check: grid" },
    ]);
    const second = await loadInlineCheckForWeek(2, 1);
    expect(second?.quizId).toBe(8);
  });

  it("returns null rather than the wrong check when the index is out of range", async () => {
    await expect(loadInlineCheckForWeek(2, 3)).resolves.toBeNull();
  });
});

describe("checkInlineAnswer", () => {
  it("reveals the outcome and the explanation for a realtime question", async () => {
    const outcome = await checkInlineAnswer({ questionId: 10, selectedOptionId: 101 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reveal.isCorrect).toBe(false);
    expect(outcome.reveal.correctOptionId).toBe(100);
    expect(outcome.reveal.explanation).toContain("main axis");
  });

  it("REFUSES a question that belongs to a graded quiz — no answer-key oracle", async () => {
    // Without this, the endpoint returns isCorrect and the explanation for any
    // question id in the database, including the grand exam's.
    for (const kind of ["practice", "grand"]) {
      queries.selectAnswerKeyContext.mockResolvedValue({
        question: { id: 10, explanation: "secret reasoning" },
        quizKind: kind,
        options: [{ id: 100, isCorrect: true }],
      });
      const outcome = await checkInlineAnswer({ questionId: 10, selectedOptionId: 100 });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe("not_realtime");
      expect(JSON.stringify(outcome)).not.toContain("secret reasoning");
    }
  });

  it("reports a missing question without touching the answer key", async () => {
    queries.selectAnswerKeyContext.mockResolvedValue(null);
    const outcome = await checkInlineAnswer({ questionId: 10, selectedOptionId: 100 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("question_not_found");
  });

  it("rejects non-integer or non-positive ids before querying", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const outcome = await checkInlineAnswer({ questionId: bad, selectedOptionId: 100 });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe("invalid_input");
    }
    expect(queries.selectAnswerKeyContext).not.toHaveBeenCalled();
  });

  it("is unlimited — the same answer can be checked over and over", async () => {
    for (let i = 0; i < 5; i += 1) {
      const outcome = await checkInlineAnswer({ questionId: 10, selectedOptionId: 101 });
      expect(outcome.ok).toBe(true);
    }
    // Nothing is counted, so nothing can be exhausted. Contrast the graded engine,
    // which refuses a fourth attempt.
    expect(spies.write).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The invariant this whole kind exists for.
// ---------------------------------------------------------------------------

describe("NEGATIVE: taking a realtime check cannot affect a grade", () => {
  beforeEach(async () => {
    // A full, realistic pass: load the check, answer wrong, answer right, repeat.
    await loadInlineChecksForWeek(2);
    await checkInlineAnswer({ questionId: 10, selectedOptionId: 101 });
    await checkInlineAnswer({ questionId: 10, selectedOptionId: 100 });
    await checkInlineAnswer({ questionId: 10, selectedOptionId: 101 });
  });

  it("writes nothing at all — no attempt, no answer, no progress, no penalty row", () => {
    // db.insert/update/delete/transaction throw when called; `spies.write` records
    // the attempt before throwing, so a zero count is the proof.
    expect(spies.write).not.toHaveBeenCalled();
  });

  it("fires no scoring event, so no leaderboard total can move", () => {
    expect(spies.onScoringEvent).not.toHaveBeenCalled();
  });

  it("does not read or recompute the progress read model", () => {
    expect(spies.getWeekProgress).not.toHaveBeenCalled();
  });

  it("only ever calls the three read queries this stream declares", () => {
    const called = Object.entries(queries)
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name)
      .sort();
    expect(called).toEqual([
      "selectAnswerKeyContext",
      "selectQuestionsAndOptions",
      "selectRealtimeQuizzesForWeek",
    ]);
  });
});
