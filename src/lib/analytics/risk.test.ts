// =============================================================================
// RISK SCORING TESTS — no database import, so these run in milliseconds.
// -----------------------------------------------------------------------------
// The assertions that matter are the two inversions an at-risk list can suffer:
//   * a student who has NEVER done anything ranking as the safest (null treated
//     as "no signal"), and
//   * ungraded work alone escalating a student who is otherwise fine, which would
//     turn the alert list into a marking backlog report.
// =============================================================================

import { describe, expect, it } from "vitest";

import { assessRisk, bandFor, daysSilentWeight, rankRisk, type RiskSignals } from "./risk";

function signals(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    studentId: 1,
    name: "Test Student",
    penaltyCount: 0,
    penaltyPoints: 0,
    weeksWithoutQuizAttempt: 0,
    weekCount: 4,
    ungradedSubmissionCount: 0,
    lateSubmissionCount: 0,
    daysSinceLastActivity: 0,
    ...overrides,
  };
}

describe("daysSilentWeight", () => {
  it("scores a recently active student zero", () => {
    expect(daysSilentWeight(0)).toBe(0);
    expect(daysSilentWeight(3)).toBe(0);
  });

  it("rises monotonically and saturates at 21 days", () => {
    const series = [4, 7, 10, 14, 21, 40].map(daysSilentWeight);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    }
    expect(daysSilentWeight(21)).toBe(40);
    expect(daysSilentWeight(40)).toBe(40);
  });

  it("treats 'never active' as the WORST case, not a missing one", () => {
    // The inversion this test exists to prevent: null scoring 0 would rank a
    // student who has done nothing all term as the safest in the cohort.
    expect(daysSilentWeight(null)).toBe(40);
    expect(daysSilentWeight(null)).toBeGreaterThan(daysSilentWeight(10));
  });
});

describe("assessRisk", () => {
  it("gives a fully engaged student a score of 0 and band low", () => {
    const a = assessRisk(signals());
    expect(a.score).toBe(0);
    expect(a.band).toBe("low");
    expect(a.reasons).toEqual([]);
  });

  it("never exceeds 100 for a student failing on every signal", () => {
    const a = assessRisk(
      signals({
        daysSinceLastActivity: null,
        weeksWithoutQuizAttempt: 4,
        penaltyCount: 9,
        penaltyPoints: 50,
        ungradedSubmissionCount: 7,
      }),
    );
    expect(a.score).toBe(100);
    expect(a.band).toBe("high");
    expect(a.reasons.length).toBe(4);
  });

  it("does not escalate on ungraded work alone", () => {
    // 2+ ungraded submissions is the component's maximum (10) and must stay well
    // below the 25 "watch" line: an instructor's marking backlog is not the
    // student's risk.
    const a = assessRisk(signals({ ungradedSubmissionCount: 5 }));
    expect(a.score).toBe(10);
    expect(a.band).toBe("low");
  });

  it("escalates silence plus missed quizzes to high", () => {
    const a = assessRisk(signals({ daysSinceLastActivity: 21, weeksWithoutQuizAttempt: 2 }));
    expect(a.score).toBe(55); // 40 silence + 15 (2/4 * 30)
    expect(a.band).toBe("high");
  });

  it("saturates the penalty component at the 3 the existing list uses", () => {
    const three = assessRisk(signals({ penaltyCount: 3 }));
    const ten = assessRisk(signals({ penaltyCount: 10 }));
    expect(three.score).toBe(20);
    expect(ten.score).toBe(20);
  });

  it("makes no claim from a zero week count", () => {
    // No weeks means no denominator, so no missed-quiz claim — the same rule
    // rates.ts states for every rate on the analytics surface.
    const a = assessRisk(signals({ weekCount: 0, weeksWithoutQuizAttempt: 0 }));
    expect(a.score).toBe(0);
    expect(a.reasons).toEqual([]);
  });

  it("clamps a weeksWithoutQuizAttempt larger than weekCount", () => {
    // Defensive: this cannot happen (SQL uses GREATEST(week_count - attempted, 0))
    // but an unclamped share would push the component past its 30-point weight.
    const a = assessRisk(signals({ weekCount: 2, weeksWithoutQuizAttempt: 9 }));
    expect(a.score).toBe(30);
  });

  it("names every signal that fired, and none that did not", () => {
    const a = assessRisk(signals({ penaltyCount: 1, penaltyPoints: 5 }));
    expect(a.reasons).toEqual(["1 unresolved penalty (5 points)"]);
  });
});

describe("bandFor", () => {
  it("puts the high line above any single component's maximum", () => {
    // Nothing except total silence (40) plus a second signal can reach 50, so a
    // student is only escalated on corroborating evidence.
    expect(bandFor(49)).toBe("watch");
    expect(bandFor(50)).toBe("high");
    expect(bandFor(24)).toBe("low");
    expect(bandFor(25)).toBe("watch");
  });
});

describe("rankRisk", () => {
  it("drops the low band, orders worst first and caps the list", () => {
    const cohort: RiskSignals[] = [
      signals({ studentId: 1 }), // low  -> dropped
      signals({ studentId: 2, daysSinceLastActivity: 10 }), // 16 -> low, dropped
      signals({ studentId: 3, daysSinceLastActivity: 21 }), // 40 -> watch
      signals({ studentId: 4, daysSinceLastActivity: null, penaltyCount: 3 }), // 60 high
    ];
    const ranked = rankRisk(cohort, 10);
    expect(ranked.map((r) => r.studentId)).toEqual([4, 3]);
    expect(ranked[0]?.band).toBe("high");

    expect(rankRisk(cohort, 1).map((r) => r.studentId)).toEqual([4]);
  });

  it("breaks ties on studentId so the order is stable between renders", () => {
    const tied = [7, 3, 5].map((id) => signals({ studentId: id, daysSinceLastActivity: null }));
    expect(rankRisk(tied).map((r) => r.studentId)).toEqual([3, 5, 7]);
  });

  it("returns an empty list for an empty cohort rather than throwing", () => {
    expect(rankRisk([])).toEqual([]);
  });
});
