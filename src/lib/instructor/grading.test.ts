// =============================================================================
// GRADE PAYLOAD + SCORE DERIVATION TESTS — instructor-admin stream.
// -----------------------------------------------------------------------------
// Asserts the pure half of grading.ts against the frozen `gradeSubmissionSchema`
// and `assignmentPoints`. `applyGrade` is not covered here — it writes to the
// database, which tests/setup.ts forbids in unit tests; it is covered by the
// Playwright spec in tests/e2e/instructor-admin.
// =============================================================================

import { describe, expect, it } from "vitest";

import { assignmentPoints, POINTS } from "@/lib/contracts/scoring";
// Imported from ./grade-payload, not ./grading: grading.ts imports @/db, and
// tests/setup.ts forbids a unit test from pulling in the database client.
import { deriveScore, parseGradePayload } from "./grade-payload";

const VALID = { submissionId: 1, stars: 4, feedback: "Good work.", score: 30 };

describe("parseGradePayload — stars", () => {
  it("accepts 1 through 5", () => {
    for (const stars of [1, 2, 3, 4, 5]) {
      const result = parseGradePayload({ submissionId: 1, stars });
      expect(result.ok, `stars=${stars}`).toBe(true);
    }
  });

  it("REJECTS 0 stars", () => {
    // 0 is not "unrated" in a grade payload — it is an out-of-range rating that
    // would take assignmentPoints to 40 - 3*10 = 10 points.
    const result = parseGradePayload({ submissionId: 1, stars: 0 });
    expect(result.ok).toBe(false);
  });

  it("REJECTS 6 stars", () => {
    const result = parseGradePayload({ submissionId: 1, stars: 6 });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing rating — stars is required", () => {
    expect(parseGradePayload({ submissionId: 1 }).ok).toBe(false);
  });

  it("rejects a fractional or non-numeric rating", () => {
    expect(parseGradePayload({ submissionId: 1, stars: 3.5 }).ok).toBe(false);
    expect(parseGradePayload({ submissionId: 1, stars: "4" }).ok).toBe(false);
  });
});

