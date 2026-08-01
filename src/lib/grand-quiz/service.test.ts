// =============================================================================
// SERVICE TESTS — the three hard cases, plus the invariants end to end.
// -----------------------------------------------------------------------------
// THE DATABASE IS MOCKED AT THE QUERY BOUNDARY. `./queries.ts` is the only module
// in this stream that imports `@/db`, so it is replaced wholesale — the pattern
// `src/lib/realtime-quiz/service.test.ts` established and which `tests/setup.ts`
// requires (DATABASE_URL there points at a deliberately unreachable host, and no
// grand quiz is seeded yet in any case).
//
// The replacement is not a bag of `vi.fn()`s returning fixtures. It is a small
// IN-MEMORY STORE that reproduces the two database behaviours the invariants
// actually rest on:
//
//   * `startAttempt` enforces one attempt per (student, quiz) and hands a loser
//     the winner's row, exactly as the UNIQUE index plus the 23505 catch does (I1);
//   * `finalizeAttempt` serialises callers and reports `already_terminal` to
//     whoever arrives second, exactly as `SELECT ... FOR UPDATE` plus the status
//     guard does (I3).
//
// That is what lets the two concurrency cases be tested at all without a Postgres
// connection. What it cannot prove is that the real SQL has those semantics — that
// is the e2e spec's job (tests/e2e/grand-quiz/), and the reason both exist.
//
// `@/db` is additionally mocked with a pool whose every method throws, so a future
// refactor that reached past ./queries fails here rather than opening a socket.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunCode, RunResult } from "@/lib/execution";

import type {
  AttemptContext,
  AttemptRow,
  FullOptionRow,
  FullQuestionRow,
  GrandQuizRow,
  StoredAnswerRow,
} from "./queries";
import type { ExamAnswerRow } from "./grading";

// ---------------------------------------------------------------------------
// Guard: nothing in this stream may reach the database except ./queries.
// ---------------------------------------------------------------------------
vi.mock("@/db", () => {
  const forbid = (statement: string) => () => {
    throw new Error(
      `[grand-quiz] db.${statement}() was reached from the service. All persistence goes through ./queries.ts.`,
    );
  };
  return {
    db: {
      select: forbid("select"),
      insert: forbid("insert"),
      update: forbid("update"),
      delete: forbid("delete"),
      transaction: forbid("transaction"),
    },
  };
});

// ---------------------------------------------------------------------------
// The in-memory store standing in for ./queries
// ---------------------------------------------------------------------------

interface Store {
  quiz: GrandQuizRow;
  questions: FullQuestionRow[];
  options: FullOptionRow[];
  attempts: AttemptRow[];
  answers: Map<number, Map<number, StoredAnswerRow>>;
  nextAttemptId: number;
  /** Call counters, so a test can assert what the service did and did not do. */
  calls: {
    startAttempt: number;
    finalizeWrites: number;
    selectAttemptForQuiz: number;
    order: string[];
  };
}

let store: Store;

const mocks = vi.hoisted(() => ({
  selectGrandQuizForWeek: vi.fn(),
  selectQuizById: vi.fn(),
  selectQuestions: vi.fn(),
  selectOptions: vi.fn(),
  selectStoredAnswers: vi.fn(),
  selectAttempt: vi.fn(),
  selectAttemptForQuiz: vi.fn(),
  selectAttemptContext: vi.fn(),
  selectExpiredInProgressAttempts: vi.fn(),
  startAttempt: vi.fn(),
  saveAnswer: vi.fn(),
  validateAnswerTarget: vi.fn(),
  finalizeAttempt: vi.fn(),
  isUniqueViolation: vi.fn(),
  groupByMarks: vi.fn(),
}));

vi.mock("./queries", () => mocks);

import {
  loadExam,
  loadExamOverview,
  saveExamAnswer,
  startExam,
  submitExam,
  sweepExpiredExams,
} from "./service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEEK_ID = 2;
const QUIZ_ID = 40;
const STUDENT_ID = 7;
const STARTED_AT = new Date("2026-07-30T09:00:00.000Z");
const DEADLINE_AT = new Date("2026-07-30T11:00:00.000Z");
/** Inside the window. */
const DURING = new Date("2026-07-30T10:00:00.000Z");
/** Two hours past the deadline — the server's own clock. */
const AFTER = new Date("2026-07-30T13:00:00.000Z");

function mcqQuestion(id: number, orderIndex: number, points = 1): FullQuestionRow {
  return {
    id,
    questionText: `Question ${id}`,
    type: "mcq",
    orderIndex,
    points,
    language: null,
    starterCode: null,
    explanation: `Explanation ${id}`,
    tests: null,
  };
}

