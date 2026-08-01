// =============================================================================
// ELIGIBILITY TESTS — the rule that decides whether a credential is earned.
// -----------------------------------------------------------------------------
// This is the highest-consequence pure function in the stream: a false positive
// here issues a certificate to a student who has not finished the course, and a
// certificate is not something you can quietly take back once it is on a CV.
//
// Every case is built from the REAL read model — `buildWeekProgress` over the
// progress stream's own `WeekAggregateRow` fixtures, then `buildDashboard` — and
// not from a hand-written `DashboardModel`. A hand-written model would let this
// file agree with itself while disagreeing with what the dashboard actually
// produces, which is the exact failure the cross-stream contract tests exist for.
//
// `ALL_OPEN_SECTIONS` is injected in most cases for the reason
// tests/support/curriculum-sections.ts gives: the SHIPPED config opens only the
// HTML subject, so without injection every assertion here would pass because
// weeks 2-4 are closed rather than because the rule works.
// =============================================================================

import { describe, expect, it } from "vitest";

import { buildWeekProgress } from "@/lib/progress/aggregate";
import { buildDashboard } from "@/lib/progress/dashboard";
import { completedWeekRow, emptyWeekRow, gradedAssignment } from "@/lib/progress/fixtures";
import type { WeekAggregateRow } from "@/lib/progress/query";
import { ALL_OPEN_SECTIONS, HTML_ONLY_SECTIONS } from "../../../tests/support/curriculum-sections";

import { completionDateFor, evaluateEligibility } from "./eligibility";

const NOW = new Date("2026-08-01T12:00:00.000Z");

/** Rows -> the same DashboardModel the real page renders. */
function model(rows: WeekAggregateRow[], sections = ALL_OPEN_SECTIONS) {
  return buildDashboard(7, buildWeekProgress(rows, sections), NOW);
}

