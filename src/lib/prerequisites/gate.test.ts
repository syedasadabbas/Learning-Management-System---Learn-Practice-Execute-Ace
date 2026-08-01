// =============================================================================
// UNIT TESTS for `buildFacts` — what "has access to the prerequisite" means.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// `buildFacts` is small and it is the one place in the stream where a wrong answer
// silently WIDENS access rather than narrowing it, which is why it is pure and
// exported rather than inlined into the query function. The three branches it has to
// get right:
//
//   * an APPROVED request satisfies "did that course";
//   * the OPEN (active) course satisfies it for everyone, because every signed-in
//     student has it — src/lib/courses/policy.ts:36;
//   * STAFF satisfy every prerequisite, because `decideCourseAccess` admits them to
//     every course on its own staff branch. Anything else would be a contradiction
//     between two files rather than a policy.
//
// And the one it must NOT get wrong: a score is available only for the ACTIVE
// course, so every other course's `scorePercent` is null and null is not zero.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

// `./gate` imports `./store` -> `@/db`, and src/db/index.ts PRE-WARMS three
// connections at import time (see its header). tests/setup.ts forbids reaching the
// real database, so the module is replaced wholesale. `@/lib/auth` is mocked for the
// same reason as in the sibling suites — `roleSatisfies` itself stays real.
vi.mock("@/db", () => ({ db: {}, pool: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { buildFacts } from "./gate";

const ACTIVE = 1;
const OTHER = 2;
const THIRD = 3;

describe("buildFacts — hasAccess", () => {
  it("grants access to a course the student holds an approved request for", () => {
    const [fact] = buildFacts({
      prerequisiteIds: [OTHER],
      approvedIds: [OTHER],
      activeCourseId: ACTIVE,
      activeCoursePercent: null,
      role: "student",
    });
    expect(fact.hasAccess).toBe(true);
  });

  it("REFUSES a course the student has no approved request for", () => {
    const [fact] = buildFacts({
      prerequisiteIds: [OTHER],
      approvedIds: [],
      activeCourseId: ACTIVE,
      activeCoursePercent: null,
      role: "student",
    });
    expect(fact.hasAccess).toBe(false);
  });

  it("grants access to the ACTIVE course without any request row", () => {
    // The open course is every signed-in student's, so citing it as a prerequisite
    // must not require an approval that can never exist — `canRequestAccess` refuses
    // to file one for the open course at all.
    const [fact] = buildFacts({
      prerequisiteIds: [ACTIVE],
      approvedIds: [],
      activeCourseId: ACTIVE,
      activeCoursePercent: null,
      role: "student",
    });
    expect(fact.hasAccess).toBe(true);
  });

  it("grants STAFF access to every prerequisite course", () => {
    const facts = buildFacts({
      prerequisiteIds: [OTHER, THIRD],
      approvedIds: [],
      activeCourseId: ACTIVE,
      activeCoursePercent: null,
      role: "instructor",
    });
    expect(facts.map((f) => f.hasAccess)).toEqual([true, true]);
    expect(
      buildFacts({
        prerequisiteIds: [OTHER],
        approvedIds: [],
        activeCourseId: ACTIVE,
        activeCoursePercent: null,
        role: "admin",
      })[0].hasAccess,
    ).toBe(true);
  });

  it("does not grant access on a null or unknown role", () => {
    // Fail closed. An anonymous caller never reaches here (every page above calls
    // requireUser first), but a null role must deny rather than fall through.
    for (const role of [null, undefined, "", "guest"]) {
      const [fact] = buildFacts({
        prerequisiteIds: [OTHER],
        approvedIds: [],
        activeCourseId: ACTIVE,
        activeCoursePercent: null,
        role,
      });
      expect(fact.hasAccess).toBe(false);
    }
  });

  it("treats nothing as open when no course is seeded at all", () => {
    // A null activeCourseId must not read as "every course is the open one".
    const [fact] = buildFacts({
      prerequisiteIds: [ACTIVE],
      approvedIds: [],
      activeCourseId: null,
      activeCoursePercent: null,
      role: "student",
    });
    expect(fact.hasAccess).toBe(false);
  });

  it("returns one fact per requested id, in order", () => {
    // `evaluatePrerequisites` treats a MISSING fact as no access, so a builder that
    // dropped ids would fail closed — correct, but it would refuse students for
    // prerequisites they actually hold. The count is part of the contract.
    const facts = buildFacts({
      prerequisiteIds: [THIRD, OTHER, ACTIVE],
      approvedIds: [OTHER],
      activeCourseId: ACTIVE,
      activeCoursePercent: 50,
      role: "student",
    });
    expect(facts.map((f) => f.courseId)).toEqual([THIRD, OTHER, ACTIVE]);
  });
});

describe("buildFacts — scorePercent", () => {
  it("attaches the score only to the ACTIVE course", () => {
    const facts = buildFacts({
      prerequisiteIds: [ACTIVE, OTHER],
      approvedIds: [OTHER],
      activeCourseId: ACTIVE,
      activeCoursePercent: 82.5,
      role: "student",
    });
    expect(facts[0].scorePercent).toBe(82.5);
    // NULL, NOT ZERO. Only the active course has weeks and a progress aggregate
    // (src/lib/progress/query.ts:148); reporting 0 for the others would make every
    // threshold on them look like the student had simply not worked.
    expect(facts[1].scorePercent).toBeNull();
  });

  it("leaves the score null when it was not fetched", () => {
    // The caller skips the score read when no rule states a threshold. That must
    // surface as `score_unknown`, never as 0%.
    const [fact] = buildFacts({
      prerequisiteIds: [ACTIVE],
      approvedIds: [],
      activeCourseId: ACTIVE,
      activeCoursePercent: null,
      role: "student",
    });
    expect(fact.scorePercent).toBeNull();
  });

  it("attaches a genuine 0% when that is the student's real score", () => {
    // 0 and null are different facts and both must survive the round trip.
    const [fact] = buildFacts({
      prerequisiteIds: [ACTIVE],
      approvedIds: [],
      activeCourseId: ACTIVE,
      activeCoursePercent: 0,
      role: "student",
    });
    expect(fact.scorePercent).toBe(0);
  });
});
