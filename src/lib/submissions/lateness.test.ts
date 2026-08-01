// =============================================================================
// Unit tests — grace period, lateness boundaries, and the 20% penalty cap.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// Assertions call `assignmentPoints` and `daysLate` from the frozen scoring
// contract directly, rather than restating expected numbers as literals wherever
// the contract can supply them. That is the point: if the late-penalty rule in
// scoring.ts changes, these tests must keep passing, because they assert that
// this stream DELEGATES rather than that it produces a particular number.
// Boundary day counts are stated as literals, since those are the behaviour under
// test.
// =============================================================================

import { describe, expect, it } from "vitest";

import { assignmentPoints, daysLate, POINTS } from "@/lib/contracts/scoring";

import {
  DAY_MS,
  ceilingForSubmission,
  computeLateness,
  deadlineHasPassed,
  effectiveDueAt,
  normaliseGraceDays,
  pointsForSubmission,
} from "./lateness";

/** Seeded cohort grace window: appConfig.schedule.gracePeriodDays -> cohorts.grace_period_days. */
const GRACE_DAYS = 2;
const DUE_AT = new Date("2026-09-08T00:00:00.000Z");
const EFFECTIVE = new Date("2026-09-10T00:00:00.000Z");
const PER_DAY = 10; // assignments.late_penalty_percent_per_day, seeded to 10

describe("normaliseGraceDays", () => {
  it("treats a null cohort as no grace, never as an extension", () => {
    expect(normaliseGraceDays(null)).toBe(0);
    expect(normaliseGraceDays(undefined)).toBe(0);
  });

  it("clamps a negative value to 0 rather than moving the deadline earlier", () => {
    expect(normaliseGraceDays(-3)).toBe(0);
  });

  it("truncates a fractional value", () => {
    expect(normaliseGraceDays(2.9)).toBe(2);
  });
});

describe("effectiveDueAt", () => {
  it("shifts the deadline by the cohort's grace days", () => {
    expect(effectiveDueAt(DUE_AT, GRACE_DAYS).toISOString()).toBe(EFFECTIVE.toISOString());
  });

  it("is the raw deadline when there is no grace", () => {
    expect(effectiveDueAt(DUE_AT, 0).getTime()).toBe(DUE_AT.getTime());
  });
});

describe("computeLateness — the grace-period boundary", () => {
  const at = (iso: string) =>
    computeLateness({ submittedAt: new Date(iso), dueAt: DUE_AT, gracePeriodDays: GRACE_DAYS });

  it("well before the deadline: on time", () => {
    const r = at("2026-09-06T09:00:00Z");
    expect(r).toMatchObject({ daysLate: 0, isLate: false, withinGrace: false });
  });

  it("exactly on the deadline: on time, not late", () => {
    const r = at("2026-09-08T00:00:00Z");
    expect(r).toMatchObject({ daysLate: 0, isLate: false, withinGrace: false });
  });

  it("one second past the deadline but inside grace: NOT late", () => {
    const r = at("2026-09-08T00:00:01Z");
    expect(r).toMatchObject({ daysLate: 0, isLate: false, withinGrace: true });
  });

  it("one full day past the deadline, inside a 2-day grace: NOT late", () => {
    const r = at("2026-09-09T00:00:00Z");
    expect(r).toMatchObject({ daysLate: 0, isLate: false, withinGrace: true });
  });

  it("exactly at the end of the grace window: still NOT late", () => {
    const r = at("2026-09-10T00:00:00Z");
    expect(r).toMatchObject({ daysLate: 0, isLate: false, withinGrace: true });
    expect(r.effectiveDueAt.toISOString()).toBe(EFFECTIVE.toISOString());
  });

  it("one second past the end of the grace window: 1 day late (daysLate rounds up)", () => {
    const r = at("2026-09-10T00:00:01Z");
    expect(r).toMatchObject({ daysLate: 1, isLate: true, withinGrace: false });
  });

  it("one full day past the grace window: 1 day late", () => {
    const r = at("2026-09-11T00:00:00Z");
    expect(r).toMatchObject({ daysLate: 1, isLate: true });
  });

  it("two days past the grace window: 2 days late", () => {
    expect(at("2026-09-12T00:00:00Z").daysLate).toBe(2);
  });

  it("five days past the grace window: 5 days late (the cap lives in scoring, not here)", () => {
    expect(at("2026-09-15T00:00:00Z").daysLate).toBe(5);
  });

  it("delegates the day count to scoring.daysLate", () => {
    const submittedAt = new Date("2026-09-13T07:15:00Z");
    expect(
      computeLateness({ submittedAt, dueAt: DUE_AT, gracePeriodDays: GRACE_DAYS }).daysLate,
    ).toBe(daysLate(submittedAt, EFFECTIVE));
  });

  it("with no grace period, one second past the deadline is already 1 day late", () => {
    const r = computeLateness({
      submittedAt: new Date("2026-09-08T00:00:01Z"),
      dueAt: DUE_AT,
      gracePeriodDays: 0,
    });
    expect(r).toMatchObject({ daysLate: 1, isLate: true, withinGrace: false });
  });
});

