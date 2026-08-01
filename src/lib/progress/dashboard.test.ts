// =============================================================================
// Unit tests: dashboard view model, with the zero-activity student first.
// Owner: progress-tracking stream. Database mocked at the query boundary.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POINTS } from "@/lib/contracts/scoring";

vi.mock("./query", () => ({ fetchWeekAggregates: vi.fn() }));

import { ALL_OPEN_SECTIONS } from "../../../tests/support/curriculum-sections";

import { buildWeekProgress } from "./aggregate";
import {
  buildDashboard,
  deriveNextAction,
  deriveNextDeadline,
  getDashboard,
  isWeekComplete,
  serialiseDashboard,
} from "./dashboard";
import { completedWeekRow, emptyWeekRow } from "./fixtures";
import { fetchWeekAggregates } from "./query";

const fetchMock = vi.mocked(fetchWeekAggregates);
const NOW = new Date("2026-09-03T12:00:00.000Z");

beforeEach(() => {
  fetchMock.mockReset();
});

/** Four untouched weeks with deadlines — a student who just registered. */
function newStudentWeeks() {
  return buildWeekProgress(
    [1, 2, 3, 4].map((n) =>
      emptyWeekRow(n, { dueAt: new Date(`2026-09-${String(7 * n).padStart(2, "0")}T00:00:00.000Z`) }),
    ),
  );
}

describe("buildDashboard — brand-new student with zero activity", () => {
  const model = buildDashboard(7, newStudentWeeks(), NOW);

  it("renders 0 points against a real ceiling", () => {
    expect(model.totalScore).toBe(0);
    expect(model.maxScore).toBe(4 * POINTS.WEEK_MAX);
  });

  it("shows 0%, never NaN", () => {
    expect(model.overallPercent).toBe(0);
    expect(Number.isFinite(model.overallPercent)).toBe(true);
  });

  it("opens week 1 and nothing else", () => {
    expect(model.weeksUnlocked).toBe(1);
    expect(model.currentWeekNumber).toBe(1);
  });

  it("counts no completed weeks", () => {
    expect(model.weeksCompleted).toBe(0);
  });

  it("still lists every week, so the page is never blank", () => {
    expect(model.weeks).toHaveLength(4);
  });

  it("points the student at week 1", () => {
    expect(model.nextAction.kind).toBe("lectures");
    expect(model.nextAction.weekNumber).toBe(1);
    expect(model.nextAction.label).toContain("Week 1");
    expect(model.nextAction.href).toBeTruthy();
  });

  it("flags itself as a new student for the welcome copy", () => {
    expect(model.isNewStudent).toBe(true);
  });

  it("finds the next upcoming deadline", () => {
    expect(model.nextDeadline?.weekNumber).toBe(1);
    expect(model.nextDeadline?.overdue).toBe(false);
  });
});

describe("buildDashboard — empty course", () => {
  const model = buildDashboard(7, [], NOW);

  it("does not divide by zero", () => {
    expect(model.overallPercent).toBe(0);
    expect(model.maxScore).toBe(0);
    expect(Number.isNaN(model.overallPercent)).toBe(false);
  });

  it("has no current week and an honest next action", () => {
    expect(model.currentWeekNumber).toBeNull();
    expect(model.nextAction.kind).toBe("locked");
    expect(model.nextAction.weekNumber).toBeNull();
  });

  it("reports no deadline rather than an invalid date", () => {
    expect(model.nextDeadline).toBeNull();
  });
});

describe("buildDashboard — a student mid-course", () => {
  // ALL_OPEN_SECTIONS: this block is about mid-course PROGRESSION arithmetic.
  // On the shipped config weeks 2-4 are withheld, so without it "week 2
  // unlocked" would be asserting the release switch, not the unlock chain.
  const weeks = buildWeekProgress([
    completedWeekRow(1, 85, { dueAt: new Date("2026-09-07T00:00:00.000Z") }),
    emptyWeekRow(2, { dueAt: new Date("2026-09-14T00:00:00.000Z") }),
    emptyWeekRow(3, { dueAt: new Date("2026-09-21T00:00:00.000Z") }),
  ], ALL_OPEN_SECTIONS);
  const model = buildDashboard(7, weeks, NOW);

  it("counts week 1 complete and week 2 unlocked", () => {
    expect(model.weeksCompleted).toBe(1);
    expect(model.weeksUnlocked).toBe(2);
    expect(model.currentWeekNumber).toBe(2);
  });

  it("reflects the passed quiz and graded assignment in the total", () => {
    expect(model.totalScore).toBe(POINTS.WEEK_MAX);
    expect(model.isNewStudent).toBe(false);
  });

  it("sends the student to week 2's lectures next", () => {
    expect(model.nextAction.kind).toBe("lectures");
    expect(model.nextAction.weekNumber).toBe(2);
  });
});

