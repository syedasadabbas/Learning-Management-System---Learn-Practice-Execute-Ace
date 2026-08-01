// Progress derivation. Pure functions, no database — tests/setup.ts forbids a unit
// test importing src/db, and nothing here needs to.
import { describe, expect, it } from "vitest";

import {
  firstIncompleteIndex,
  groupByLevel,
  moduleProgress,
  progressAnnouncement,
  trackProgress,
} from "./progress";

describe("moduleProgress", () => {
  it("derives an integer percentage from completed / total steps", () => {
    expect(moduleProgress({ stepCount: 6, completedSteps: 3 }).percent).toBe(50);
    expect(moduleProgress({ stepCount: 4, completedSteps: 1 }).percent).toBe(25);
    // 1/3 rounds rather than trailing 33.333...
    expect(moduleProgress({ stepCount: 3, completedSteps: 1 }).percent).toBe(33);
  });

  it("reports the three statuses at their boundaries", () => {
    expect(moduleProgress({ stepCount: 6, completedSteps: 0 }).status).toBe("not_started");
    expect(moduleProgress({ stepCount: 6, completedSteps: 1 }).status).toBe("in_progress");
    expect(moduleProgress({ stepCount: 6, completedSteps: 5 }).status).toBe("in_progress");
    expect(moduleProgress({ stepCount: 6, completedSteps: 6 }).status).toBe("complete");
  });

  it("clamps completedSteps so '7 of 5 steps' is impossible", () => {
    // A step deleted after a student completed it leaves the row behind. The
    // display must not become nonsense because of it.
    const p = moduleProgress({ stepCount: 5, completedSteps: 7 });
    expect(p.completedSteps).toBe(5);
    expect(p.percent).toBe(100);
    expect(p.status).toBe("complete");
  });

  it("treats a module with no steps as complete rather than 0 per cent", () => {
    const p = moduleProgress({ stepCount: 0, completedSteps: 0 });
    expect(p.percent).toBe(100);
    expect(p.status).toBe("complete");
  });

  it("coerces nonsense counts to zero instead of producing NaN", () => {
    expect(moduleProgress({ stepCount: Number.NaN, completedSteps: 3 }).percent).toBe(100);
    expect(moduleProgress({ stepCount: 4, completedSteps: -9 }).completedSteps).toBe(0);
    expect(moduleProgress({ stepCount: 4, completedSteps: 2.7 }).completedSteps).toBe(2);
  });
});

describe("trackProgress", () => {
  it("weights by STEPS, not by an average of module percentages", () => {
    // Three finished 1-step modules and nothing of a 30-step module. Averaging the
    // module percentages would claim 75 %; the honest figure is 3/33.
    const modules = [
      { stepCount: 1, completedSteps: 1 },
      { stepCount: 1, completedSteps: 1 },
      { stepCount: 1, completedSteps: 1 },
      { stepCount: 30, completedSteps: 0 },
    ];
    const p = trackProgress(modules);
    expect(p.stepCount).toBe(33);
    expect(p.completedSteps).toBe(3);
    expect(p.percent).toBe(9);
    expect(p.modulesComplete).toBe(3);
    expect(p.moduleCount).toBe(4);
  });

  it("is 0 per cent for an empty track rather than dividing by zero", () => {
    const p = trackProgress([]);
    expect(p.percent).toBe(0);
    expect(p.stepCount).toBe(0);
  });

  it("reaches 100 only when every step is done", () => {
    expect(
      trackProgress([
        { stepCount: 6, completedSteps: 6 },
        { stepCount: 6, completedSteps: 5 },
      ]).percent,
    ).toBe(92);
    expect(
      trackProgress([
        { stepCount: 6, completedSteps: 6 },
        { stepCount: 6, completedSteps: 6 },
      ]).percent,
    ).toBe(100);
  });
});

describe("firstIncompleteIndex", () => {
  const ids = [10, 11, 12, 13];

  it("opens an untouched module at the first step", () => {
    expect(firstIncompleteIndex(ids, new Set())).toBe(0);
  });

  it("resumes where the student stopped — the point of per-step completion", () => {
    expect(firstIncompleteIndex(ids, new Set([10, 11]))).toBe(2);
  });

  it("finds the first gap, not the highest completed step", () => {
    // Steps can be completed out of order by jumping around the navigator.
    expect(firstIncompleteIndex(ids, new Set([10, 12, 13]))).toBe(1);
  });

  it("lands on the last step of a finished module rather than past the end", () => {
    expect(firstIncompleteIndex(ids, new Set(ids))).toBe(3);
  });

  it("returns 0 for a module with no steps", () => {
    expect(firstIncompleteIndex([], new Set())).toBe(0);
  });
});

describe("progressAnnouncement", () => {
  it("states counts and percentage, not colour", () => {
    const sentence = progressAnnouncement(moduleProgress({ stepCount: 6, completedSteps: 2 }));
    expect(sentence).toContain("2 of 6");
    expect(sentence).toContain("33");
  });

  it("announces completion distinctly", () => {
    expect(progressAnnouncement(moduleProgress({ stepCount: 6, completedSteps: 6 }))).toMatch(
      /complete/i,
    );
  });

  it("handles a module with no steps without claiming progress", () => {
    expect(progressAnnouncement({ stepCount: 0, completedSteps: 0, percent: 100, status: "complete" })).toMatch(
      /no steps/i,
    );
  });
});

describe("groupByLevel", () => {
  const levels = ["beginner", "intermediate", "advanced"];

  it("keeps ladder order and sorts within a level by orderIndex", () => {
    const groups = groupByLevel(
      [
        { level: "advanced", orderIndex: 1 },
        { level: "beginner", orderIndex: 2 },
        { level: "beginner", orderIndex: 1 },
      ],
      levels,
    );
    expect(groups.map((g) => g.level)).toEqual(["beginner", "advanced"]);
    expect(groups[0].modules.map((m) => m.orderIndex)).toEqual([1, 2]);
  });

  it("drops levels with no modules instead of rendering an empty heading", () => {
    const groups = groupByLevel([{ level: "intermediate", orderIndex: 0 }], levels);
    expect(groups).toHaveLength(1);
    expect(groups[0].level).toBe("intermediate");
  });

  it("does not mutate the input array", () => {
    const input = [
      { level: "beginner", orderIndex: 5 },
      { level: "beginner", orderIndex: 1 },
    ];
    groupByLevel(input, levels);
    expect(input.map((m) => m.orderIndex)).toEqual([5, 1]);
  });
});