describe("evaluateEligibility", () => {
  it("certifies a student who has finished every week", () => {
    const verdict = evaluateEligibility(
      model([1, 2, 3, 4].map((n) => completedWeekRow(n))),
      NOW,
    );
    expect(verdict.eligible).toBe(true);
    expect(verdict.reason).toBeNull();
    expect(verdict.outstandingWeekNumbers).toEqual([]);
    expect(verdict.weeksCompleted).toBe(4);
    expect(verdict.weeksTotal).toBe(4);
  });

  it("refuses when one week of four is unfinished, and names it", () => {
    const rows = [completedWeekRow(1), completedWeekRow(2), completedWeekRow(3), emptyWeekRow(4)];
    const verdict = evaluateEligibility(model(rows), NOW);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("weeks_incomplete");
    expect(verdict.outstandingWeekNumbers).toEqual([4]);
    expect(verdict.completedAt).toBeNull();
  });

  it("refuses a brand-new student with nothing recorded", () => {
    // The state every student is in for most of a cohort. It must be a clean
    // "not yet", never a crash and never an accidental issue.
    const verdict = evaluateEligibility(model([1, 2, 3, 4].map((n) => emptyWeekRow(n))), NOW);
    expect(verdict.eligible).toBe(false);
    expect(verdict.outstandingWeekNumbers).toEqual([1, 2, 3, 4]);
    expect(verdict.weeksCompleted).toBe(0);
  });

  it("refuses a course with no weeks at all, with its own reason", () => {
    // Without the explicit `weeksTotal === 0` branch, "no outstanding weeks" is
    // vacuously true here and a fresh deployment with no content would certify
    // every registered student for finishing nothing.
    const verdict = evaluateEligibility(model([]), NOW);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("no_content");
    expect(verdict.weeksTotal).toBe(0);
  });

  it("refuses when a completed week's SUBJECT has been withdrawn", () => {
    // The case `isWeekComplete` alone gets wrong. All four weeks hold complete
    // work, but the shipped section policy opens only week 1, so weeks 2-4 are
    // locked — and "all 4 weeks of this course" is not a claim we may print about
    // a cohort that has had three subjects withheld.
    const rows = [1, 2, 3, 4].map((n) => completedWeekRow(n));
    const verdict = evaluateEligibility(model(rows, HTML_ONLY_SECTIONS), NOW);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("weeks_incomplete");
    expect(verdict.outstandingWeekNumbers).toEqual([2, 3, 4]);
    // And the count it would have printed agrees with the rule that refused it.
    expect(verdict.weeksCompleted).toBe(1);
  });

  it("refuses a week that is complete but LOCKED by a failed previous quiz", () => {
    // Week 1 passed at 90%, week 2's own work done but week 3 was never
    // attempted, so week 4 is locked by the progression chain. Belt and braces
    // with the case above: one closes a subject, this one fails a gate.
    const rows = [
      completedWeekRow(1, 90),
      completedWeekRow(2, 30), // done, but 30% does not unlock week 3
      completedWeekRow(3),
      completedWeekRow(4),
    ];
    const verdict = evaluateEligibility(model(rows), NOW);
    expect(verdict.eligible).toBe(false);
    expect(verdict.outstandingWeekNumbers).toEqual([3, 4]);
  });

  it("does not certify a week that has no work authored", () => {
    // `isWeekComplete` requires `hasWork`. A half-authored course must not mint
    // certificates for weeks that ask nothing of the student.
    const rows = [
      completedWeekRow(1),
      emptyWeekRow(2, { lectureTotal: 0, quizCount: 0, assignmentCount: 0, assignments: [] }),
    ];
    const verdict = evaluateEligibility(model(rows), NOW);
    expect(verdict.eligible).toBe(false);
    expect(verdict.outstandingWeekNumbers).toEqual([2]);
  });

  it("does not require the work to be GRADED", () => {
    // `assignmentCompleted` means delivered (aggregate.ts:63), and since
    // 2026-07-31 an ungraded submission scores 0 points. So a student who has
    // handed everything in is eligible while their score is still low — which is
    // the whole reason eligibility is not a points threshold.
    // `stars: null` is what "submitted, nobody has marked it" looks like in the
    // aggregate — and since 2026-07-31 that scores 0 rather than the full 40.
    const rows = [1, 2, 3, 4].map((n) =>
      completedWeekRow(n, 90, {
        gradedAssignmentCount: 0,
        assignmentCompletedFlag: true,
        assignments: [gradedAssignment(n, null, { status: "submitted" })],
      }),
    );
    const verdict = evaluateEligibility(model(rows), NOW);
    expect(verdict.eligible).toBe(true);
    // Recorded on the certificate as evidence, and deliberately not a gate.
    expect(verdict.scorePoints).toBeLessThan(verdict.maxScorePoints);
  });

  it("reports points against the scoring contract's week maximum", () => {
    const verdict = evaluateEligibility(model([1, 2].map((n) => completedWeekRow(n))), NOW);
    // POINTS.WEEK_MAX is 70; two weeks is 140. Asserted through the model rather
    // than by importing the constant, so a divergence between this stream's
    // snapshot and the dashboard's total shows up here.
    expect(verdict.maxScorePoints).toBe(140);
    expect(verdict.scorePoints).toBeGreaterThan(0);
  });

  it("stamps the completion date only when eligible", () => {
    const eligible = evaluateEligibility(model([completedWeekRow(1)]), NOW);
    expect(eligible.completedAt).toEqual(NOW);
    const notEligible = evaluateEligibility(model([emptyWeekRow(1)]), NOW);
    expect(notEligible.completedAt).toBeNull();
  });
});

describe("completionDateFor", () => {
  it("is the clock it is handed, so callers can pin it", () => {
    // The approximation is documented in the function; this test is here so the
    // approximation cannot silently become `new Date()` inside the function and
    // make every certificate's date untestable.
    expect(completionDateFor(NOW)).toEqual(NOW);
  });
});
