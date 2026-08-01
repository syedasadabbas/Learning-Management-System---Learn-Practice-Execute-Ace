// =============================================================================
// Unit tests for the leaderboard write path, with the DATABASE MOCKED.
// Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// tests/setup.ts points DATABASE_URL at a host that is never reachable, so these
// tests must not open a connection. `@/db` is replaced with a hand-rolled fake
// whose `transaction()` hands the callback a recording stub. What is asserted
// here is the DECISION LOGIC — which column the points land in, which cohort the
// row is written to, who is refused, and that the cohort lock is taken before the
// renumber. The SQL itself is verified end-to-end by the Playwright spec.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { leaderboard, users } from "@/db/schema";
import type { ScoringEvent } from "@/lib/contracts/events";
import { POINTS } from "@/lib/contracts/scoring";

// ---------------------------------------------------------------------------
// The fake transaction
// ---------------------------------------------------------------------------

interface TxRecording {
  /** Order-preserving log of what the transaction did. */
  calls: string[];
  insertedValues: Record<string, unknown> | null;
  conflictSet: Record<string, unknown> | null;
  conflictTarget: unknown;
  lockArgs: unknown[];
}

interface TxOptions {
  student?: { id: number; role: string; cohortId: number | null } | null;
  existing?: Record<string, number> | null;
  rowCount?: number;
}

let txOptions: TxOptions = {};
let recording: TxRecording;

function makeTx() {
  const tx = {
    execute(query: unknown) {
      // The first execute is always the advisory lock (lockCohort), the second
      // is the renumber. Distinguishing them by position keeps the assertion
      // independent of how drizzle serialises a `sql` template.
      recording.calls.push("execute");
      recording.lockArgs.push(query);
      return { rowCount: txOptions.rowCount ?? 0 };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit() {
                  if (table === users) {
                    recording.calls.push("select:users");
                    return txOptions.student ? [txOptions.student] : [];
                  }
                  recording.calls.push("select:leaderboard");
                  return txOptions.existing ? [txOptions.existing] : [];
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(values: Record<string, unknown>) {
          recording.calls.push("insert");
          recording.insertedValues = values;
          return {
            onConflictDoUpdate(config: { target: unknown; set: Record<string, unknown> }) {
              recording.conflictTarget = config.target;
              recording.conflictSet = config.set;
              return undefined;
            },
          };
        },
      };
    },
  };
  return tx;
}

vi.mock("@/db", () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(makeTx()),
  },
}));

// Imported AFTER vi.mock so the mocked `@/db` is what rebuild.ts binds to.
const { applyScoringEvent } = await import("./rebuild");

function event(over: Partial<ScoringEvent> = {}): ScoringEvent {
  return {
    studentId: 1,
    cohortId: 7,
    source: "quiz",
    weekId: 1,
    points: 20,
    ...over,
  };
}

beforeEach(() => {
  recording = {
    calls: [],
    insertedValues: null,
    conflictSet: null,
    conflictTarget: null,
    lockArgs: [],
  };
  txOptions = {
    student: { id: 1, role: "student", cohortId: 7 },
    existing: null,
    rowCount: 3,
  };
});

// ---------------------------------------------------------------------------

describe("applyScoringEvent — column routing", () => {
  it.each([
    ["quiz", "quizScore", POINTS.QUIZ_MAX],
    ["assignment", "assignmentScore", POINTS.ASSIGNMENT_MAX],
    ["participation", "participationScore", POINTS.PARTICIPATION_MAX],
    ["final_project", "finalProjectScore", POINTS.FINAL_PROJECT_MAX],
  ] as const)("writes %s points into %s", async (source, column, points) => {
    const result = await applyScoringEvent(event({ source, points }));

    expect(result.applied).toBe(true);
    expect(recording.insertedValues?.[column]).toBe(points);
    expect(recording.insertedValues?.totalScore).toBe(points);
    expect(result.totalScore).toBe(points);
  });

  it("adds to an existing weekly total rather than replacing it", async () => {
    txOptions.existing = {
      quizScore: 20,
      assignmentScore: 40,
      participationScore: 10,
      finalProjectScore: 0,
    };

    await applyScoringEvent(event({ source: "quiz", points: 15 }));

    expect(recording.insertedValues?.quizScore).toBe(35);
    expect(recording.insertedValues?.assignmentScore).toBe(40);
    expect(recording.insertedValues?.totalScore).toBe(85);
  });

  it("upserts on the student_id unique index, never a bare insert", async () => {
    await applyScoringEvent(event());
    expect(recording.conflictTarget).toBe(leaderboard.studentId);
    // The conflict branch must write the same values as the insert branch, or a
    // retry would update some columns and not others.
    expect(recording.conflictSet?.totalScore).toBe(
      recording.insertedValues?.totalScore,
    );
  });
});