function codeQuestion(id: number, orderIndex: number, points = 8): FullQuestionRow {
  return {
    id,
    questionText: `Write program ${id}`,
    type: "code_write",
    orderIndex,
    points,
    language: "python",
    starterCode: "def f(n):\n    ...",
    explanation: "Multiply.",
    tests: [{ name: "t", input: "2", expected: "4" }],
  };
}

function optionsFor(questionId: number): FullOptionRow[] {
  return [
    { id: questionId * 10, questionId, optionText: "right", orderIndex: 0, isCorrect: true },
    { id: questionId * 10 + 1, questionId, optionText: "wrong", orderIndex: 1, isCorrect: false },
  ];
}

/** Build a fresh store. `questions` defaults to 50 one-mark MCQs (the real shape). */
function makeStore(questions?: FullQuestionRow[]): Store {
  const qs =
    questions ?? Array.from({ length: 50 }, (_, index) => mcqQuestion(index + 1, index));
  return {
    quiz: {
      id: QUIZ_ID,
      weekId: WEEK_ID,
      title: "Week 2 exam",
      kind: "grand",
      totalQuestions: qs.length,
      passingScore: 70,
      attemptsAllowed: 1,
      timeLimitMinutes: 120,
    },
    questions: qs,
    options: qs.filter((q) => q.type !== "code_write").flatMap((q) => optionsFor(q.id)),
    attempts: [],
    answers: new Map(),
    nextAttemptId: 100,
    calls: { startAttempt: 0, finalizeWrites: 0, selectAttemptForQuiz: 0, order: [] },
  };
}

function answersOf(attemptId: number): StoredAnswerRow[] {
  return [...(store.answers.get(attemptId)?.values() ?? [])];
}

