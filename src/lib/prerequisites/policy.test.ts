// =============================================================================
// UNIT TESTS for the prerequisite policy.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// THE NEGATIVE PATHS ARE THE POINT, the same stance src/lib/courses/policy.test.ts
// takes. A happy-path-only suite would pass identically against an
// `evaluatePrerequisites` that returned `{ satisfied: true }` unconditionally,
// which is exactly the regression worth catching — a gate that always allows is
// indistinguishable from no gate at all until an audit.
//
// Four properties are asserted here that nothing else in the tree can prove:
//   * an unmet prerequisite refuses (and a MISSING fact refuses, not passes);
//   * an override admits WITHOUT erasing the record of what it waived, which is
//     what makes it visible rather than silent (requirement 4);
//   * every refusal NAMES the course and the number (requirement 5);
//   * `nothing_unmet` refuses a no-op override, so no false audit record exists.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

// `policy.ts` imports `roleSatisfies` from `@/lib/guard`, which imports `@/lib/auth`
// and therefore `next-auth` + `pg`. Mocked for the same reason
// src/lib/courses/policy.test.ts:25 mocks it: importing it for real opens a
// connection pool, which tests/setup.ts forbids, and `next-auth/lib/env.js` does not
// resolve outside the Next build. `roleSatisfies` itself is pure and is NOT mocked —
// these tests exercise the real frozen ROLES_SATISFYING table.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import {
  canGrantOverride,
  canManagePrerequisites,
  describeUnmet,
  evaluatePrerequisites,
  normaliseMinScore,
  normaliseOverrideReason,
  OVERRIDE_REASON_MAX,
  PREREQUISITE_ADMIN_AUTH,
  summariseUnmet,
  validateNewPrerequisite,
  type PrerequisiteFact,
  type PrerequisiteRequirement,
} from "./policy";

/** Course 1 is the active/open course; 2 and 3 are extra courses. */
const FUNDAMENTALS = 1;
const ADVANCED = 2;

const NEEDS_FUNDAMENTALS: PrerequisiteRequirement = {
  prerequisiteCourseId: FUNDAMENTALS,
  prerequisiteTitle: "Web Fundamentals",
  minScore: null,
};

const NEEDS_FUNDAMENTALS_AT_70: PrerequisiteRequirement = {
  ...NEEDS_FUNDAMENTALS,
  minScore: 70,
};

function fact(overrides: Partial<PrerequisiteFact> = {}): PrerequisiteFact {
  return { courseId: FUNDAMENTALS, hasAccess: true, scorePercent: null, ...overrides };
}