describe("computeLateness — rawDaysLate feeds the penalties module, daysLate feeds scoring", () => {
  // @/lib/penalties/rules applies the grace window ITSELF, via
  // evaluatePenaltiesWithGrace(input, graceDays) -> effectiveDaysLate(...). If this
  // stream handed it the already-graced count, the grace would be subtracted twice
  // and every late-submission penalty would be under-issued. These two numbers
  // must therefore stay distinct.
  const at = (iso: string) =>
    computeLateness({ submittedAt: new Date(iso), dueAt: DUE_AT, gracePeriodDays: GRACE_DAYS });

  it("both are 0 when the work is genuinely on time", () => {
    const r = at("2026-09-07T00:00:00Z");
    expect(r.daysLate).toBe(0);
    expect(r.rawDaysLate).toBe(0);
  });

  it("inside the grace window, raw days are non-zero while graced days are 0", () => {
    const r = at("2026-09-09T00:00:00Z");
    expect(r.daysLate).toBe(0);
    expect(r.rawDaysLate).toBe(1);
  });

  it("past the grace window, raw days exceed graced days by exactly the grace", () => {
    const r = at("2026-09-13T00:00:00Z");
    expect(r.daysLate).toBe(3);
    expect(r.rawDaysLate).toBe(5);
    expect(r.rawDaysLate - r.daysLate).toBe(GRACE_DAYS);
  });

  it("rawDaysLate is scoring.daysLate measured from the unshifted deadline", () => {
    const submittedAt = new Date("2026-09-14T06:00:00Z");
    expect(at("2026-09-14T06:00:00Z").rawDaysLate).toBe(daysLate(submittedAt, DUE_AT));
  });

  it("with no grace period the two counts are identical", () => {
    const r = computeLateness({
      submittedAt: new Date("2026-09-11T00:00:00Z"),
      dueAt: DUE_AT,
      gracePeriodDays: 0,
    });
    expect(r.rawDaysLate).toBe(r.daysLate);
  });
});