/** Wire the mocks to the store. Mirrors the real ./queries semantics. */
function wireQueries(): void {
  mocks.selectGrandQuizForWeek.mockImplementation(async (weekId: number) => {
    store.calls.order.push("selectGrandQuizForWeek");
    return weekId === WEEK_ID ? store.quiz : null;
  });

  mocks.selectQuizById.mockImplementation(async (quizId: number) =>
    quizId === QUIZ_ID ? store.quiz : null,
  );

  mocks.selectQuestions.mockImplementation(async () => {
    store.calls.order.push("selectQuestions");
    return store.questions;
  });

  mocks.selectOptions.mockImplementation(async () => store.options);

  mocks.selectStoredAnswers.mockImplementation(async (attemptId: number) =>
    answersOf(attemptId),
  );

  mocks.selectAttempt.mockImplementation(async (attemptId: number, studentId: number) =>
    store.attempts.find(
      (attempt) => attempt.id === attemptId && attempt.studentId === studentId,
    ) ?? null,
  );

  mocks.selectAttemptForQuiz.mockImplementation(async (studentId: number, quizId: number) => {
    store.calls.selectAttemptForQuiz += 1;
    store.calls.order.push("selectAttemptForQuiz");
    return (
      store.attempts.find(
        (attempt) => attempt.studentId === studentId && attempt.quizId === quizId,
      ) ?? null
    );
  });

  mocks.selectAttemptContext.mockImplementation(
    async (attemptId: number, studentId: number): Promise<AttemptContext | null> => {
      const attempt = store.attempts.find(
        (row) => row.id === attemptId && row.studentId === studentId,
      );
      if (!attempt) return null;
      return {
        attempt: { ...attempt },
        quiz: store.quiz,
        questions: store.questions,
        options: store.options,
        saved: answersOf(attemptId),
      };
    },
  );

  mocks.selectExpiredInProgressAttempts.mockImplementation(async (now: Date, limit: number) =>
    store.attempts
      .filter(
        (attempt) =>
          attempt.status === "in_progress" &&
          attempt.deadlineAt != null &&
          attempt.deadlineAt.getTime() <= now.getTime(),
      )
      .slice(0, limit)
      .map((attempt) => ({ attemptId: attempt.id, studentId: attempt.studentId })),
  );

  /**
   * Reproduces the real `startAttempt`: it does not count first. It "inserts", and
   * if a row already exists for (student, quiz) — the UNIQUE index — the loser is
   * handed the winner's row.
   */
  mocks.startAttempt.mockImplementation(
    async (params: {
      studentId: number;
      quiz: GrandQuizRow;
      totalPossible: number;
      now: Date;
    }) => {
      store.calls.startAttempt += 1;
      store.calls.order.push("startAttempt");
      // Yield, so two concurrent callers genuinely interleave here.
      await Promise.resolve();
      const existing = store.attempts.find(
        (attempt) =>
          attempt.studentId === params.studentId && attempt.quizId === params.quiz.id,
      );
      if (existing) return { created: false, attempt: { ...existing } };

      const attempt: AttemptRow = {
        id: store.nextAttemptId,
        studentId: params.studentId,
        quizId: params.quiz.id,
        status: "in_progress",
        score: 0,
        totalPossible: params.totalPossible,
        percentage: "0",
        attemptNumber: 1,
        startedAt: params.now,
        submittedAt: null,
        // start + 120 minutes, written ONCE. Nothing below ever updates it.
        deadlineAt: new Date(params.now.getTime() + 120 * 60_000),
        autoSubmitted: false,
      };
      store.nextAttemptId += 1;
      store.attempts.push(attempt);
      return { created: true, attempt: { ...attempt } };
    },
  );

  mocks.validateAnswerTarget.mockImplementation(
    async (params: { questionId: number; selectedOptionId: number | null }) => {
      const question = store.questions.find((row) => row.id === params.questionId);
      if (!question) return { ok: false, reason: "unknown_question" };
      if (params.selectedOptionId != null) {
        const owns = store.options.some(
          (option) =>
            option.id === params.selectedOptionId && option.questionId === params.questionId,
        );
        if (!owns) return { ok: false, reason: "option_not_in_question" };
      }
      return { ok: true, type: question.type };
    },
  );

  mocks.saveAnswer.mockImplementation(
    async (params: {
      attemptId: number;
      studentId: number;
      questionId: number;
      selectedOptionId: number | null;
      codeAnswer: string | null;
      now: Date;
    }) => {
      const attempt = store.attempts.find(
        (row) => row.id === params.attemptId && row.studentId === params.studentId,
      );
      if (!attempt) return { outcome: "not_found" };
      if (attempt.status !== "in_progress") {
        return { outcome: "refused", status: attempt.status, deadlineAt: attempt.deadlineAt };
      }
      if (attempt.deadlineAt != null && params.now.getTime() >= attempt.deadlineAt.getTime()) {
        return { outcome: "refused", status: attempt.status, deadlineAt: attempt.deadlineAt };
      }
      let forAttempt = store.answers.get(params.attemptId);
      if (!forAttempt) {
        forAttempt = new Map();
        store.answers.set(params.attemptId, forAttempt);
      }
      const existing = forAttempt.get(params.questionId);
      forAttempt.set(params.questionId, {
        questionId: params.questionId,
        selectedOptionId: params.selectedOptionId,
        codeAnswer: params.codeAnswer,
        // Grading columns untouched by autosave.
        isCorrect: existing?.isCorrect ?? false,
        awarded: existing?.awarded ?? 0,
        maxPoints: existing?.maxPoints ?? 0,
      });
      return { outcome: "saved" };
    },
  );

  /**
   * Reproduces the real `finalizeAttempt`: the terminal check and the write are one
   * indivisible step, so a second caller sees the first one's status and is told to
   * replay rather than scoring again.
   */
  mocks.finalizeAttempt.mockImplementation(
    async (params: {
      attemptId: number;
      studentId: number;
      rows: readonly ExamAnswerRow[];
      score: number;
      totalPossible: number;
      percentage: number;
      status: "submitted" | "graded";
      autoSubmitted: boolean;
      now: Date;
    }) => {
      const attempt = store.attempts.find(
        (row) => row.id === params.attemptId && row.studentId === params.studentId,
      );
      if (!attempt) return { outcome: "not_found" };

      if (attempt.status !== "in_progress") {
        return {
          outcome: "already_terminal",
          attempt: { ...attempt },
          stored: answersOf(params.attemptId),
        };
      }

      store.calls.finalizeWrites += 1;

      let forAttempt = store.answers.get(params.attemptId);
      if (!forAttempt) {
        forAttempt = new Map();
        store.answers.set(params.attemptId, forAttempt);
      }
      for (const row of params.rows) {
        // ON CONFLICT DO NOTHING for the insert...
        const existing = forAttempt.get(row.questionId);
        if (!existing) {
          forAttempt.set(row.questionId, {
            questionId: row.questionId,
            selectedOptionId: row.selectedOptionId,
            codeAnswer: row.codeAnswer,
            isCorrect: false,
            awarded: 0,
            maxPoints: 0,
          });
        }
        // ...then the grading columns only. Saved selection/code untouched.
        const stored = forAttempt.get(row.questionId) as StoredAnswerRow;
        stored.isCorrect = row.isCorrect;
        stored.awarded = row.awarded;
        stored.maxPoints = row.maxPoints;
      }

      attempt.score = params.score;
      attempt.totalPossible = params.totalPossible;
      attempt.percentage = params.percentage.toFixed(2);
      attempt.status = params.status;
      attempt.submittedAt = params.now;
      attempt.autoSubmitted = params.autoSubmitted;
      // deadlineAt is deliberately NOT touched (I2).

      return { outcome: "finalized", attempt: { ...attempt } };
    },
  );
}

