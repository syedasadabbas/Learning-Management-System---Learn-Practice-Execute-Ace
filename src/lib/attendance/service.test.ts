// =============================================================================
// Attendance persistence tests — the DATABASE IS MOCKED.
// -----------------------------------------------------------------------------
// tests/setup.ts is explicit that unit tests must never reach Neon, so `@/db` is
// replaced with a scripted fake. What is being asserted here is the SHAPE of the
// statements this module issues — specifically that recording attendance twice
// upserts on the (studentId, lectureId) unique index instead of failing — and
// that the leaderboard event is fire-and-forget. Real round trips are covered by
// the Playwright spec in tests/e2e/penalties-attendance/.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { attendance } from "@/db/schema";
import { POINTS } from "@/lib/contracts/scoring";

const state = vi.hoisted(() => ({
  /**
   * FIFO of result sets, one per `db.select()...` await, in the order the code
   * under test issues them. Explicit and brittle by design: a changed query
   * order should fail a test rather than silently read the wrong rows.
   */
  selectQueue: [] as unknown[][],
  inserts: [] as InsertCall[],
}));

type InsertCall = {
  values: Record<string, unknown>;
  conflict: { target?: unknown; set?: Record<string, unknown> } | null;
};

vi.mock("@/db", () => {
  function makeQuery(): Record<string, unknown> {
    return {
      from: () => makeQuery(),
      where: () => makeQuery(),
      orderBy: () => makeQuery(),
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject),
    };
  }

  return {
    db: {
      select: () => makeQuery(),
      insert: () => ({
        values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
          const list = Array.isArray(values) ? values : [values];
          const call: InsertCall = { values: list[0] ?? {}, conflict: null };
          state.inserts.push(call);
          const returning = async () =>
            list.map((v, i) => ({ id: 100 + i, recordedAt: new Date(), ...v }));
          return {
            returning,
            onConflictDoUpdate: (cfg: { target?: unknown; set?: Record<string, unknown> }) => {
              call.conflict = cfg;
              return { returning };
            },
          };
        },
      }),
    },
  };
});

const onScoringEvent = vi.hoisted(() =>
  vi.fn(async (_event: unknown): Promise<void> => {
    void _event;
  }),
);
vi.mock("@/lib/leaderboard/on-scoring-event", () => ({ onScoringEvent }));

// Imported after the mocks are registered.
const { recordAttendance, syncWeekParticipation, weekParticipation } = await import("./service");

beforeEach(() => {
  state.selectQueue.length = 0;
  state.inserts.length = 0;
  onScoringEvent.mockReset();
  onScoringEvent.mockResolvedValue(undefined);
});

describe("recordAttendance", () => {
  it("upserts on the (studentId, lectureId) unique index", async () => {
    await recordAttendance({ studentId: 1, lectureId: 7, attended: true });

    expect(state.inserts).toHaveLength(1);
    const conflict = state.inserts[0].conflict;
    expect(conflict).not.toBeNull();
    // Exactly the columns behind attendance_student_lecture_idx.
    expect(conflict?.target).toEqual([attendance.studentId, attendance.lectureId]);
    expect(conflict?.set).toMatchObject({ attended: true, participationScore: 0 });
  });

  it("recording the same student+lecture twice updates rather than failing", async () => {
    await recordAttendance({ studentId: 1, lectureId: 7, attended: true });
    // The second call is the correction: same pair, opposite value.
    const row = await recordAttendance({ studentId: 1, lectureId: 7, attended: false });

    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[1].conflict?.set).toMatchObject({ attended: false });
    expect(row.attended).toBe(false);
  });

  it("stamps recordedAt on the update branch so a correction is visible", async () => {
    await recordAttendance({ studentId: 1, lectureId: 7, attended: true });
    expect(state.inserts[0].conflict?.set).toHaveProperty("recordedAt");
    expect((state.inserts[0].conflict?.set as { recordedAt: Date }).recordedAt).toBeInstanceOf(
      Date,
    );
  });

  it("normalises a missing or negative participation score to 0", async () => {
    await recordAttendance({ studentId: 1, lectureId: 7, attended: true });
    await recordAttendance({
      studentId: 1,
      lectureId: 8,
      attended: true,
      participationScore: -4,
    });
    expect(state.inserts[0].values).toMatchObject({ participationScore: 0 });
    expect(state.inserts[1].values).toMatchObject({ participationScore: 0 });
  });
});

describe("weekParticipation", () => {
  it("uses the week's lecture count as the denominator, not the recorded rows", async () => {
    // 1st select: lectures in the week. 2nd: this student's attendance rows.
    state.selectQueue.push([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    state.selectQueue.push([
      { lectureId: 1, attended: true, participationScore: 0 },
      { lectureId: 2, attended: true, participationScore: 0 },
    ]);

    const result = await weekParticipation(5, 9);
    expect(result.lectureTotal).toBe(4);
    expect(result.attendanceRatePercent).toBe(50);
    expect(result.points).toBe(0);
  });

  it("short-circuits when the week has no lectures", async () => {
    state.selectQueue.push([]);
    const result = await weekParticipation(5, 9);
    expect(result.points).toBe(0);
    expect(result.lectureTotal).toBe(0);
  });
});

describe("syncWeekParticipation", () => {
  function queueFullAttendance(cohortId: number | null) {
    state.selectQueue.push([{ id: 1 }, { id: 2 }]); // lectures
    state.selectQueue.push([
      { lectureId: 1, attended: true, participationScore: 0 },
      { lectureId: 2, attended: true, participationScore: 0 },
    ]); // attendance
    state.selectQueue.push([{ cohortId }]); // user's cohort
  }

  it("emits a participation ScoringEvent with the week's points", async () => {
    queueFullAttendance(3);

    const result = await syncWeekParticipation(5, 9);

    expect(result.points).toBe(POINTS.PARTICIPATION_MAX);
    expect(onScoringEvent).toHaveBeenCalledTimes(1);
    expect(onScoringEvent).toHaveBeenCalledWith({
      studentId: 5,
      cohortId: 3,
      source: "participation",
      weekId: 9,
      points: POINTS.PARTICIPATION_MAX,
    });
  });

  it("passes a null cohort through rather than inventing one", async () => {
    queueFullAttendance(null);
    await syncWeekParticipation(5, 9);
    expect(onScoringEvent.mock.calls[0][0]).toMatchObject({ cohortId: null });
  });

  it("swallows a leaderboard rejection — attendance is already committed", async () => {
    queueFullAttendance(3);
    onScoringEvent.mockRejectedValueOnce(new Error("leaderboard down"));

    await expect(syncWeekParticipation(5, 9)).resolves.toMatchObject({
      points: POINTS.PARTICIPATION_MAX,
    });
  });
});