const OVERRIDE = {
  reason: "Completed the equivalent course elsewhere; transcript on file.",
  grantedByName: "Admin User",
  grantedAt: "2026-07-31T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
describe("evaluatePrerequisites — a course with no rules changes nothing", () => {
  it("is satisfied and unconstrained when there are no requirements", () => {
    // THE BACKWARDS-COMPATIBILITY ASSERTION. Until an admin authors a rule every
    // course is in this state, which is why installing feature 8 revokes nobody.
    expect(evaluatePrerequisites({ requirements: [], facts: [], override: null })).toEqual({
      satisfied: true,
      unmet: [],
      override: null,
      overridden: false,
      unconstrained: true,
    });
  });

  it("ignores a stale override when there is nothing to override", () => {
    // A student admitted on merit must not be shown as admitted by exception, and
    // the admin console must not list a waiver for a rule that no longer exists.
    const result = evaluatePrerequisites({
      requirements: [],
      facts: [],
      override: OVERRIDE,
    });
    expect(result.override).toBeNull();
    expect(result.overridden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("evaluatePrerequisites — access-only requirements", () => {
  it("is satisfied when the student has access to the prerequisite", () => {
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS],
      facts: [fact({ hasAccess: true })],
      override: null,
    });
    expect(result.satisfied).toBe(true);
    expect(result.unmet).toEqual([]);
    expect(result.unconstrained).toBe(false);
  });

  it("REFUSES when the student has no access to the prerequisite", () => {
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS],
      facts: [fact({ hasAccess: false })],
      override: null,
    });
    expect(result.satisfied).toBe(false);
    expect(result.unmet).toEqual([
      {
        courseId: FUNDAMENTALS,
        title: "Web Fundamentals",
        reason: "no_access",
        minScore: null,
        actualPercent: null,
      },
    ]);
  });

  it("REFUSES when the fact is missing entirely — fail closed", () => {
    // The most important assertion in the file after the override ones. A caller
    // that forgot to fetch a fact, or a course row deleted between two reads, must
    // not read as "prerequisite satisfied": that is a student admitted to a course
    // by a bug in the calling page.
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS],
      facts: [],
      override: null,
    });
    expect(result.satisfied).toBe(false);
    expect(result.unmet[0].reason).toBe("no_access");
  });

  it("reports EVERY unmet requirement, not just the first", () => {
    // A student told about one blocker at a time satisfies it and is refused again,
    // which is the same "locked with no useful reason" experience one step later.
    const result = evaluatePrerequisites({
      requirements: [
        NEEDS_FUNDAMENTALS,
        { prerequisiteCourseId: 3, prerequisiteTitle: "Data Basics", minScore: null },
      ],
      facts: [fact({ hasAccess: false }), fact({ courseId: 3, hasAccess: false })],
      override: null,
    });
    expect(result.unmet).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe("evaluatePrerequisites — minimum-score requirements", () => {
  it("is satisfied at exactly the threshold", () => {
    // At-or-above, matching `shouldUnlockNextWeek`'s treatment of QUIZ_PASS_PERCENT.
    // An off-by-one here would refuse a student who scored precisely what was asked.
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS_AT_70],
      facts: [fact({ hasAccess: true, scorePercent: 70 })],
      override: null,
    });
    expect(result.satisfied).toBe(true);
  });

  it("REFUSES below the threshold and reports both numbers", () => {
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS_AT_70],
      facts: [fact({ hasAccess: true, scorePercent: 62.5 })],
      override: null,
    });
    expect(result.satisfied).toBe(false);
    expect(result.unmet[0]).toEqual({
      courseId: FUNDAMENTALS,
      title: "Web Fundamentals",
      reason: "score_below",
      minScore: 70,
      actualPercent: 62.5,
    });
  });

  it("reports score_unknown — NOT a 0% failure — when no score can be computed", () => {
    // Null is not zero. Only the active course has a progress aggregate today
    // (src/lib/progress/query.ts:148), so a threshold on any other course is a
    // MISCONFIGURATION. Reporting it as a 0% score would blame the student for an
    // admin's rule they cannot possibly satisfy.
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS_AT_70],
      facts: [fact({ hasAccess: true, scorePercent: null })],
      override: null,
    });
    expect(result.satisfied).toBe(false);
    expect(result.unmet[0].reason).toBe("score_unknown");
    expect(result.unmet[0].actualPercent).toBeNull();
  });

  it("reports no_access rather than score_below when both are true", () => {
    // Ordering, deliberately: "you are not in that course" is the actionable
    // blocker, and a score for a course you cannot open is not a fact worth
    // leading with.
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS_AT_70],
      facts: [fact({ hasAccess: false, scorePercent: 10 })],
      override: null,
    });
    expect(result.unmet[0].reason).toBe("no_access");
  });

  it("a minScore of 0 is a real requirement that access alone satisfies", () => {
    // Guards against `if (minScore)` instead of `if (minScore == null)`, which
    // would treat 0 as "no threshold" — harmless here, but the same bug at the
    // normalisation boundary turns a blank field into a 0 threshold.
    const result = evaluatePrerequisites({
      requirements: [{ ...NEEDS_FUNDAMENTALS, minScore: 0 }],
      facts: [fact({ hasAccess: true, scorePercent: 0 })],
      override: null,
    });
    expect(result.satisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("evaluatePrerequisites — the admin override (REQUIREMENT 4)", () => {
  it("admits the student despite an unmet prerequisite", () => {
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS],
      facts: [fact({ hasAccess: false })],
      override: OVERRIDE,
    });
    expect(result.satisfied).toBe(true);
    expect(result.overridden).toBe(true);
  });

  it("KEEPS the unmet list, so the exception is visible rather than silent", () => {
    // The assertion that encodes requirement 4. An override that emptied `unmet`
    // would leave the admin console unable to show what was waved through and the
    // student unable to see that they are in on an exception.
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS_AT_70],
      facts: [fact({ hasAccess: true, scorePercent: 12 })],
      override: OVERRIDE,
    });
    expect(result.satisfied).toBe(true);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].reason).toBe("score_below");
    expect(result.override).toEqual(OVERRIDE);
  });

  it("does not report `overridden` for a student who met the rules anyway", () => {
    const result = evaluatePrerequisites({
      requirements: [NEEDS_FUNDAMENTALS],
      facts: [fact({ hasAccess: true })],
      override: OVERRIDE,
    });
    expect(result.overridden).toBe(false);
    expect(result.override).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("describeUnmet — REQUIREMENT 5: the student is told WHY", () => {
  it("names the course when access is what is missing", () => {
    const text = describeUnmet({
      courseId: FUNDAMENTALS,
      title: "Web Fundamentals",
      reason: "no_access",
      minScore: null,
      actualPercent: null,
    });
    // The whole feature is that this sentence is not the word "Locked".
    expect(text).toContain("Web Fundamentals");
    expect(text.toLowerCase()).not.toBe("locked");
  });

  it("names the course AND the threshold when both matter", () => {
    const text = describeUnmet({
      courseId: FUNDAMENTALS,
      title: "Web Fundamentals",
      reason: "no_access",
      minScore: 70,
      actualPercent: null,
    });
    expect(text).toContain("Web Fundamentals");
    expect(text).toContain("70%");
  });

  it("gives both the actual and the required score on a shortfall", () => {
    const text = describeUnmet({
      courseId: FUNDAMENTALS,
      title: "Web Fundamentals",
      reason: "score_below",
      minScore: 70,
      actualPercent: 62.55,
    });
    expect(text).toContain("70%");
    // Rounded to one decimal, matching `overallPercent` in progress/score.ts so the
    // number here is the number on the student's own dashboard.
    expect(text).toContain("62.6%");
  });

  it("tells the student to ask an admin when the rule cannot be met at all", () => {
    const text = describeUnmet({
      courseId: FUNDAMENTALS,
      title: "Web Fundamentals",
      reason: "score_unknown",
      minScore: 70,
      actualPercent: null,
    });
    // A dead end must at least name the exit. Blaming the student for an
    // unsatisfiable rule is the failure this branch exists to avoid.
    expect(text).toContain("admin");
  });
});

// ---------------------------------------------------------------------------
describe("summariseUnmet — the audit snapshot", () => {
  it("says so explicitly when nothing was unmet", () => {
    expect(summariseUnmet([])).toContain("nothing unmet");
  });

  it("names every course and reason", () => {
    const text = summariseUnmet([
      {
        courseId: 1,
        title: "Web Fundamentals",
        reason: "score_below",
        minScore: 70,
        actualPercent: 10,
      },
      { courseId: 3, title: "Data Basics", reason: "no_access", minScore: null, actualPercent: null },
    ]);
    expect(text).toContain("Web Fundamentals");
    expect(text).toContain("min 70%");
    expect(text).toContain("Data Basics");
  });
});

// ---------------------------------------------------------------------------
describe("validateNewPrerequisite", () => {
  const base = {
    courseId: ADVANCED,
    prerequisiteCourseId: FUNDAMENTALS,
    minScore: null as unknown,
    courseExists: true,
    prerequisiteExists: true,
    existingEdges: [] as Array<{ courseId: number; prerequisiteCourseId: number }>,
  };

  it("accepts a first rule and normalises a blank score to null", () => {
    expect(validateNewPrerequisite({ ...base, minScore: "" })).toEqual({
      ok: true,
      edge: { courseId: ADVANCED, prerequisiteCourseId: FUNDAMENTALS },
      minScore: null,
    });
  });

  it("refuses ids that are not positive integers", () => {
    expect(validateNewPrerequisite({ ...base, courseId: 0 })).toEqual({
      ok: false,
      refusal: "invalid_course",
    });
    expect(validateNewPrerequisite({ ...base, prerequisiteCourseId: -1 })).toEqual({
      ok: false,
      refusal: "invalid_course",
    });
  });

  it("refuses a course that does not exist, even when the id parses", () => {
    // Existence is PROVEN by the caller reading the row. An id that parses is not
    // an id that exists, and a foreign-key error is not an admin-readable refusal.
    expect(validateNewPrerequisite({ ...base, prerequisiteExists: false })).toEqual({
      ok: false,
      refusal: "invalid_course",
    });
  });

  it("refuses a self-reference before it reaches the database CHECK", () => {
    expect(
      validateNewPrerequisite({ ...base, prerequisiteCourseId: ADVANCED }),
    ).toEqual({ ok: false, refusal: "self_reference" });
  });

  it("refuses a duplicate rather than storing a second edge for the same pair", () => {
    // Two rows for one pair means two thresholds, one of which is invisible and
    // whichever wins depends on row order.
    expect(
      validateNewPrerequisite({
        ...base,
        existingEdges: [{ courseId: ADVANCED, prerequisiteCourseId: FUNDAMENTALS }],
      }),
    ).toEqual({ ok: false, refusal: "duplicate" });
  });

  it("REFUSES a rule that would create a cycle", () => {
    // Requirement 1, at the layer an admin actually touches.
    expect(
      validateNewPrerequisite({
        ...base,
        existingEdges: [{ courseId: FUNDAMENTALS, prerequisiteCourseId: ADVANCED }],
      }),
    ).toEqual({ ok: false, refusal: "cycle" });
  });

  it("checks the score BEFORE the graph, so a typo is reported as a typo", () => {
    const result = validateNewPrerequisite({
      ...base,
      minScore: "101",
      existingEdges: [{ courseId: FUNDAMENTALS, prerequisiteCourseId: ADVANCED }],
    });
    expect(result).toEqual({ ok: false, refusal: "invalid_min_score" });
  });
});

// ---------------------------------------------------------------------------
describe("normaliseMinScore — REJECTS rather than clamps", () => {
  it("treats blank and null as no threshold", () => {
    expect(normaliseMinScore("")).toBeNull();
    expect(normaliseMinScore("   ")).toBeNull();
    expect(normaliseMinScore(null)).toBeNull();
    expect(normaliseMinScore(undefined)).toBeNull();
  });

  it("accepts 0 and 100 inclusive", () => {
    expect(normaliseMinScore("0")).toBe(0);
    expect(normaliseMinScore("100")).toBe(100);
    expect(normaliseMinScore(55)).toBe(55);
  });

  it("REFUSES an out-of-range number instead of clamping it", () => {
    // Clamping "1000" to 100 would silently install the strictest possible rule on
    // a course an admin thought they had barely constrained. A wrong threshold is
    // an access decision, so it must be refused rather than guessed at.
    expect(normaliseMinScore("101")).toBe("invalid");
    expect(normaliseMinScore(-1)).toBe("invalid");
    expect(normaliseMinScore(1000)).toBe("invalid");
  });

  it("REFUSES anything that is not a plain integer string", () => {
    expect(normaliseMinScore("70%")).toBe("invalid");
    expect(normaliseMinScore("1e2")).toBe("invalid");
    expect(normaliseMinScore("+5")).toBe("invalid");
    expect(normaliseMinScore("70.5")).toBe("invalid");
    expect(normaliseMinScore(70.5)).toBe("invalid");
    expect(normaliseMinScore({})).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
describe("normaliseOverrideReason", () => {
  it("returns null for blank, which the caller turns into `reason_required`", () => {
    expect(normaliseOverrideReason("")).toBeNull();
    expect(normaliseOverrideReason("  \n ")).toBeNull();
    expect(normaliseOverrideReason(undefined)).toBeNull();
  });

  it("truncates to the column length rather than rejecting", () => {
    // Unlike a score, losing the tail of a justification is better than throwing
    // away an override an admin meant to grant.
    const long = "x".repeat(OVERRIDE_REASON_MAX + 50);
    expect(normaliseOverrideReason(long)).toHaveLength(OVERRIDE_REASON_MAX);
  });
});

// ---------------------------------------------------------------------------
describe("canGrantOverride — who may grant, and what is refused", () => {
  const base = {
    granterRole: "admin",
    studentExists: true,
    courseExists: true,
    hasLiveOverride: false,
    unmetCount: 1,
    reason: "Transcript on file.",
  };

  it("allows an admin", () => {
    expect(canGrantOverride(base)).toEqual({ canGrant: true });
  });

  it("REFUSES a student, and refuses on the ROLE first", () => {
    // Role before existence, so a student probing the compiled action with a
    // guessed id learns nothing about whether that student or course exists.
    expect(
      canGrantOverride({ ...base, granterRole: "student", studentExists: false }),
    ).toEqual({ canGrant: false, refusal: "not_authorized" });
  });

  it("REFUSES an instructor — granting access is an enrolment act", () => {
    // Deliberately the same level as COURSE_APPROVAL_AUTH. A feature that admitted
    // instructors to an enrolment decision the neighbouring feature reserves for
    // admins would be a privilege escalation by inconsistency.
    expect(canGrantOverride({ ...base, granterRole: "instructor" })).toEqual({
      canGrant: false,
      refusal: "not_authorized",
    });
  });

  it("REFUSES an override with no stated reason", () => {
    // An unexplained override is a silent one, which is the thing requirement 4
    // forbids. Also NOT NULL at the column, so no route can store one.
    expect(canGrantOverride({ ...base, reason: null })).toEqual({
      canGrant: false,
      refusal: "reason_required",
    });
  });

  it("REFUSES a second live override for the same student and course", () => {
    expect(canGrantOverride({ ...base, hasLiveOverride: true })).toEqual({
      canGrant: false,
      refusal: "already_granted",
    });
  });

  it("REFUSES an override that would grant nothing", () => {
    // A no-op override row would read on the console as an exception that was
    // granted, so an auditor would believe a student was waved through a rule they
    // actually satisfied. A false audit record is worse than none.
    expect(canGrantOverride({ ...base, unmetCount: 0 })).toEqual({
      canGrant: false,
      refusal: "nothing_unmet",
    });
  });
});

// ---------------------------------------------------------------------------
describe("who may manage prerequisites", () => {
  it("is admin-only, via the frozen ROLES_SATISFYING table", () => {
    expect(PREREQUISITE_ADMIN_AUTH).toBe("admin");
    expect(canManagePrerequisites("admin")).toBe(true);
    expect(canManagePrerequisites("instructor")).toBe(false);
    expect(canManagePrerequisites("student")).toBe(false);
    expect(canManagePrerequisites(null)).toBe(false);
    expect(canManagePrerequisites(undefined)).toBe(false);
  });
});