/** A runner that passes every test, so code items score full marks. */
const passingRunner: RunCode = async () => passResult("4");

function passResult(stdout: string): RunResult {
  return {
    ok: true,
    exitCode: 0,
    stdout,
    stderr: "",
    runtimeMs: 5,
    backend: "piston",
    truncated: { stdout: false, stderr: false },
    language: "python",
  };
}

const rateLimitedRunner: RunCode = async () => ({
  ok: false,
  reason: "rate_limited",
  message: "Piston said 429.",
  exitCode: null,
  stdout: "",
  stderr: "",
  runtimeMs: 2,
  backend: "piston",
  truncated: { stdout: false, stderr: false },
  language: "python",
});

beforeEach(() => {
  vi.clearAllMocks();
  store = makeStore();
  wireQueries();
});

// ===========================================================================
// I1 — one attempt, ever
// ===========================================================================

describe("startExam (I1 — one attempt per student per grand quiz)", () => {
  it("creates the attempt on the first call", async () => {
    const outcome = await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.data.state).toBe("in_progress");
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]?.attemptNumber).toBe(1);
  });

  it("does NOT count existing attempts before inserting — the index is the guard", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    // A read-then-write check would show `selectAttemptForQuiz` BEFORE
    // `startAttempt`. Its absence in that position is what closes the race that
    // I1 exists to close.
    const startIndex = store.calls.order.indexOf("startAttempt");
    const readIndex = store.calls.order.indexOf("selectAttemptForQuiz");
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex === -1 || readIndex > startIndex).toBe(true);
  });

  it("HARD CASE: two CONCURRENT starts yield one row and the SAME attempt id", async () => {
    const [first, second] = await Promise.all([
      startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT }),
      startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT }),
    ]);

    expect(first.ok && second.ok).toBe(true);
    // Exactly one row exists.
    expect(store.attempts).toHaveLength(1);
    // Both callers were served, and both received the same attempt.
    expect(store.calls.startAttempt).toBe(2);
    const firstId = first.ok && first.data.state === "in_progress" ? first.data.exam.attempt.id : -1;
    const secondId =
      second.ok && second.data.state === "in_progress" ? second.data.exam.attempt.id : -2;
    expect(firstId).toBe(secondId);
    expect(firstId).toBe(100);
  });

  it("ten sequential starts are indistinguishable from one", async () => {
    const ids: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const outcome = await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
      if (outcome.ok && outcome.data.state === "in_progress") ids.push(outcome.data.exam.attempt.id);
    }
    expect(store.attempts).toHaveLength(1);
    expect(new Set(ids).size).toBe(1);
  });

  it("resuming returns the ORIGINAL deadline, never a fresh 120 minutes (I2)", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    const originalDeadline = store.attempts[0]?.deadlineAt?.getTime();

    // The student reloads 90 minutes later.
    const resumed = await startExam({
      weekId: WEEK_ID,
      studentId: STUDENT_ID,
      now: new Date(STARTED_AT.getTime() + 90 * 60_000),
    });

    expect(store.attempts[0]?.deadlineAt?.getTime()).toBe(originalDeadline);
    expect(
      resumed.ok && resumed.data.state === "in_progress"
        ? resumed.data.exam.attempt.countdown.remainingMs
        : null,
    ).toBe(30 * 60_000);
  });

  it("refuses BEFORE creating an attempt when the exam has no questions", async () => {
    store = makeStore([]);
    wireQueries();
    const outcome = await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("quiz_empty");
    // The one attempt a student gets was not burnt on nothing.
    expect(store.attempts).toHaveLength(0);
  });

  it("reports not_found for a week with no grand quiz", async () => {
    const outcome = await startExam({ weekId: 99, studentId: STUDENT_ID, now: STARTED_AT });
    expect(!outcome.ok && outcome.code).toBe("not_found");
  });
});

