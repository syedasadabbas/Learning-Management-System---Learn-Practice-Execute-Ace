// =============================================================================
// Unit tests: aggregated week rows -> WeekProgress.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// `./query` is mocked so the database is never touched (tests/setup.ts states the
// rule: a unit test that imports src/db is a design smell). Mocking the query
// module rather than `pg` also keeps the SQL out of the unit suite entirely — the
// statement itself is covered by the Playwright spec against a seeded database.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POINTS } from "@/lib/contracts/scoring";

vi.mock("./query", () => ({ fetchWeekAggregates: vi.fn() }));

import {
  buildWeekProgress,
  getWeeklyScore,
  getWeeklyScoreBreakdown,
  totalsFrom,
} from "./aggregate";
import { completedWeekRow, emptyWeekRow, gradedAssignment } from "./fixtures";
import { fetchWeekAggregates } from "./query";

const fetchMock = vi.mocked(fetchWeekAggregates);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("buildWeekProgress — brand-new student", () => {
  const rows = [1, 2, 3, 4].map((n) => emptyWeekRow(n));
  const weeks = buildWeekProgress(rows);

  it("returns one row per week, week number ascending", () => {
    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4]);
  });

  it("opens week 1 only", () => {
    expect(weeks.map((w) => w.unlocked)).toEqual([true, false, false, false]);
  });

  it("reports zero completion without nulls or NaN", () => {
    for (const week of weeks) {
      expect(week.lecturesCompleted).toBe(0);
      expect(week.quizBestPercent).toBeNull();
      expect(week.quizCompleted).toBe(false);
      expect(week.assignmentCompleted).toBe(false);
      expect(week.overallScore).toBe(0);
      expect(Number.isNaN(week.overallScore)).toBe(false);
    }
  });

  it("carries lectureTotal so a caller needs no second query", () => {
    // The read-model docstring's explicit promise: "2 of 3 lectures" with one query.
    expect(weeks.every((w) => w.lectureTotal === 3)).toBe(true);
  });
});

describe("buildWeekProgress — scoring", () => {
  it("scores a perfect week at exactly WEEK_MAX", () => {
    const [week] = buildWeekProgress([completedWeekRow(1)]);
    expect(week.breakdown).toEqual({
      quizPoints: POINTS.QUIZ_MAX,
      assignmentPoints: POINTS.ASSIGNMENT_MAX,
      participationPoints: POINTS.PARTICIPATION_MAX,
      total: POINTS.WEEK_MAX,
    });
    expect(week.overallScore).toBe(POINTS.WEEK_MAX);
  });

  it("scores a passed quiz plus a graded assignment, no participation", () => {
    // The acceptance criterion from the skill definition.
    const [week] = buildWeekProgress([
      completedWeekRow(1, 80, { participationPointsRaw: 0 }),
    ]);
    expect(week.overallScore).toBe(POINTS.QUIZ_MAX + POINTS.ASSIGNMENT_MAX);
  });

  it("gives a failed quiz no quiz points but keeps the assignment points", () => {
    const [week] = buildWeekProgress([
      completedWeekRow(1, 30, { participationPointsRaw: 0 }),
    ]);
    expect(week.breakdown.quizPoints).toBe(0);
    expect(week.breakdown.assignmentPoints).toBe(POINTS.ASSIGNMENT_MAX);
  });

  it("reduces the assignment component for a low star rating", () => {
    const [week] = buildWeekProgress([
      completedWeekRow(1, 80, {
        participationPointsRaw: 0,
        assignments: [gradedAssignment(1, 1)],
      }),
    ]);
    expect(week.breakdown.assignmentPoints).toBeLessThan(POINTS.ASSIGNMENT_MAX);
  });

  it("derives the score rather than trusting a stale stored flag", () => {
    // quizCompletedFlag is true but there is no attempt: the score must be 0,
    // because the write side's flag is not an authority on points.
    const [week] = buildWeekProgress([
      emptyWeekRow(1, { quizCompletedFlag: true }),
    ]);
    expect(week.quizCompleted).toBe(true);
    expect(week.overallScore).toBe(0);
  });
});

describe("buildWeekProgress — completion flags", () => {
  it("marks a quiz complete once every quiz in the week has an attempt", () => {
    const [week] = buildWeekProgress([
      emptyWeekRow(1, { quizCount: 2, attemptedQuizCount: 2, quizBestPercent: 75 }),
    ]);
    expect(week.quizCompleted).toBe(true);
  });

  it("does not mark a quiz complete when only one of two was attempted", () => {
    const [week] = buildWeekProgress([
      emptyWeekRow(1, { quizCount: 2, attemptedQuizCount: 1, quizBestPercent: 75 }),
    ]);
    expect(week.quizCompleted).toBe(false);
  });

  it("does not claim completion for a week with no quiz at all", () => {
    const [week] = buildWeekProgress([emptyWeekRow(1, { quizCount: 0 })]);
    expect(week.quizCompleted).toBe(false);
  });

  it("treats a submitted-but-ungraded assignment as delivered", () => {
    const [week] = buildWeekProgress([
      emptyWeekRow(1, {
        submittedAssignmentCount: 1,
        gradedAssignmentCount: 0,
        assignments: [gradedAssignment(1, null, { status: "submitted" })],
      }),
    ]);
    expect(week.assignmentCompleted).toBe(true);
    expect(week.gradedAssignmentCount).toBe(0);
  });
});

describe("totalsFrom", () => {
  it("is all zeroes for an empty course, with no NaN", () => {
    expect(totalsFrom([])).toEqual({ totalScore: 0, maxScore: 0, percent: 0 });
  });

  it("sums week scores against weeks x WEEK_MAX", () => {
    const weeks = buildWeekProgress([completedWeekRow(1), emptyWeekRow(2)]);
    const totals = totalsFrom(weeks);
    expect(totals.totalScore).toBe(POINTS.WEEK_MAX);
    expect(totals.maxScore).toBe(2 * POINTS.WEEK_MAX);
    expect(totals.percent).toBe(50);
  });
});

describe("getWeeklyScore", () => {
  it("returns the score for the requested week", async () => {
    fetchMock.mockResolvedValue([completedWeekRow(1), emptyWeekRow(2)]);
    await expect(getWeeklyScore(7, completedWeekRow(1).weekId)).resolves.toBe(POINTS.WEEK_MAX);
  });

  it("returns 0 for a week outside the student's course", async () => {
    fetchMock.mockResolvedValue([completedWeekRow(1)]);
    await expect(getWeeklyScore(7, 999_999)).resolves.toBe(0);
  });

  it("returns 0, not NaN, for a student with no rows at all", async () => {
    fetchMock.mockResolvedValue([]);
    await expect(getWeeklyScore(7, 101)).resolves.toBe(0);
  });

  it("exposes the component breakdown, or null off-course", async () => {
    fetchMock.mockResolvedValue([completedWeekRow(1)]);
    await expect(getWeeklyScoreBreakdown(7, completedWeekRow(1).weekId)).resolves.toEqual({
      quizPoints: POINTS.QUIZ_MAX,
      assignmentPoints: POINTS.ASSIGNMENT_MAX,
      participationPoints: POINTS.PARTICIPATION_MAX,
      total: POINTS.WEEK_MAX,
    });
    await expect(getWeeklyScoreBreakdown(7, 999_999)).resolves.toBeNull();
  });
});
