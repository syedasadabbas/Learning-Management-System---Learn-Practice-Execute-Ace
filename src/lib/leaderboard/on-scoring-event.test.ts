// =============================================================================
// Tests for the frozen cross-stream hook. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// The single most important property here is NEVER THROWS. `quizzes` and
// `submissions` call this outside their transactions on the strength of that
// promise; if it ever rejects into an unguarded call site, a leaderboard fault
// rolls back a grade.
//
// The signature is also pinned below. It is the contract two other streams are
// compiling against on their own branches right now, so a rename or an extra
// required parameter must fail a test here rather than fail at merge.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringEvent } from "@/lib/contracts/events";

const applyScoringEvent = vi.fn();

vi.mock("./rebuild", () => ({ applyScoringEvent: (e: ScoringEvent) => applyScoringEvent(e) }));

// Added by the badges stream along with the second consumer of this event. Mocked
// for the reason tests/setup.ts:4-7 states: the real module reaches src/db, and a
// unit test that imports the database is a design smell. Without this stub, every
// test below would open a connection to the deliberately unreachable placeholder
// URL and log a swallowed failure. The badges side of the seam — that this hook
// calls it, with the right student, and that its failure cannot reach the grade —
// is asserted in src/lib/badges/on-scoring-event.test.ts.
vi.mock("@/lib/badges/on-scoring-event", () => ({
  awardBadgesForScoringEvent: vi.fn().mockResolvedValue({
    studentId: 0,
    qualified: [],
    newlyAwarded: [],
    durationMs: 0,
  }),
}));

const { onScoringEvent } = await import("./on-scoring-event");

function event(over: Partial<ScoringEvent> = {}): ScoringEvent {
  return {
    studentId: 1,
    cohortId: 1,
    source: "quiz",
    weekId: 1,
    points: 20,
    ...over,
  };
}

beforeEach(() => {
  applyScoringEvent.mockReset();
  applyScoringEvent.mockResolvedValue({
    applied: true,
    totalScore: 20,
    rowsRanked: 2,
    durationMs: 4,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("onScoringEvent — frozen signature", () => {
  it("takes exactly one parameter", () => {
    expect(onScoringEvent.length).toBe(1);
  });

  it("is named onScoringEvent", () => {
    expect(onScoringEvent.name).toBe("onScoringEvent");
  });

  it("returns a promise resolving to undefined", async () => {
    const returned = onScoringEvent(event());
    expect(returned).toBeInstanceOf(Promise);
    await expect(returned).resolves.toBeUndefined();
  });
});

describe("onScoringEvent — never throws", () => {
  it("swallows a rejection from the write path", async () => {
    applyScoringEvent.mockRejectedValue(new Error("deadlock detected"));
    await expect(onScoringEvent(event())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("swallows a non-Error throw", async () => {
    applyScoringEvent.mockRejectedValue("connection terminated unexpectedly");
    await expect(onScoringEvent(event())).resolves.toBeUndefined();
  });

  it("logs the event context so the failure is diagnosable", async () => {
    applyScoringEvent.mockRejectedValue(new Error("boom"));
    await onScoringEvent(event({ studentId: 88, source: "assignment", points: 36 }));

    const [, context] = (console.error as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(context).toMatchObject({
      studentId: 88,
      source: "assignment",
      points: 36,
      error: "boom",
    });
  });
});

describe("onScoringEvent — delegation", () => {
  it("forwards the event unchanged to the write path", async () => {
    const e = event({ studentId: 5, source: "participation", points: 3, weekId: 2 });
    await onScoringEvent(e);
    expect(applyScoringEvent).toHaveBeenCalledWith(e);
  });

  it("warns, but does not throw, when the event is ignored", async () => {
    applyScoringEvent.mockResolvedValue({
      applied: false,
      skippedReason: "not_a_student",
      totalScore: null,
      rowsRanked: 0,
      durationMs: 1,
    });

    await expect(onScoringEvent(event())).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("is safe to call repeatedly and concurrently", async () => {
    await Promise.all(Array.from({ length: 5 }, () => onScoringEvent(event())));
    expect(applyScoringEvent).toHaveBeenCalledTimes(5);
  });
});