describe("loadExamOverview (the page read)", () => {
  it("CREATES NOTHING for a student who has not started", async () => {
    const outcome = await loadExamOverview({
      weekId: WEEK_ID,
      studentId: STUDENT_ID,
      now: STARTED_AT,
    });
    expect(outcome.ok && outcome.data.state).toBe("not_started");
    // Navigating to the page must not consume the one attempt (I1) or start the
    // clock (I2).
    expect(store.attempts).toHaveLength(0);
    expect(mocks.startAttempt).not.toHaveBeenCalled();
  });

  it("returns the in-progress exam once started", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    const outcome = await loadExamOverview({
      weekId: WEEK_ID,
      studentId: STUDENT_ID,
      now: DURING,
    });
    expect(outcome.ok && outcome.data.state).toBe("in_progress");
  });
});

// ===========================================================================
// I3 — autosave is refused once terminal
// ===========================================================================

describe("saveExamAnswer (I3, I2)", () => {
  beforeEach(async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
  });

  it("stores an answer while the exam is open", async () => {
    const outcome = await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10,
      now: DURING,
    });
    expect(outcome.ok).toBe(true);
    expect(answersOf(100)).toEqual([
      {
        questionId: 1,
        selectedOptionId: 10,
        codeAnswer: null,
        isCorrect: false,
        awarded: 0,
        maxPoints: 0,
      },
    ]);
  });

  it("AWARDS NOTHING during the exam — a student cannot poll for correctness", async () => {
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10, // the correct option
      now: DURING,
    });
    expect(answersOf(100)[0]?.awarded).toBe(0);
    expect(answersOf(100)[0]?.isCorrect).toBe(false);
  });

  it("upserts rather than accumulating rows when an answer is changed", async () => {
    for (const optionId of [10, 11, 10]) {
      await saveExamAnswer({
        attemptId: 100,
        studentId: STUDENT_ID,
        questionId: 1,
        selectedOptionId: optionId,
        now: DURING,
      });
    }
    expect(answersOf(100)).toHaveLength(1);
    expect(answersOf(100)[0]?.selectedOptionId).toBe(10);
  });

  it("REFUSES an autosave arriving after submit, and the score is unchanged", async () => {
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10,
      now: DURING,
    });
    const submitted = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: passingRunner,
    });
    const scoreAtSubmit = submitted.ok ? submitted.data.score : -1;

    const late = await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 2,
      selectedOptionId: 20,
      now: DURING,
    });

    expect(late.ok).toBe(false);
    expect(!late.ok && late.code).toBe("attempt_terminal");
    // Nothing was written, so nothing can have moved the score.
    expect(store.attempts[0]?.score).toBe(scoreAtSubmit);
    expect(answersOf(100).find((row) => row.questionId === 2)?.selectedOptionId ?? null).toBeNull();
  });

  it("HARD CASE: refuses an autosave once the SERVER clock is past the stored deadline", async () => {
    const outcome = await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10,
      // Two hours past the deadline. A skewed device clock is irrelevant: this is
      // the value the route handler produces with its own `new Date()`.
      now: AFTER,
    });
    expect(!outcome.ok && outcome.code).toBe("attempt_expired");
    expect(answersOf(100)).toHaveLength(0);
  });

  it("refuses an option that belongs to another question", async () => {
    const outcome = await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 20, // question 2's option
      now: DURING,
    });
    expect(!outcome.ok && outcome.code).toBe("option_not_in_question");
  });

  it("refuses a question that is not in this exam", async () => {
    const outcome = await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 9_999,
      selectedOptionId: null,
      now: DURING,
    });
    expect(!outcome.ok && outcome.code).toBe("unknown_question");
  });

  it("refuses code on an MCQ and an option on a code question", async () => {
    const codeOnMcq = await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      codeAnswer: "print(1)",
      now: DURING,
    });
    expect(!codeOnMcq.ok && codeOnMcq.code).toBe("wrong_answer_shape");
  });

  it("404s another student's attempt rather than writing into it", async () => {
    const outcome = await saveExamAnswer({
      attemptId: 100,
      studentId: 999,
      questionId: 1,
      selectedOptionId: 10,
      now: DURING,
    });
    expect(!outcome.ok && outcome.code).toBe("not_found");
  });
});

// ===========================================================================
// I3 + I4 + I5 + I6 — submit
// ===========================================================================