describe("pointsForSubmission — the 20% cap and star shortfall", () => {
  const score = (iso: string, stars: number | null) =>
    pointsForSubmission({
      submittedAt: new Date(iso),
      dueAt: DUE_AT,
      gracePeriodDays: GRACE_DAYS,
      latePenaltyPercentPerDay: PER_DAY,
      stars,
    });

  it("on time at 3 stars is the full assignment maximum", () => {
    expect(score("2026-09-07T00:00:00Z", 3).points).toBe(POINTS.ASSIGNMENT_MAX);
  });

  it("inside the grace window at 3 stars is still the full maximum — no penalty", () => {
    expect(score("2026-09-09T12:00:00Z", 3).points).toBe(POINTS.ASSIGNMENT_MAX);
    expect(score("2026-09-09T12:00:00Z", 3).lateness.withinGrace).toBe(true);
  });

  it("1 day late applies exactly one day of penalty", () => {
    const r = score("2026-09-11T00:00:00Z", 3);
    expect(r.lateness.daysLate).toBe(1);
    expect(r.points).toBe(
      assignmentPoints({ daysLate: 1, latePenaltyPercentPerDay: PER_DAY, stars: 3 }),
    );
    // 40 - 10% = 36. Stated once, to pin the contract's arithmetic.
    expect(r.points).toBe(36);
  });

  it("2 days late reaches the 20% cap", () => {
    const r = score("2026-09-12T00:00:00Z", 3);
    expect(r.lateness.daysLate).toBe(2);
    expect(r.points).toBe(32); // 40 - 20%
  });

  it("past the cap, extra days cost nothing more", () => {
    const threeDays = score("2026-09-13T00:00:00Z", 3);
    const tenDays = score("2026-09-20T00:00:00Z", 3);
    expect(threeDays.lateness.daysLate).toBe(3);
    expect(tenDays.lateness.daysLate).toBe(10);
    expect(threeDays.points).toBe(32);
    expect(tenDays.points).toBe(32);
    expect(tenDays.points).toBe(
      assignmentPoints({ daysLate: 10, latePenaltyPercentPerDay: PER_DAY, stars: 3 }),
    );
  });

  it("stacks the star shortfall on top of the capped late penalty", () => {
    const r = score("2026-09-20T00:00:00Z", 1);
    // Capped 20% late penalty (40 -> 32), then two stars short of 3 (-20).
    expect(r.points).toBe(
      assignmentPoints({ daysLate: r.lateness.daysLate, latePenaltyPercentPerDay: PER_DAY, stars: 1 }),
    );
    expect(r.points).toBe(12);
  });

  it("never returns a negative score", () => {
    const r = pointsForSubmission({
      submittedAt: new Date("2026-10-30T00:00:00Z"),
      dueAt: DUE_AT,
      gracePeriodDays: 0,
      latePenaltyPercentPerDay: 100,
      stars: 1,
    });
    expect(r.points).toBeGreaterThanOrEqual(0);
  });

  /**
   * INVERTED 2026-07-31. This test previously read "an unrated submission shows the
   * late-penalty ceiling, not a predicted grade" and expected 32, which was a
   * faithful test of the defect described on `assignmentPoints`: an unrated
   * submission scored as though it had earned full marks. `pointsForSubmission` now
   * awards 0 for an unrated submission, and the CEILING moved to its own function
   * so that a caller who wants it asks for it by name.
   */
  it("awards nothing for an unrated submission, however late", () => {
    expect(score("2026-09-07T00:00:00Z", null).points).toBe(0);
    expect(score("2026-09-12T00:00:00Z", null).points).toBe(0);
  });

  it("ceilingForSubmission still reports what is left to play for", () => {
    const ceiling = (submittedAtIso: string) =>
      ceilingForSubmission({
        submittedAt: new Date(submittedAtIso),
        dueAt: DUE_AT,
        gracePeriodDays: GRACE_DAYS,
        latePenaltyPercentPerDay: PER_DAY,
      });

    // On time, and inside the grace window, nothing has been lost yet.
    expect(ceiling("2026-09-07T00:00:00Z").points).toBe(POINTS.ASSIGNMENT_MAX);
    expect(ceiling("2026-09-09T12:00:00Z").points).toBe(POINTS.ASSIGNMENT_MAX);
    // 2 days past the grace window is the 20% cap: 32 is the most still available.
    expect(ceiling("2026-09-12T00:00:00Z").points).toBe(32);
    // And the ceiling agrees with a 3-star award, which is the definition of full
    // marks — so the two functions cannot drift apart silently.
    expect(ceiling("2026-09-12T00:00:00Z").points).toBe(score("2026-09-12T00:00:00Z", 3).points);
  });
});

describe("deadlineHasPassed", () => {
  it("is false inside the grace window, so no missed-deadline penalty is issued early", () => {
    expect(
      deadlineHasPassed({
        now: new Date("2026-09-09T23:59:59Z"),
        dueAt: DUE_AT,
        gracePeriodDays: GRACE_DAYS,
      }),
    ).toBe(false);
  });

  it("is false exactly at the end of the grace window", () => {
    expect(deadlineHasPassed({ now: EFFECTIVE, dueAt: DUE_AT, gracePeriodDays: GRACE_DAYS })).toBe(
      false,
    );
  });

  it("is true one millisecond after the grace window closes", () => {
    expect(
      deadlineHasPassed({
        now: new Date(EFFECTIVE.getTime() + 1),
        dueAt: DUE_AT,
        gracePeriodDays: GRACE_DAYS,
      }),
    ).toBe(true);
  });
});

describe("DAY_MS", () => {
  it("is one day in milliseconds (metric units per house rules)", () => {
    expect(DAY_MS).toBe(86_400_000);
  });
});
