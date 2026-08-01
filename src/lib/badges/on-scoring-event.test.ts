// =============================================================================
// Tests for the TRIGGER SEAM. Owner: badges stream.
// -----------------------------------------------------------------------------
// Badges do not have their own event mechanism: they ride `ScoringEvent`, the
// frozen cross-stream contract, hooked at the single fan-out point that every
// producer already calls (src/lib/leaderboard/on-scoring-event.ts). The whole
// argument is in ./on-scoring-event.ts:8-45.
//
// That makes the seam a cross-stream one, and cross-stream seams are exactly what
// tests/unit/cross-stream-contracts.test.ts:8-21 exists for: "Signatures landed as
// stubs and then had their bodies replaced by a different agent. A rename would
// compile fine in the file that owns it and break only the CALLER." So this file
// asserts, from the badges side:
//
//   1. `awardBadgesForScoringEvent` forwards the event's studentId and nothing else;
//   2. it NEVER throws, whatever the service does;
//   3. THE LEADERBOARD HOOK ACTUALLY CALLS IT. This is the one that would silently
//      rot: if someone reverts or refactors that call away, badges stop being
//      awarded and every test in this directory still passes. It is asserted here
//      rather than in the leaderboard's own test file because it is the badges
//      stream's dependency on another stream's file, so the failure should land on
//      the stream that cares.
//   4. A badge failure CANNOT reach the grade — the reason the leaderboard hook
//      swallows in the first place.
//
// No database: `./service` is mocked, which is the correct boundary here. The
// database half of this feature is proven against real Postgres in
// ./award.integration.test.ts.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringEvent } from "@/lib/contracts/events";

const evaluateAndAwardBadges = vi.fn();

vi.mock("./service", () => ({
  evaluateAndAwardBadges: (id: number, opts?: unknown) => evaluateAndAwardBadges(id, opts),
}));

const { awardBadgesForScoringEvent } = await import("./on-scoring-event");

function event(over: Partial<ScoringEvent> = {}): ScoringEvent {
  return {
    studentId: 11,
    cohortId: 3,
    source: "assignment",
    weekId: 2,
    points: 36,
    ...over,
  };
}

function report(over: Record<string, unknown> = {}) {
  return { studentId: 11, qualified: [], newlyAwarded: [], durationMs: 1, ...over };
}