describe("submitExam (I4 — a row for every question)", () => {
  it("THE NAMED CASE: 50 questions, 12 answered → 50 rows, 38 blank with awarded 0", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    for (let questionId = 1; questionId <= 12; questionId += 1) {
      await saveExamAnswer({
        attemptId: 100,
        studentId: STUDENT_ID,
        questionId,
        selectedOptionId: questionId * 10, // correct
        now: DURING,
      });
    }

    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: passingRunner,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Fifty stored rows, not twelve.
    expect(answersOf(100)).toHaveLength(50);
    const blank = answersOf(100).filter((row) => row.selectedOptionId == null);
    expect(blank).toHaveLength(38);
    for (const row of blank) {
      expect(row.codeAnswer).toBeNull();
      expect(row.awarded).toBe(0);
    }

    // And the response says the same thing.
    expect(outcome.data.answers).toHaveLength(50);
    expect(outcome.data.unansweredCount).toBe(38);
    expect(outcome.data.score).toBe(12);
    expect(outcome.data.totalPossible).toBe(50);
  });

  it("leaves a saved answer's selection untouched while writing its mark (I4)", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 3,
      selectedOptionId: 31, // wrong, deliberately
      now: DURING,
    });
    await submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner });

    const row = answersOf(100).find((entry) => entry.questionId === 3);
    // The student's choice survived grading verbatim.
    expect(row?.selectedOptionId).toBe(31);
    expect(row?.isCorrect).toBe(false);
    expect(row?.awarded).toBe(0);
    expect(row?.maxPoints).toBe(1);
  });
});

describe("submitExam (I5 — no negative marking)", () => {
  it("an all-wrong 50-question attempt scores exactly 0", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    for (let questionId = 1; questionId <= 50; questionId += 1) {
      await saveExamAnswer({
        attemptId: 100,
        studentId: STUDENT_ID,
        questionId,
        selectedOptionId: questionId * 10 + 1, // wrong
        now: DURING,
      });
    }
    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: passingRunner,
    });
    expect(outcome.ok && outcome.data.score).toBe(0);
    expect(outcome.ok && outcome.data.percentage).toBe(0);
    expect(store.attempts[0]?.score).toBe(0);
    expect(store.attempts[0]?.score).not.toBeLessThan(0);
  });

  it("the stored score is the SUM of the stored awards", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    for (let questionId = 1; questionId <= 30; questionId += 1) {
      await saveExamAnswer({
        attemptId: 100,
        studentId: STUDENT_ID,
        questionId,
        selectedOptionId: questionId * 10,
        now: DURING,
      });
    }
    await submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner });

    const summed = answersOf(100).reduce((total, row) => total + row.awarded, 0);
    expect(store.attempts[0]?.score).toBe(summed);
    expect(summed).toBe(30);
  });
});

describe("submitExam (I6 — a score at submit that never overstates)", () => {
  it("an all-MCQ attempt is `graded` and FINAL at submit", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: passingRunner,
    });
    expect(outcome.ok && outcome.data.provisional).toBe(false);
    expect(outcome.ok && outcome.data.deferredCount).toBe(0);
    expect(store.attempts[0]?.status).toBe("graded");
    // A score exists — never a blank "your instructor will be in touch".
    expect(outcome.ok && typeof outcome.data.score).toBe("number");
  });

  it("a rate-limited code item is DEFERRED, the attempt is `submitted`, and the total is provisional", async () => {
    store = makeStore([mcqQuestion(1, 0), codeQuestion(2, 1, 8)]);
    wireQueries();
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10,
      now: DURING,
    });
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 2,
      codeAnswer: "def f(n): return n*2",
      now: DURING,
    });

    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: rateLimitedRunner,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.deferredCount).toBe(1);
    expect(outcome.data.provisional).toBe(true);
    // NOT scored zero: the mark is outstanding, not lost.
    expect(outcome.data.score).toBe(1);
    expect(outcome.data.provisionalCeiling).toBe(9);
    expect(outcome.data.provisionalCeiling).toBeGreaterThan(outcome.data.score);
    // Persisted as `submitted`, which is how a later read knows it is provisional.
    expect(store.attempts[0]?.status).toBe("submitted");
  });

  it("a working runner scores the code item and the attempt is `graded`", async () => {
    store = makeStore([mcqQuestion(1, 0), codeQuestion(2, 1, 8)]);
    wireQueries();
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 2,
      codeAnswer: "def f(n): return n*2",
      now: DURING,
    });
    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: passingRunner,
    });
    expect(outcome.ok && outcome.data.score).toBe(8);
    expect(outcome.ok && outcome.data.provisional).toBe(false);
    expect(store.attempts[0]?.status).toBe("graded");
  });
});

