// =============================================================================
// SCORING CONTRACT TESTS
// -----------------------------------------------------------------------------
// scoring.ts is imported by quizzes, submissions, progress-tracking, and
// leaderboard. A regression here silently corrupts every grade and rank in the
// system, so the boundaries are pinned exhaustively rather than sampled.
//
// Every band edge is tested at the edge AND one step below it — off-by-one on a
// >= is the defect this file exists to catch.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  POINTS,
  QUIZ_PASS_PERCENT,
  QUIZ_FAIL_PERCENT,
  quizPointsFromPercent,
  assignmentPoints,
  assignmentPointsCeiling,
  daysLate,
  shouldUnlockNextWeek,
  courseMaxScore,
  letterGrade,
} from "./scoring";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("POINTS totals", () => {
  it("weights match the syllabus breakdown (quiz 20 / assignment 40 / participation 10 / final 30)", () => {
    expect(POINTS.QUIZ_MAX).toBe(20);
    expect(POINTS.ASSIGNMENT_MAX).toBe(40);
    expect(POINTS.PARTICIPATION_MAX).toBe(10);
    expect(POINTS.FINAL_PROJECT_MAX).toBe(30);
  });

  it("WEEK_MAX equals the sum of its per-week components", () => {
    // Guards against WEEK_MAX drifting away from the parts it aggregates.
    expect(POINTS.WEEK_MAX).toBe(
      POINTS.QUIZ_MAX + POINTS.ASSIGNMENT_MAX + POINTS.PARTICIPATION_MAX,
    );
  });

  it("the four weighted components sum to 100", () => {
    expect(
      POINTS.QUIZ_MAX +
        POINTS.ASSIGNMENT_MAX +
        POINTS.PARTICIPATION_MAX +
        POINTS.FINAL_PROJECT_MAX,
    ).toBe(100);
  });
});

describe("quizPointsFromPercent — banded, boundaries inclusive at the lower edge", () => {
  it.each([
    [100, 20],
    [85, 20],
    [70, 20], // pass boundary, inclusive
    [69.99, 15], // one step below -> next band down
    [69, 15],
    [60, 15], // boundary, inclusive
    [59.99, 10],
    [50, 10], // boundary, inclusive
    [49.99, 0],
    [49, 0],
    [1, 0],
    [0, 0],
  ])("%s%% -> %s points", (percent, expected) => {
    expect(quizPointsFromPercent(percent)).toBe(expected);
  });

  it("never exceeds QUIZ_MAX even for an impossible percentage", () => {
    expect(quizPointsFromPercent(150)).toBe(POINTS.QUIZ_MAX);
  });

  it("awards nothing for a negative percentage", () => {
    expect(quizPointsFromPercent(-10)).toBe(0);
  });

  it("the pass threshold constant is the band edge that unlocks", () => {
    expect(quizPointsFromPercent(QUIZ_PASS_PERCENT)).toBe(POINTS.QUIZ_MAX);
    expect(QUIZ_FAIL_PERCENT).toBeLessThan(QUIZ_PASS_PERCENT);
  });
});

