// =============================================================================
// Unit tests: weekly-score aggregation. Pure arithmetic, no database.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// Expectations are written against the scoring contract's own helpers wherever a
// band or a cap is involved, so these tests verify that progress AGGREGATES
// correctly rather than re-asserting scoring.ts's numbers (which have their own
// tests). Literals are used only where the point of the test is the literal.
// =============================================================================

import { describe, expect, it } from "vitest";

import { POINTS, assignmentPoints, quizPointsFromPercent } from "@/lib/contracts/scoring";

import {
  assignmentPointsForWeek,
  overallPercent,
  participationPointsForWeek,
  quizPointsForWeek,
  weekScore,
  weekScoreBreakdown,
  type AssignmentScoreInput,
} from "./score";

const DUE = new Date("2026-09-07T00:00:00.000Z");
const DAY_MS = 86_400_000;

function assignment(overrides: Partial<AssignmentScoreInput> = {}): AssignmentScoreInput {
  return {
    assignmentId: 1,
    dueAt: DUE,
    latePenaltyPercentPerDay: 10,
    submittedAt: null,
    stars: null,
    ...overrides,
  };
}

describe("quizPointsForWeek", () => {
  it("is 0 with no attempt", () => {
    expect(quizPointsForWeek(null)).toBe(0);
  });

  it("is 0 for a non-finite percentage", () => {
    expect(quizPointsForWeek(Number.NaN)).toBe(0);
  });

  it("defers to the scoring contract's bands", () => {
    for (const percent of [0, 49.99, 50, 59.99, 60, 69.99, 70, 100]) {
      expect(quizPointsForWeek(percent)).toBe(quizPointsFromPercent(percent));
    }
  });

  it("awards the full quiz allocation at the pass threshold", () => {
    expect(quizPointsForWeek(70)).toBe(POINTS.QUIZ_MAX);
  });
});

describe("assignmentPointsForWeek", () => {
  it("is 0 when the week has no assignment at all", () => {
    expect(assignmentPointsForWeek([])).toBe(0);
  });

  it("is 0 when nothing was submitted", () => {
    expect(assignmentPointsForWeek([assignment()])).toBe(0);
  });

  it("awards the full allocation for an on-time, well-rated submission", () => {
    expect(assignmentPointsForWeek([assignment({ submittedAt: DUE, stars: 5 })])).toBe(
      POINTS.ASSIGNMENT_MAX,
    );
  });

  it("applies the contract's late penalty", () => {
    const submittedAt = new Date(DUE.getTime() + 2 * DAY_MS);
    const expected = assignmentPoints({
      daysLate: 2,
      latePenaltyPercentPerDay: 10,
      stars: 5,
    });
    expect(assignmentPointsForWeek([assignment({ submittedAt, stars: 5 })])).toBe(expected);
    // Sanity: the penalty actually reduced something.
    expect(expected).toBeLessThan(POINTS.ASSIGNMENT_MAX);
  });

  it("applies the contract's star shortfall", () => {
    const expected = assignmentPoints({ daysLate: 0, latePenaltyPercentPerDay: 10, stars: 1 });
    expect(assignmentPointsForWeek([assignment({ submittedAt: DUE, stars: 1 })])).toBe(expected);
  });

  it("averages several assignments so the week ceiling stays at ASSIGNMENT_MAX", () => {
    const points = assignmentPointsForWeek([
      assignment({ assignmentId: 1, submittedAt: DUE, stars: 5 }),
      assignment({ assignmentId: 2 }), // not submitted -> 0
    ]);
    expect(points).toBe(Math.round(POINTS.ASSIGNMENT_MAX / 2));
    expect(points).toBeLessThanOrEqual(POINTS.ASSIGNMENT_MAX);
  });
});

describe("participationPointsForWeek", () => {
  it("is 0 for a student with no attendance", () => {
    expect(participationPointsForWeek(0)).toBe(0);
  });

  it("caps at the participation allocation", () => {
    expect(participationPointsForWeek(500)).toBe(POINTS.PARTICIPATION_MAX);
  });

  it("never goes negative", () => {
    expect(participationPointsForWeek(-20)).toBe(0);
  });
});

describe("weekScoreBreakdown", () => {
  it("is all zeroes for a brand-new student", () => {
    // The zero-activity case: no NaN, no negative, no undefined.
    const breakdown = weekScoreBreakdown({
      quizBestPercent: null,
      assignments: [assignment()],
      participationPointsRaw: 0,
    });
    expect(breakdown).toEqual({
      quizPoints: 0,
      assignmentPoints: 0,
      participationPoints: 0,
      total: 0,
    });
  });

  it("sums quiz, assignment and participation", () => {
    const breakdown = weekScoreBreakdown({
      quizBestPercent: 65, // -> 15 points per the contract's middle band
      assignments: [assignment({ submittedAt: DUE, stars: 3 })],
      participationPointsRaw: 4,
    });
    expect(breakdown.quizPoints).toBe(quizPointsFromPercent(65));
    expect(breakdown.assignmentPoints).toBe(POINTS.ASSIGNMENT_MAX);
    expect(breakdown.participationPoints).toBe(4);
    expect(breakdown.total).toBe(quizPointsFromPercent(65) + POINTS.ASSIGNMENT_MAX + 4);
  });

  it("reaches exactly WEEK_MAX for a perfect week", () => {
    const breakdown = weekScoreBreakdown({
      quizBestPercent: 100,
      assignments: [assignment({ submittedAt: DUE, stars: 5 })],
      participationPointsRaw: POINTS.PARTICIPATION_MAX,
    });
    expect(breakdown.total).toBe(POINTS.WEEK_MAX);
  });

  it("caps the total at WEEK_MAX even if the components sum higher", () => {
    // Participation is over-recorded; the week must still not exceed its cap.
    const breakdown = weekScoreBreakdown({
      quizBestPercent: 100,
      assignments: [assignment({ submittedAt: DUE, stars: 5 })],
      participationPointsRaw: 999,
    });
    expect(breakdown.total).toBe(POINTS.WEEK_MAX);
  });
});

describe("weekScore", () => {
  it("returns the capped total", () => {
    expect(
      weekScore({ quizBestPercent: 100, assignments: [], participationPointsRaw: 0 }),
    ).toBe(POINTS.QUIZ_MAX);
  });
});

describe("overallPercent", () => {
  it("is 0, not NaN, when the course has no weeks", () => {
    // The division-by-zero that would render "NaN%" on a first load.
    expect(overallPercent(0, 0)).toBe(0);
    expect(Number.isNaN(overallPercent(0, 0))).toBe(false);
  });

  it("is 0 for a brand-new student on a four-week course", () => {
    expect(overallPercent(0, 4)).toBe(0);
  });

  it("scales against weeks x WEEK_MAX", () => {
    expect(overallPercent(POINTS.WEEK_MAX, 4)).toBe(25);
    expect(overallPercent(4 * POINTS.WEEK_MAX, 4)).toBe(100);
  });

  it("never exceeds 100", () => {
    expect(overallPercent(10_000, 4)).toBe(100);
  });
});