describe("submitExam (I3 — idempotent and terminal)", () => {
  it("HARD CASE: two CONCURRENT submits produce ONE write and IDENTICAL bodies", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    for (let questionId = 1; questionId <= 20; questionId += 1) {
      await saveExamAnswer({
        attemptId: 100,
        studentId: STUDENT_ID,
        questionId,
        selectedOptionId: questionId * 10,
        now: DURING,
      });
    }

    const [first, second] = await Promise.all([
      submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner }),
      submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner }),
    ]);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // ONE scoring write, however many callers arrived.
    expect(store.calls.finalizeWrites).toBe(1);
    // Both callers received the same numbers.
    expect(second.data.score).toBe(first.data.score);
    expect(second.data.totalPossible).toBe(first.data.totalPossible);
    expect(second.data.percentage).toBe(first.data.percentage);
    expect(second.data.answers).toHaveLength(first.data.answers.length);
    // Exactly one of them is the replay, and it says so.
    expect([first.data.replayed, second.data.replayed].filter(Boolean)).toHaveLength(1);
    // And still one attempt row, one set of answers.
    expect(store.attempts).toHaveLength(1);
    expect(answersOf(100)).toHaveLength(50);
  });

  it("a repeat submit REPLAYS the stored result without re-scoring", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10,
      now: DURING,
    });
    const first = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: DURING,
      runner: passingRunner,
    });
    const writesAfterFirst = store.calls.finalizeWrites;

    const second = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: new Date(DURING.getTime() + 5_000),
      runner: passingRunner,
    });

    expect(store.calls.finalizeWrites).toBe(writesAfterFirst);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.data.replayed).toBe(true);
    expect(second.data.score).toBe(first.data.score);
    // `submitted_at` was not rewritten by the second call.
    expect(store.attempts[0]?.submittedAt?.getTime()).toBe(DURING.getTime());
  });

  it("a repeat submit does not create a second attempt row", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner });
    await submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner });
    expect(store.attempts).toHaveLength(1);
  });

  it("404s another student's attempt", async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    const outcome = await submitExam({ attemptId: 100, studentId: 999, now: DURING });
    expect(!outcome.ok && outcome.code).toBe("not_found");
  });
});

// ===========================================================================
// Expiry — all three triggers converge
// ===========================================================================

