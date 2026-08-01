// =============================================================================
// Unit tests for the pure penalty rules.
// -----------------------------------------------------------------------------
// This stream is almost entirely pure logic, so these tests are the real gate.
// No database, no mocks: if a test here needs either, the rule has leaked.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { PenaltyRuleInput } from "@/lib/contracts/events";
import { appConfig } from "@/lib/config/app.config";
import { QUIZ_FAIL_PERCENT, QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import {
  SEVERITY_DEMERITS,
  effectiveDaysLate,
  evaluateMissedDeadlinePenalty,
  evaluatePenalties,
  evaluatePenaltiesWithGrace,
  evaluateQuizPenalty,
  evaluateSubmissionPenalty,
  lateSeverity,
} from "./rules";

/** The seeded/configured grace window these tests assert against. */
const GRACE = appConfig.schedule.gracePeriodDays;

function input(overrides: Partial<PenaltyRuleInput> = {}): PenaltyRuleInput {
  return {
    studentId: 42,
    daysLate: 0,
    quizBestPercent: null,
    missedEntirely: false,
    ...overrides,
  };
}

describe("configuration assumptions", () => {
  it("uses the seeded 2-day grace window and the frozen quiz thresholds", () => {
    // If any of these drift, the boundary tests below are asserting the wrong
    // boundaries — fail loudly here rather than confusingly there.
    expect(GRACE).toBe(2);
    expect(QUIZ_FAIL_PERCENT).toBe(50);
    expect(QUIZ_PASS_PERCENT).toBe(70);
  });
});

describe("effectiveDaysLate", () => {
  it("returns 0 on time", () => {
    expect(effectiveDaysLate(0, GRACE)).toBe(0);
  });

  it("returns 0 anywhere inside the grace window", () => {
    expect(effectiveDaysLate(1, GRACE)).toBe(0);
    expect(effectiveDaysLate(2, GRACE)).toBe(0);
  });

  it("counts only days beyond the grace window", () => {
    expect(effectiveDaysLate(3, GRACE)).toBe(1);
    expect(effectiveDaysLate(10, GRACE)).toBe(8);
  });

  it("treats an early submission (negative days) as on time", () => {
    expect(effectiveDaysLate(-5, GRACE)).toBe(0);
  });

  it("honours a zero grace window", () => {
    expect(effectiveDaysLate(1, 0)).toBe(1);
  });
});

describe("lateSeverity ladder", () => {
  it("escalates warning -> notice -> serious with days past grace", () => {
    expect(lateSeverity(1)).toBe("warning");
    expect(lateSeverity(3)).toBe("warning");
    expect(lateSeverity(4)).toBe("notice");
    expect(lateSeverity(7)).toBe("notice");
    expect(lateSeverity(8)).toBe("serious");
    expect(lateSeverity(30)).toBe("serious");
  });
});

describe("evaluateSubmissionPenalty (late_submission)", () => {
  it("does not fire when on time", () => {
    expect(evaluateSubmissionPenalty(0, GRACE)).toBeNull();
  });

  it("does not fire inside the grace window (boundary: last graced day)", () => {
    expect(evaluateSubmissionPenalty(1, GRACE)).toBeNull();
    expect(evaluateSubmissionPenalty(GRACE, GRACE)).toBeNull();
  });

  it("fires as a warning one day past the grace window", () => {
    const decision = evaluateSubmissionPenalty(GRACE + 1, GRACE);
    expect(decision).toMatchObject({ type: "late_submission", severity: "warning" });
    expect(decision?.penaltyPoints).toBe(SEVERITY_DEMERITS.warning);
  });

  it("escalates to a notice when well past (4 days beyond grace)", () => {
    const decision = evaluateSubmissionPenalty(GRACE + 4, GRACE);
    expect(decision).toMatchObject({ type: "late_submission", severity: "notice" });
    expect(decision?.penaltyPoints).toBe(SEVERITY_DEMERITS.notice);
  });

  it("escalates to serious more than a week beyond grace", () => {
    const decision = evaluateSubmissionPenalty(GRACE + 8, GRACE);
    expect(decision).toMatchObject({ type: "late_submission", severity: "serious" });
    expect(decision?.penaltyPoints).toBe(SEVERITY_DEMERITS.serious);
  });

  it("explains itself, quoting both raw lateness and the grace window", () => {
    const decision = evaluateSubmissionPenalty(4, 2);
    expect(decision?.description).toContain("2 day(s) late");
    expect(decision?.description).toContain("2-day grace window");
  });
});

describe("evaluateMissedDeadlinePenalty (missed_deadline)", () => {
  it("does not fire while the student is still inside the grace window", () => {
    expect(evaluateMissedDeadlinePenalty(0, GRACE)).toBeNull();
    expect(evaluateMissedDeadlinePenalty(GRACE, GRACE)).toBeNull();
  });

  it("is always serious once the grace window closes, and does not escalate", () => {
    const dayOne = evaluateMissedDeadlinePenalty(GRACE + 1, GRACE);
    const monthLater = evaluateMissedDeadlinePenalty(GRACE + 30, GRACE);
    expect(dayOne).toMatchObject({ type: "missed_deadline", severity: "serious" });
    expect(monthLater?.severity).toBe("serious");
  });
});

describe("evaluateQuizPenalty (quiz_failure / low_score)", () => {
  it("does not fire without an attempt", () => {
    expect(evaluateQuizPenalty(null)).toBeNull();
  });

  it("does not fire at or above the pass threshold", () => {
    expect(evaluateQuizPenalty(QUIZ_PASS_PERCENT)).toBeNull();
    expect(evaluateQuizPenalty(100)).toBeNull();
  });

  it("is a serious quiz_failure below the hard-fail threshold", () => {
    const decision = evaluateQuizPenalty(QUIZ_FAIL_PERCENT - 1);
    expect(decision).toMatchObject({ type: "quiz_failure", severity: "serious" });
    expect(decision?.description).toContain(`${QUIZ_FAIL_PERCENT}%`);
  });

  it("is a low_score between the fail and pass thresholds, never a quiz_failure", () => {
    for (const percent of [50, 55, 60, 69]) {
      const decision = evaluateQuizPenalty(percent);
      expect(decision?.type).toBe("low_score");
    }
  });

  it("grades low_score severity off the scoring bands, not a new literal", () => {
    // 50-59 earns 10 of QUIZ_MAX -> closer to failing -> notice.
    expect(evaluateQuizPenalty(50)?.severity).toBe("notice");
    expect(evaluateQuizPenalty(59)?.severity).toBe("notice");
    // 60-69 earns 15 -> warning.
    expect(evaluateQuizPenalty(60)?.severity).toBe("warning");
    expect(evaluateQuizPenalty(69)?.severity).toBe("warning");
  });

  it("exactly at the hard-fail threshold is a low_score, not a failure", () => {
    // The contract says "< QUIZ_FAIL_PERCENT is a fail", so 50 itself is not.
    expect(evaluateQuizPenalty(QUIZ_FAIL_PERCENT)?.type).toBe("low_score");
  });
});

describe("evaluatePenalties (frozen aggregate entry point)", () => {
  it("returns an empty array for an on-time, perfect submission", () => {
    expect(
      evaluatePenalties(input({ daysLate: 0, quizBestPercent: 100, missedEntirely: false })),
    ).toEqual([]);
  });

  it("returns an empty array inside the grace window with a passing quiz", () => {
    expect(evaluatePenalties(input({ daysLate: GRACE, quizBestPercent: 70 }))).toEqual([]);
  });

  it("issues one warning one day past the grace window", () => {
    const decisions = evaluatePenalties(input({ daysLate: GRACE + 1 }));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ type: "late_submission", severity: "warning" });
  });

  it("NO DOUBLE JEOPARDY: a late submission never also yields missed_deadline", () => {
    for (const daysLate of [GRACE + 1, GRACE + 5, GRACE + 20]) {
      const types = evaluatePenalties(input({ daysLate, missedEntirely: false })).map(
        (d) => d.type,
      );
      expect(types).toContain("late_submission");
      expect(types).not.toContain("missed_deadline");
    }
  });

  it("NO DOUBLE JEOPARDY: a missed deadline never also yields late_submission", () => {
    for (const daysLate of [GRACE + 1, GRACE + 5, GRACE + 20]) {
      const types = evaluatePenalties(input({ daysLate, missedEntirely: true })).map(
        (d) => d.type,
      );
      expect(types).toContain("missed_deadline");
      expect(types).not.toContain("late_submission");
      expect(types).toHaveLength(1);
    }
  });

  it("issues nothing for a missed deadline still inside the grace window", () => {
    expect(evaluatePenalties(input({ daysLate: GRACE, missedEntirely: true }))).toEqual([]);
  });

  it("stacks one deadline penalty with one quiz penalty, deadline first", () => {
    const decisions = evaluatePenalties(
      input({ daysLate: GRACE + 1, quizBestPercent: 30, missedEntirely: true }),
    );
    expect(decisions.map((d) => d.type)).toEqual(["missed_deadline", "quiz_failure"]);
  });

  it("never emits quiz_failure and low_score together", () => {
    for (const percent of [0, 49, 50, 69, 70, 100]) {
      const types = evaluatePenalties(input({ quizBestPercent: percent })).map((d) => d.type);
      expect(types.includes("quiz_failure") && types.includes("low_score")).toBe(false);
    }
  });

  it("derives penaltyPoints from the severity ladder for every decision", () => {
    const decisions = evaluatePenalties(
      input({ daysLate: GRACE + 10, quizBestPercent: 40 }),
    );
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(d.penaltyPoints).toBe(SEVERITY_DEMERITS[d.severity]);
    }
  });
});

describe("evaluatePenaltiesWithGrace (cohort-specific window)", () => {
  it("penalises day one when the cohort has no grace window", () => {
    const decisions = evaluatePenaltiesWithGrace(input({ daysLate: 1 }), 0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe("late_submission");
  });

  it("forgives the whole window when the cohort has a longer one", () => {
    expect(evaluatePenaltiesWithGrace(input({ daysLate: 3 }), 3)).toEqual([]);
  });
});