describe("deriveNextAction ordering", () => {
  it("asks for the quiz once the lectures are done", () => {
    const weeks = buildWeekProgress([emptyWeekRow(1, { lecturesCompleted: 3 })], ALL_OPEN_SECTIONS);
    expect(deriveNextAction(weeks).kind).toBe("quiz");
  });

  it("asks for the assignment once the quiz is done", () => {
    const weeks = buildWeekProgress([
      emptyWeekRow(1, { lecturesCompleted: 3, quizBestPercent: 90, attemptedQuizCount: 1 }),
    ], ALL_OPEN_SECTIONS);
    expect(deriveNextAction(weeks).kind).toBe("assignment");
  });

  it("explains the gate when everything open is finished but the next week is shut", () => {
    // Week 1 fully done but failed: week 2 stays locked, so the action is the retake.
    const weeks = buildWeekProgress([
      completedWeekRow(1, 40),
      emptyWeekRow(2),
    ], ALL_OPEN_SECTIONS);
    const action = deriveNextAction(weeks);
    expect(action.kind).toBe("locked");
    expect(action.weekNumber).toBe(2);
    expect(action.label).toContain("70%");
  });

  it("congratulates a student who finished everything", () => {
    const weeks = buildWeekProgress([completedWeekRow(1), completedWeekRow(2)], ALL_OPEN_SECTIONS);
    expect(deriveNextAction(weeks).kind).toBe("done");
  });
});

describe("deriveNextDeadline", () => {
  it("is null when no week has a due date", () => {
    expect(
      deriveNextDeadline(buildWeekProgress([emptyWeekRow(1)], ALL_OPEN_SECTIONS), NOW),
    ).toBeNull();
  });

  it("falls back to the most recent overdue deadline when all have passed", () => {
    const weeks = buildWeekProgress([
      emptyWeekRow(1, { dueAt: new Date("2026-08-01T00:00:00.000Z") }),
      emptyWeekRow(2, { dueAt: new Date("2026-08-20T00:00:00.000Z") }),
    ]);
    const deadline = deriveNextDeadline(weeks, NOW);
    expect(deadline?.weekNumber).toBe(2);
    expect(deadline?.overdue).toBe(true);
    expect(deadline?.daysRemaining).toBeLessThan(0);
  });
});

describe("isWeekComplete", () => {
  it("is false for an untouched week", () => {
    expect(isWeekComplete(buildWeekProgress([emptyWeekRow(1)])[0])).toBe(false);
  });

  it("is false for a week with no work authored yet", () => {
    const week = buildWeekProgress([
      emptyWeekRow(1, { lectureTotal: 0, quizCount: 0, assignmentCount: 0, assignments: [] }),
    ])[0];
    expect(isWeekComplete(week)).toBe(false);
  });

  it("is true when lectures, quiz and assignment are all done", () => {
    expect(isWeekComplete(buildWeekProgress([completedWeekRow(1)])[0])).toBe(true);
  });
});

describe("serialiseDashboard", () => {
  it("turns every Date into an ISO-8601 string", () => {
    const model = buildDashboard(7, newStudentWeeks(), NOW);
    const payload = serialiseDashboard(model);
    expect(typeof payload.weeks[0].dueAt).toBe("string");
    expect(payload.nextDeadline && typeof payload.nextDeadline.dueAt).toBe("string");
    // Round-trips through JSON without loss.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("keeps a null due date null rather than emitting an invalid date", () => {
    const payload = serialiseDashboard(buildDashboard(7, buildWeekProgress([emptyWeekRow(1)]), NOW));
    expect(payload.weeks[0].dueAt).toBeNull();
    expect(payload.nextDeadline).toBeNull();
  });
});

describe("getDashboard", () => {
  it("reads the database once and derives the rest", async () => {
    fetchMock.mockResolvedValue([1, 2, 3, 4].map((n) => emptyWeekRow(n)));
    const model = await getDashboard(7, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(model.weeks).toHaveLength(4);
    expect(model.overallPercent).toBe(0);
  });
});