describe("assignmentPoints — 0 until rated, then base 40 minus late penalty and star shortfall", () => {
  const onTime = { daysLate: 0, latePenaltyPercentPerDay: 10 };

  /**
   * THE HIGHEST-VALUE ASSERTION IN THIS FILE, and it asserts the OPPOSITE of what
   * it did before 2026-07-31.
   *
   * It used to read "awards full marks on time with no rating yet" and expect 40.
   * That was a faithful test of a real defect: `assignmentPointsForWeek`
   * (src/lib/progress/score.ts) feeds the student dashboard straight from this
   * function, so ingesting a row from the Google response sheet awarded the student
   * the full 40 before any human had opened their work — and marking it could then
   * only take points away. The long argument is on `assignmentPoints` itself.
   *
   * The three "late penalty" cases below moved to `assignmentPointsCeiling` for the
   * same reason: they were passing `stars: null` to mean "isolate the late penalty",
   * which is now what the ceiling function is for.
   */
  it("awards NOTHING for a submission nobody has rated yet", () => {
    expect(assignmentPoints({ ...onTime, stars: null })).toBe(0);
  });

  it("awards nothing for an unrated submission however late it is", () => {
    // Not "0 minus a penalty" — 0 is the floor and the late penalty is irrelevant
    // until there is something to deduct it from.
    for (const daysLate of [0, 1, 2, 30]) {
      expect(assignmentPoints({ daysLate, latePenaltyPercentPerDay: 10, stars: null })).toBe(0);
    }
  });

  it.each([
    [5, 40], // above the 3-star bar: no bonus, no penalty
    [4, 40],
    [3, 40], // 3 stars is "full marks"
    [2, 30], // each star below 3 costs 10
    [1, 20],
  ])("on time with %s stars -> %s points", (stars, expected) => {
    expect(assignmentPoints({ ...onTime, stars })).toBe(expected);
  });

  it("applies the per-day late penalty at a 3-star rating", () => {
    // 1 day * 10% = 10% of 40 = 4 -> 36. Rated 3 stars, so no star shortfall and
    // the late penalty is the only deduction. Previously expressed with
    // `stars: null`, which now means "unrated" and scores 0.
    expect(assignmentPoints({ daysLate: 1, latePenaltyPercentPerDay: 10, stars: 3 })).toBe(36);
  });

  it("caps the late penalty at 20% however late the work is", () => {
    // 2 days * 10% = 20% -> the cap is exactly reached
    expect(assignmentPoints({ daysLate: 2, latePenaltyPercentPerDay: 10, stars: 3 })).toBe(32);

    // Beyond the cap the score must not keep falling.
    for (const days of [3, 7, 30, 365]) {
      expect(assignmentPoints({ daysLate: days, latePenaltyPercentPerDay: 10, stars: 3 })).toBe(32);
    }
  });

  it("caps regardless of how aggressive the per-day rate is", () => {
    expect(assignmentPoints({ daysLate: 1, latePenaltyPercentPerDay: 100, stars: 3 })).toBe(32);
  });

  it("combines the late cap with the star shortfall", () => {
    // 20% cap -> 32, then 1 star = 2 below the bar = -20 -> 12
    expect(assignmentPoints({ daysLate: 5, latePenaltyPercentPerDay: 10, stars: 1 })).toBe(12);
  });

  it("never returns a negative score", () => {
    // The worst reachable combination is still positive (12), so this asserts
    // the floor holds rather than that it is reachable through normal inputs.
    const worst = assignmentPoints({ daysLate: 999, latePenaltyPercentPerDay: 100, stars: 1 });
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it("returns whole points (grades are integers everywhere else in the schema)", () => {
    const pts = assignmentPoints({ daysLate: 1, latePenaltyPercentPerDay: 7, stars: 2 });
    expect(Number.isInteger(pts)).toBe(true);
  });
});

describe("daysLate — ceiling, so any part-day counts as a full day late", () => {
  const due = new Date("2026-09-08T00:00:00Z");

  it("is 0 when submitted exactly on the deadline", () => {
    expect(daysLate(new Date("2026-09-08T00:00:00Z"), due)).toBe(0);
  });

  it("is 0 when submitted early", () => {
    expect(daysLate(new Date("2026-09-01T00:00:00Z"), due)).toBe(0);
  });

  it("rounds a single millisecond over into one full day late", () => {
    expect(daysLate(new Date(due.getTime() + 1), due)).toBe(1);
  });

  it.each([
    [1 * HOUR_MS, 1],
    [23 * HOUR_MS, 1],
    [24 * HOUR_MS, 1], // exactly one day -> 1, not 2
    [25 * HOUR_MS, 2],
    [48 * HOUR_MS, 2], // exactly two days -> 2, not 3
    [49 * HOUR_MS, 3],
    [7 * DAY_MS, 7],
  ])("%s ms past the deadline -> %s day(s) late", (offsetMs, expected) => {
    expect(daysLate(new Date(due.getTime() + offsetMs), due)).toBe(expected);
  });
});

describe("shouldUnlockNextWeek", () => {
  it.each([
    [100, true],
    [70, true], // threshold is inclusive
    [69.99, false],
    [50, false],
    [0, false],
  ])("best quiz %s%% -> unlock %s", (percent, expected) => {
    expect(shouldUnlockNextWeek(percent)).toBe(expected);
  });

  it("agrees with the quiz band that awards full points", () => {
    // Unlocking and scoring full quiz marks must share one threshold, or a
    // student can score 20/20 and stay locked out.
    expect(shouldUnlockNextWeek(QUIZ_PASS_PERCENT)).toBe(true);
    expect(quizPointsFromPercent(QUIZ_PASS_PERCENT)).toBe(POINTS.QUIZ_MAX);
  });
});

describe("courseMaxScore — derived, never hardcoded", () => {
  it("is 310 for the default 4-week course (4*70 + 30)", () => {
    expect(courseMaxScore()).toBe(310);
  });

  it.each([
    [1, 100],
    [4, 310],
    [8, 590],
    [12, 870],
  ])("a %s-week course has a %s-point ceiling", (weeks, expected) => {
    expect(courseMaxScore(weeks)).toBe(expected);
  });

  it("scales with WEEK_MAX rather than assuming a literal", () => {
    expect(courseMaxScore(3)).toBe(3 * POINTS.WEEK_MAX + POINTS.FINAL_PROJECT_MAX);
  });
});

describe("letterGrade — boundaries against the derived 310-point ceiling", () => {
  it.each([
    [310, "A"], // 100%
    [279, "A"], // exactly 90%
    [278, "B"], // 89.7%
    [248, "B"], // exactly 80%
    [247, "C"], // 79.7%
    [217, "C"], // exactly 70%
    [216, "D"], // 69.7%
    [186, "D"], // exactly 60%
    [185, "F"], // 59.7%
    [0, "F"],
  ])("total %s / 310 -> %s", (total, expected) => {
    expect(letterGrade(total)).toBe(expected);
  });

  it("honours an explicit ceiling when a caller passes one", () => {
    expect(letterGrade(90, 100)).toBe("A");
    expect(letterGrade(89, 100)).toBe("B");
  });

  it("returns F rather than NaN for a zero or negative ceiling", () => {
    // Regression guard: dividing by a 0 ceiling produced NaN, which compares
    // false against every band and fell through to F only by accident.
    expect(letterGrade(50, 0)).toBe("F");
    expect(letterGrade(50, -10)).toBe("F");
  });

  it("does not deflate grades the way the old hardcoded 330 ceiling did", () => {
    // 279/310 is an A. Under the previous literal 330 it scored 84.5% -> B.
    expect(letterGrade(279)).toBe("A");
    expect(letterGrade(279, 330)).toBe("B");
  });
});

describe("assignmentPointsCeiling — the late-penalty ceiling, with no rating applied", () => {
  /**
   * Split out of `assignmentPoints` on 2026-07-31. It answers "what is left to play
   * for", which is what the student's "Maximum still available" badge and the
   * instructor queue's projection were asking for when they passed `stars: null`.
   * Given a function of its own so that intent is in the call and not in a
   * convention about what a null means.
   */
  it("is the full maximum for on-time work", () => {
    expect(assignmentPointsCeiling({ daysLate: 0, latePenaltyPercentPerDay: 10 })).toBe(
      POINTS.ASSIGNMENT_MAX,
    );
  });

  it("deducts the per-day penalty", () => {
    expect(assignmentPointsCeiling({ daysLate: 1, latePenaltyPercentPerDay: 10 })).toBe(36);
  });

  it("caps the deduction at 20% however late, and however steep the rate", () => {
    for (const days of [2, 3, 7, 365]) {
      expect(assignmentPointsCeiling({ daysLate: days, latePenaltyPercentPerDay: 10 })).toBe(32);
    }
    expect(assignmentPointsCeiling({ daysLate: 1, latePenaltyPercentPerDay: 100 })).toBe(32);
  });

  it("is never below zero and always a whole number", () => {
    const pts = assignmentPointsCeiling({ daysLate: 999, latePenaltyPercentPerDay: 100 });
    expect(pts).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(pts)).toBe(true);
  });

  it("equals assignmentPoints at a 3-star rating, which is the definition of full marks", () => {
    for (const daysLate of [0, 1, 2, 9]) {
      expect(assignmentPointsCeiling({ daysLate, latePenaltyPercentPerDay: 10 })).toBe(
        assignmentPoints({ daysLate, latePenaltyPercentPerDay: 10, stars: 3 }),
      );
    }
  });
});
