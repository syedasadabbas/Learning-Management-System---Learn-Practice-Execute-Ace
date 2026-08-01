// =============================================================================
// Regression tests for POST /api/presentations/submissions/:submissionId/grade
// — a regrade must be recorded, not merely applied.
// Owner: the API stream (defect remediation wave).
// -----------------------------------------------------------------------------
// THE DIVISION OF LABOUR WITH THE DATABASE TEST. The property that matters —
// "after B regrades A's submission, A's mark and A's identity are still
// readable" — is a property of the DATA and is asserted against a real Postgres
// in src/db/schema.presentations.grade-events.test.ts. This file asserts the
// complementary property, which that one cannot see: that THIS HANDLER writes
// the history row at all, that it writes it inside the SAME transaction as the
// update, and that the grader and instant on the two rows agree.
//
// Splitting it that way is deliberate. A mocked-database test that claimed to
// prove the audit trail would be proving that the code calls `insert`, which is
// the easy half and the half that stays true even if the table is wrong. A
// real-database test cannot reach the handler, which needs a session and a
// Next.js request. Each covers what the other structurally cannot.
//
// The transaction assertion is the load-bearing one here: two separate
// statements would allow a grade that took effect with no history row if the
// process died between them, and that is exactly the state the table exists to
// make impossible.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

interface InsertedEvent {
  submissionId: number;
  score: number;
  feedback: string | null;
  gradedBy: number;
  gradedAt: Date;
}

interface UpdatedGrade {
  score: number;
  gradedBy: number;
  gradedAt: Date;
  status: string;
}

const { auth, recorder } = vi.hoisted(() => ({
  auth: vi.fn(),
  recorder: {
    inserts: [] as InsertedEvent[],
    updates: [] as UpdatedGrade[],
    /** Rows the faked UPDATE ... RETURNING hands back. Empty models "no such row". */
    updateReturns: [{ id: 1 }] as unknown[],
    /** Set while the transaction callback is running, so writes can be attributed. */
    inTransaction: false,
    /** True if any write happened while `inTransaction` was false. */
    wroteOutsideTransaction: false,
  },
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/feature-guard", () => ({ featureGate: () => null }));

vi.mock("@/db", () => {
  /** The `tx` handle: just enough Drizzle surface for this handler's two writes. */
  const tx = {
    update: () => ({
      set: (values: UpdatedGrade) => {
        if (!recorder.inTransaction) recorder.wroteOutsideTransaction = true;
        recorder.updates.push(values);
        return { where: () => ({ returning: async () => recorder.updateReturns }) };
      },
    }),
    insert: () => ({
      values: async (values: InsertedEvent) => {
        if (!recorder.inTransaction) recorder.wroteOutsideTransaction = true;
        recorder.inserts.push(values);
      },
    }),
  };

  return {
    db: {
      transaction: async <T>(callback: (handle: typeof tx) => Promise<T>): Promise<T> => {
        recorder.inTransaction = true;
        try {
          return await callback(tx);
        } finally {
          recorder.inTransaction = false;
        }
      },
      // The handler must NOT write outside `transaction`. Reaching either of
      // these is the failure this file exists to catch.
      update: () => {
        recorder.wroteOutsideTransaction = true;
        throw new Error("the handler wrote outside the transaction");
      },
      insert: () => {
        recorder.wroteOutsideTransaction = true;
        throw new Error("the handler wrote outside the transaction");
      },
    },
  };
});

import { POST } from "./route";

const SUBMISSION_ID = 41;

function asInstructor(id: number): void {
  auth.mockResolvedValue({
    user: { id: String(id), email: `i${id}@x.test`, name: `Instructor ${id}`, role: "instructor" },
  });
}

function post(body: unknown) {
  const request = new Request(
    `http://localhost/api/presentations/submissions/${SUBMISSION_ID}/grade`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return POST(request, { params: Promise.resolve({ submissionId: String(SUBMISSION_ID) }) });
}

beforeEach(() => {
  recorder.inserts.length = 0;
  recorder.updates.length = 0;
  recorder.updateReturns = [{ id: SUBMISSION_ID }];
  recorder.inTransaction = false;
  recorder.wroteOutsideTransaction = false;
});

describe("POST grade — the append-only history", () => {
  it("appends one grade event per grading, carrying the session's grader", async () => {
    asInstructor(7);
    const response = await post({ score: 82, feedback: "Strong delivery." });

    expect(response.status).toBe(200);
    expect(recorder.inserts).toHaveLength(1);
    expect(recorder.inserts[0]).toMatchObject({
      submissionId: SUBMISSION_ID,
      score: 82,
      feedback: "Strong delivery.",
      // From the SESSION, never from the payload — a grader id in the body
      // would let one instructor record a colleague as the author of a mark.
      gradedBy: 7,
    });
  });

  it("writes the event and the grade in ONE transaction", async () => {
    asInstructor(7);
    await post({ score: 60 });

    expect(recorder.wroteOutsideTransaction).toBe(false);
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.inserts).toHaveLength(1);
  });

  it("stamps both rows with the SAME instant, not two clock reads", async () => {
    asInstructor(7);
    await post({ score: 60 });

    // Two `new Date()` calls would put the history row milliseconds away from
    // the submission row it describes, and "which event is currently in force?"
    // would then need a tolerance instead of an equality.
    expect(recorder.inserts[0].gradedAt.getTime()).toBe(recorder.updates[0].gradedAt.getTime());
  });

  it("records a second, superseding grade as a SECOND row", async () => {
    asInstructor(7);
    await post({ score: 82, feedback: "First pass." });
    asInstructor(9);
    await post({ score: 55, feedback: "Regraded." });

    // The regression: the previous grade used to be overwritten in place, with
    // `graded_by` replaced too, so nothing recorded that instructor 7 ever gave
    // an 82. Two rows, two graders.
    expect(recorder.inserts.map((row) => [row.score, row.gradedBy])).toEqual([
      [82, 7],
      [55, 9],
    ]);
  });

  it("appends nothing when the submission does not exist", async () => {
    asInstructor(7);
    recorder.updateReturns = [];

    const response = await post({ score: 82 });
    expect(response.status).toBe(404);
    // A history row for a submission that was never graded would be a phantom
    // grade in the audit trail.
    expect(recorder.inserts).toHaveLength(0);
  });

  it("appends nothing when the body is invalid", async () => {
    asInstructor(7);
    const response = await post({ score: 101 });
    expect(response.status).toBe(422);
    expect(recorder.inserts).toHaveLength(0);
    expect(recorder.updates).toHaveLength(0);
  });
});