describe("parseGradePayload — feedback", () => {
  it("accepts feedback at exactly 4000 characters", () => {
    const result = parseGradePayload({
      submissionId: 1,
      stars: 3,
      feedback: "x".repeat(4000),
    });
    expect(result.ok).toBe(true);
  });

  it("REJECTS feedback over 4000 characters", () => {
    const result = parseGradePayload({
      submissionId: 1,
      stars: 3,
      feedback: "x".repeat(4001),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.feedback?.length).toBeGreaterThan(0);
  });

  it("treats feedback as optional", () => {
    expect(parseGradePayload({ submissionId: 1, stars: 3 }).ok).toBe(true);
  });
});

describe("parseGradePayload — score", () => {
  it("accepts 0 and 40", () => {
    expect(parseGradePayload({ submissionId: 1, stars: 3, score: 0 }).ok).toBe(true);
    expect(
      parseGradePayload({ submissionId: 1, stars: 3, score: POINTS.ASSIGNMENT_MAX }).ok,
    ).toBe(true);
  });

  it("rejects a score above the 40-point assignment maximum, and a negative one", () => {
    expect(parseGradePayload({ submissionId: 1, stars: 3, score: 41 }).ok).toBe(false);
    expect(parseGradePayload({ submissionId: 1, stars: 3, score: -1 }).ok).toBe(false);
  });
});

describe("parseGradePayload — submissionId", () => {
  it("rejects a missing, zero or negative id", () => {
    expect(parseGradePayload({ stars: 3 }).ok).toBe(false);
    expect(parseGradePayload({ submissionId: 0, stars: 3 }).ok).toBe(false);
    expect(parseGradePayload({ submissionId: -5, stars: 3 }).ok).toBe(false);
  });

  it("rejects a non-object payload without throwing", () => {
    expect(parseGradePayload(null).ok).toBe(false);
    expect(parseGradePayload("stars=4").ok).toBe(false);
    expect(parseGradePayload(undefined).ok).toBe(false);
  });

  it("returns a human-readable error for the UI", () => {
    const result = parseGradePayload({ submissionId: 1, stars: 9 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("accepts a fully-populated valid payload", () => {
    const result = parseGradePayload(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stars).toBe(4);
  });
});

describe("deriveScore — delegates to the scoring contract", () => {
  const onTime = {
    submittedAt: new Date("2026-09-08T00:00:00Z"),
    dueAt: new Date("2026-09-08T00:00:00Z"),
    latePenaltyPercentPerDay: 10,
  };

  it("awards the assignmentPoints figure for each star rating", () => {
    for (const stars of [1, 2, 3, 4, 5]) {
      const derived = deriveScore({ ...onTime, stars });
      expect(derived.score).toBe(
        assignmentPoints({ daysLate: 0, latePenaltyPercentPerDay: 10, stars }),
      );
      expect(derived.overridden).toBe(false);
    }
  });

  it("gives full marks at 3 stars and deducts 10 per star below 3", () => {
    expect(deriveScore({ ...onTime, stars: 3 }).score).toBe(POINTS.ASSIGNMENT_MAX);
    expect(deriveScore({ ...onTime, stars: 2 }).score).toBe(POINTS.ASSIGNMENT_MAX - 10);
    expect(deriveScore({ ...onTime, stars: 1 }).score).toBe(POINTS.ASSIGNMENT_MAX - 20);
  });

  it("does not raise the score above the maximum for 4 or 5 stars", () => {
    expect(deriveScore({ ...onTime, stars: 4 }).score).toBe(POINTS.ASSIGNMENT_MAX);
    expect(deriveScore({ ...onTime, stars: 5 }).score).toBe(POINTS.ASSIGNMENT_MAX);
  });

  it("applies the late penalty, capped at 20% by the contract", () => {
    const twoDaysLate = deriveScore({
      submittedAt: new Date("2026-09-10T00:00:00Z"),
      dueAt: new Date("2026-09-08T00:00:00Z"),
      latePenaltyPercentPerDay: 10,
      stars: 3,
    });
    expect(twoDaysLate.daysLate).toBe(2);
    expect(twoDaysLate.score).toBe(32); // 40 - 20%

    const tenDaysLate = deriveScore({
      submittedAt: new Date("2026-09-18T00:00:00Z"),
      dueAt: new Date("2026-09-08T00:00:00Z"),
      latePenaltyPercentPerDay: 10,
      stars: 3,
    });
    expect(tenDaysLate.score).toBe(32); // cap holds at 20%
  });

  it("lets an explicit instructor score override the derived one, and records both", () => {
    const derived = deriveScore({ ...onTime, stars: 1, explicitScore: 35 });
    expect(derived.score).toBe(35);
    expect(derived.derivedScore).toBe(POINTS.ASSIGNMENT_MAX - 20);
    expect(derived.overridden).toBe(true);
  });

  it("honours the cohort grace window, so a submission inside it is not penalised", () => {
    // Two days past the deadline with a two-day grace window is NOT late for
    // scoring purposes. Ignoring grace here would show the instructor a 32 in the
    // preview and store a 40, or vice versa.
    const insideGrace = deriveScore({
      submittedAt: new Date("2026-09-10T00:00:00Z"),
      dueAt: new Date("2026-09-08T00:00:00Z"),
      gracePeriodDays: 2,
      latePenaltyPercentPerDay: 10,
      stars: 3,
    });
    expect(insideGrace.daysLate).toBe(0);
    expect(insideGrace.withinGrace).toBe(true);
    expect(insideGrace.score).toBe(POINTS.ASSIGNMENT_MAX);
  });

  it("still penalises time beyond the grace window", () => {
    const pastGrace = deriveScore({
      submittedAt: new Date("2026-09-11T00:00:00Z"),
      dueAt: new Date("2026-09-08T00:00:00Z"),
      gracePeriodDays: 2,
      latePenaltyPercentPerDay: 10,
      stars: 3,
    });
    expect(pastGrace.daysLate).toBe(1);
    expect(pastGrace.withinGrace).toBe(false);
    expect(pastGrace.score).toBe(36); // 40 - 10%
  });

  it("treats a missing grace window as zero, not as undefined leaking into maths", () => {
    const noGrace = deriveScore({ ...onTime, stars: 3 });
    expect(noGrace.daysLate).toBe(0);
    expect(Number.isFinite(noGrace.score)).toBe(true);
  });

  it("treats an explicit score of 0 as an override, not as absent", () => {
    // A falsy-check bug here would silently award the star-derived score to a
    // submission the instructor deliberately zeroed.
    const derived = deriveScore({ ...onTime, stars: 5, explicitScore: 0 });
    expect(derived.score).toBe(0);
    expect(derived.overridden).toBe(true);
  });
});