describe("applyScoringEvent — cohort scoping", () => {
  it("uses the cohort from `users`, not the (possibly stale) event hint", async () => {
    txOptions.student = { id: 1, role: "student", cohortId: 42 };
    await applyScoringEvent(event({ cohortId: 7 }));
    expect(recording.insertedValues?.cohortId).toBe(42);
  });

  it("falls back to the event hint when the user row has no cohort", async () => {
    txOptions.student = { id: 1, role: "student", cohortId: null };
    await applyScoringEvent(event({ cohortId: 7 }));
    expect(recording.insertedValues?.cohortId).toBe(7);
  });

  it("writes a null cohort when neither source has one", async () => {
    txOptions.student = { id: 1, role: "student", cohortId: null };
    await applyScoringEvent(event({ cohortId: null }));
    expect(recording.insertedValues?.cohortId).toBeNull();
  });
});

describe("applyScoringEvent — who is refused", () => {
  it("refuses an instructor: staff must never appear on a student board", async () => {
    txOptions.student = { id: 9, role: "instructor", cohortId: null };
    const result = await applyScoringEvent(event({ studentId: 9 }));

    expect(result.applied).toBe(false);
    expect(result.skippedReason).toBe("not_a_student");
    expect(recording.insertedValues).toBeNull();
  });

  it("refuses an admin for the same reason", async () => {
    txOptions.student = { id: 9, role: "admin", cohortId: null };
    expect((await applyScoringEvent(event({ studentId: 9 }))).skippedReason).toBe(
      "not_a_student",
    );
  });

  it("refuses an unknown student id without writing anything", async () => {
    txOptions.student = null;
    const result = await applyScoringEvent(event({ studentId: 12_345 }));

    expect(result.applied).toBe(false);
    expect(result.skippedReason).toBe("unknown_student");
    expect(recording.insertedValues).toBeNull();
  });

  it("rejects a malformed event before opening a transaction at all", async () => {
    const result = await applyScoringEvent(event({ studentId: 0 }));

    expect(result.applied).toBe(false);
    expect(result.skippedReason).toBe("invalid_event");
    expect(recording.calls).toEqual([]);
  });

  it("rejects NaN points before opening a transaction", async () => {
    expect((await applyScoringEvent(event({ points: Number.NaN }))).skippedReason).toBe(
      "invalid_event",
    );
    expect(recording.calls).toEqual([]);
  });
});

describe("applyScoringEvent — concurrency ordering", () => {
  it("takes the cohort lock BEFORE reading the row it is about to modify", async () => {
    await applyScoringEvent(event());

    const lockIndex = recording.calls.indexOf("execute");
    const readIndex = recording.calls.indexOf("select:leaderboard");
    const writeIndex = recording.calls.indexOf("insert");

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    // Read-modify-write must sit entirely inside the held lock, or two events for
    // the same student both read the same "before" value and one award is lost.
    expect(lockIndex).toBeLessThan(readIndex);
    expect(readIndex).toBeLessThan(writeIndex);
  });

  it("renumbers after writing, in the same transaction", async () => {
    await applyScoringEvent(event());
    const executes = recording.calls.filter((c) => c === "execute");
    // Two: the advisory lock, then the renumber UPDATE.
    expect(executes).toHaveLength(2);
    expect(recording.calls[recording.calls.length - 1]).toBe("execute");
  });

  it("reports how many ranks moved and how long it took, in milliseconds", async () => {
    txOptions.rowCount = 5;
    const result = await applyScoringEvent(event());

    expect(result.rowsRanked).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.durationMs)).toBe(true);
  });
});

describe("applyScoringEvent — repeat safety", () => {
  it("re-delivering the same final-project grade changes nothing", async () => {
    txOptions.existing = {
      quizScore: 0,
      assignmentScore: 0,
      participationScore: 0,
      finalProjectScore: 28,
    };
    await applyScoringEvent(event({ source: "final_project", weekId: null, points: 28 }));

    expect(recording.insertedValues?.finalProjectScore).toBe(28);
    expect(recording.insertedValues?.totalScore).toBe(28);
  });

  it("a double-counted weekly award cannot exceed the course ceiling", async () => {
    txOptions.existing = {
      quizScore: 4 * POINTS.QUIZ_MAX,
      assignmentScore: 0,
      participationScore: 0,
      finalProjectScore: 0,
    };
    await applyScoringEvent(event({ source: "quiz", points: POINTS.QUIZ_MAX }));

    expect(recording.insertedValues?.quizScore).toBe(4 * POINTS.QUIZ_MAX);
  });
});