beforeEach(() => {
  evaluateAndAwardBadges.mockReset();
  evaluateAndAwardBadges.mockResolvedValue(report());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("awardBadgesForScoringEvent — the adapter", () => {
  it("evaluates the student the event names", async () => {
    await awardBadgesForScoringEvent(event({ studentId: 42 }));
    expect(evaluateAndAwardBadges).toHaveBeenCalledWith(42, undefined);
  });

  it("ignores source, points and weekId", async () => {
    // The criteria are course-wide and are computed from the database, never from
    // the event payload. If this ever starts mattering, the criteria have grown a
    // dependency on WHICH event fired, and that is the point at which per-call-site
    // badge lists (the thing ./on-scoring-event.ts:18-27 argues against) start
    // looking necessary again — so it should fail here first.
    await awardBadgesForScoringEvent(event({ source: "quiz", points: 20, weekId: 1 }));
    await awardBadgesForScoringEvent(event({ source: "final_project", points: 30, weekId: null }));
    expect(evaluateAndAwardBadges).toHaveBeenNthCalledWith(1, 11, undefined);
    expect(evaluateAndAwardBadges).toHaveBeenNthCalledWith(2, 11, undefined);
  });

  it("ignores the event's cohortId, which is a hint and not truth", async () => {
    // src/lib/leaderboard/rebuild.ts:225-227 makes the same call for the same
    // reason: a caller can hold a stale cohort id.
    await awardBadgesForScoringEvent(event({ cohortId: 999 }));
    expect(evaluateAndAwardBadges).toHaveBeenCalledWith(11, undefined);
  });

  it("returns the service's report unchanged", async () => {
    evaluateAndAwardBadges.mockResolvedValue(report({ newlyAwarded: ["perfect_quiz"] }));
    const result = await awardBadgesForScoringEvent(event());
    expect(result.newlyAwarded).toEqual(["perfect_quiz"]);
  });

  it("never throws, even if the service rejects", async () => {
    // ./service.ts swallows its own errors, so this branch should be unreachable —
    // which is exactly why it is asserted. The guarantee the leaderboard hook, and
    // through it the quizzes and submissions grading paths, are relying on must not
    // depend on another module keeping a promise it made in a comment.
    evaluateAndAwardBadges.mockRejectedValue(new Error("connection terminated"));

    const result = await awardBadgesForScoringEvent(event({ studentId: 5 }));

    // Resolves to an EMPTY report rather than rejecting, so a caller reading
    // `newlyAwarded` gets "nothing was awarded" instead of an exception.
    expect(result).toMatchObject({ studentId: 5, qualified: [], newlyAwarded: [] });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the leaderboard hook is actually wired to badges", () => {
  it("calls awardBadgesForScoringEvent after applying the score", async () => {
    // THE REGRESSION GUARD. Remove the call from
    // src/lib/leaderboard/on-scoring-event.ts and badges silently stop being
    // awarded, with every other badges test still green.
    vi.resetModules();

    const applyScoringEvent = vi.fn().mockResolvedValue({
      applied: true,
      totalScore: 70,
      rowsRanked: 1,
      durationMs: 3,
    });
    const awardSpy = vi.fn().mockResolvedValue(report());

    vi.doMock("@/lib/leaderboard/rebuild", () => ({ applyScoringEvent }));
    vi.doMock("./on-scoring-event", () => ({ awardBadgesForScoringEvent: awardSpy }));

    try {
      const { onScoringEvent } = await import("@/lib/leaderboard/on-scoring-event");
      const e = event({ studentId: 7 });
      await onScoringEvent(e);

      expect(applyScoringEvent).toHaveBeenCalledWith(e);
      // The whole event is forwarded, not just an id, so the adapter stays a
      // drop-in second consumer of the same contract.
      expect(awardSpy).toHaveBeenCalledWith(e);
    } finally {
      vi.doUnmock("@/lib/leaderboard/rebuild");
      vi.doUnmock("./on-scoring-event");
      vi.resetModules();
    }
  });

  it("does NOT evaluate badges when the scoring event was rejected", async () => {
    // An event for an unknown id, or for a member of staff, is dropped by the
    // leaderboard before it writes anything (rebuild.ts:249-257). Badges must be
    // dropped with it: evaluating an instructor would run five criteria that are all
    // false, on every grading event, forever.
    vi.resetModules();

    const applyScoringEvent = vi.fn().mockResolvedValue({
      applied: false,
      skippedReason: "not_a_student",
      totalScore: null,
      rowsRanked: 0,
      durationMs: 1,
    });
    const awardSpy = vi.fn().mockResolvedValue(report());

    vi.doMock("@/lib/leaderboard/rebuild", () => ({ applyScoringEvent }));
    vi.doMock("./on-scoring-event", () => ({ awardBadgesForScoringEvent: awardSpy }));

    try {
      const { onScoringEvent } = await import("@/lib/leaderboard/on-scoring-event");
      await onScoringEvent(event());
      expect(awardSpy).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/leaderboard/rebuild");
      vi.doUnmock("./on-scoring-event");
      vi.resetModules();
    }
  });

  it("a badge failure cannot fail the grading path", async () => {
    // THE PROPERTY THE WHOLE INTEGRATION RESTS ON. `onScoringEvent` is called from
    // src/lib/quizzes/service.ts:570 and src/lib/submissions/grade.ts:195 on the
    // strength of never rejecting. Adding a second consumer must not have weakened
    // that.
    vi.resetModules();

    const applyScoringEvent = vi.fn().mockResolvedValue({
      applied: true,
      totalScore: 70,
      rowsRanked: 1,
      durationMs: 3,
    });
    const awardSpy = vi.fn().mockRejectedValue(new Error("badge_awards is on fire"));

    vi.doMock("@/lib/leaderboard/rebuild", () => ({ applyScoringEvent }));
    vi.doMock("./on-scoring-event", () => ({ awardBadgesForScoringEvent: awardSpy }));

    try {
      const { onScoringEvent } = await import("@/lib/leaderboard/on-scoring-event");
      // Resolves, not rejects. The leaderboard hook's own try/catch absorbs it, and
      // the score has already been applied by then, so the grade is unaffected.
      await expect(onScoringEvent(event())).resolves.toBeUndefined();
      expect(applyScoringEvent).toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/leaderboard/rebuild");
      vi.doUnmock("./on-scoring-event");
      vi.resetModules();
    }
  });
});