describe("expiry (three triggers, one result)", () => {
  beforeEach(async () => {
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await saveExamAnswer({
      attemptId: 100,
      studentId: STUDENT_ID,
      questionId: 1,
      selectedOptionId: 10,
      now: DURING,
    });
  });

  it("TRIGGER 1 — a client auto-submit records `auto_submitted`", async () => {
    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: AFTER,
      autoSubmitted: true,
      runner: passingRunner,
    });
    expect(outcome.ok && outcome.data.autoSubmitted).toBe(true);
    expect(store.attempts[0]?.autoSubmitted).toBe(true);
  });

  it("TRIGGER 1b — the server records auto_submitted even when the client claims a manual submit", async () => {
    // A student who pressed Submit at 119:59 whose request arrived at 120:01. The
    // flag records how the exam closed and the server decides it, not the client.
    const outcome = await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: AFTER,
      autoSubmitted: false,
      runner: passingRunner,
    });
    expect(outcome.ok && outcome.data.autoSubmitted).toBe(true);
  });

  it("TRIGGER 2 — a READ of an expired in-progress attempt finalizes it", async () => {
    const outcome = await loadExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: AFTER,
      runner: passingRunner,
    });
    expect(outcome.ok && outcome.data.state).toBe("finished");
    expect(store.attempts[0]?.status).toBe("graded");
    expect(store.attempts[0]?.autoSubmitted).toBe(true);
    // Whatever was saved WAS marked — the answer is not discarded.
    expect(outcome.ok && outcome.data.state === "finished" ? outcome.data.result.score : -1).toBe(1);
  });

  it("TRIGGER 2 — there is NO read that returns an open exam past its deadline", async () => {
    // This is what makes I2 hold against a client that simply never fires trigger 1.
    const view = await loadExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: AFTER,
      runner: passingRunner,
    });
    expect(view.ok && view.data.state).not.toBe("in_progress");

    const overview = await loadExamOverview({
      weekId: WEEK_ID,
      studentId: STUDENT_ID,
      now: AFTER,
      runner: passingRunner,
    });
    expect(overview.ok && overview.data.state).toBe("finished");
  });

  it("TRIGGER 2 — a read INSIDE the window leaves the attempt open", async () => {
    const outcome = await loadExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING });
    expect(outcome.ok && outcome.data.state).toBe("in_progress");
    expect(store.attempts[0]?.status).toBe("in_progress");
  });

  it("TRIGGER 3 — the cron sweep finalizes an abandoned attempt", async () => {
    const report = await sweepExpiredExams({ now: AFTER, runner: passingRunner });
    expect(report.examined).toBe(1);
    expect(report.finalized).toBe(1);
    expect(report.alreadyClosed).toBe(0);
    expect(report.failed).toEqual([]);
    expect(store.attempts[0]?.status).toBe("graded");
    expect(store.attempts[0]?.autoSubmitted).toBe(true);
  });

  it("TRIGGER 3 — the sweep ignores attempts still inside their window", async () => {
    const report = await sweepExpiredExams({ now: DURING, runner: passingRunner });
    expect(report.examined).toBe(0);
    expect(store.attempts[0]?.status).toBe("in_progress");
  });

  it("ALL THREE CONVERGE on one identical result, with one scoring write", async () => {
    // The whole reason three triggers are safe: I3.
    const [clientSubmit, lazyRead, sweep] = await Promise.all([
      submitExam({
        attemptId: 100,
        studentId: STUDENT_ID,
        now: AFTER,
        autoSubmitted: true,
        runner: passingRunner,
      }),
      loadExam({ attemptId: 100, studentId: STUDENT_ID, now: AFTER, runner: passingRunner }),
      sweepExpiredExams({ now: AFTER, runner: passingRunner }),
    ]);

    expect(store.calls.finalizeWrites).toBe(1);
    expect(store.attempts).toHaveLength(1);
    expect(answersOf(100)).toHaveLength(50);

    const clientScore = clientSubmit.ok ? clientSubmit.data.score : -1;
    const readScore =
      lazyRead.ok && lazyRead.data.state === "finished" ? lazyRead.data.result.score : -2;
    expect(readScore).toBe(clientScore);
    // The sweep either finalized it or found it closed — both are success.
    expect(sweep.failed).toEqual([]);
    expect(sweep.finalized + sweep.alreadyClosed).toBeLessThanOrEqual(1);
  });

  it("the sweep isolates a failure per attempt rather than aborting", async () => {
    // A second student's attempt, expired, whose context read blows up.
    store.attempts.push({
      id: 101,
      studentId: 8,
      quizId: QUIZ_ID,
      status: "in_progress",
      score: 0,
      totalPossible: 50,
      percentage: "0",
      attemptNumber: 1,
      startedAt: STARTED_AT,
      submittedAt: null,
      deadlineAt: DEADLINE_AT,
      autoSubmitted: false,
    });
    const original = mocks.selectAttemptContext.getMockImplementation();
    mocks.selectAttemptContext.mockImplementation(async (attemptId: number, studentId: number) => {
      if (attemptId === 101) throw new Error("simulated read failure");
      return original?.(attemptId, studentId);
    });

    const report = await sweepExpiredExams({ now: AFTER, runner: passingRunner });

    expect(report.examined).toBe(2);
    expect(report.finalized).toBe(1);
    expect(report.failed).toEqual([{ attemptId: 101, reason: "simulated read failure" }]);
    // The healthy attempt was still finalized.
    expect(store.attempts.find((row) => row.id === 100)?.status).toBe("graded");
  });

  it("`deadline_at` is never rewritten by any of the three triggers (I2)", async () => {
    const before = store.attempts[0]?.deadlineAt?.getTime();
    await submitExam({
      attemptId: 100,
      studentId: STUDENT_ID,
      now: AFTER,
      autoSubmitted: true,
      runner: passingRunner,
    });
    await loadExam({ attemptId: 100, studentId: STUDENT_ID, now: AFTER, runner: passingRunner });
    await sweepExpiredExams({ now: AFTER, runner: passingRunner });
    expect(store.attempts[0]?.deadlineAt?.getTime()).toBe(before);
  });
});

// ===========================================================================
// No cross-stream side effects
// ===========================================================================

describe("side effects the exam deliberately does NOT have", () => {
  it("submitting an exam fires no scoring event and writes no progress row", async () => {
    // Stated as a test rather than a comment: the leaderboard aggregates quiz
    // points per (student, week) — the slot the practice quiz already fills — so an
    // exam event would double-count or overwrite. That is a cross-stream decision,
    // reported rather than taken here. This test fails the moment one is wired in,
    // which is exactly when the decision needs re-making.
    await startExam({ weekId: WEEK_ID, studentId: STUDENT_ID, now: STARTED_AT });
    await submitExam({ attemptId: 100, studentId: STUDENT_ID, now: DURING, runner: passingRunner });

    const queryNames = Object.keys(mocks);
    expect(queryNames).not.toContain("insertProgress");
    expect(queryNames).not.toContain("onScoringEvent");
  });
});
