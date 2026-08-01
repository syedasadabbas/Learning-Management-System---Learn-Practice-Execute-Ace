// =============================================================================
// UNIT TESTS for the SEAM — prerequisites inside `decideCourseAccess`.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// WHY THESE TESTS LIVE HERE AND NOT IN src/lib/courses/policy.test.ts
//
// `src/lib/courses/**` is the courses / access-requests stream's. This stream made a
// deliberately minimal, additive change to `decideCourseAccess` and
// `canRequestAccess` — one optional structural field and one new denial each — and
// the tests for that change belong with the stream that made it, so the other
// stream's suite is not left asserting behaviour it did not write. Their file
// continues to pass unchanged, which is itself the backwards-compatibility
// assertion: an OMITTED `prerequisites` field must behave exactly as before.
//
// WHAT THIS FILE EXISTS TO PROVE, and none of it is provable from either policy
// module alone:
//
//   * PREREQUISITES ARE NOT A FOURTH GATE. There is one decision function and it
//     takes the prerequisite verdict as an input, exactly as it takes
//     `requestStatus`. If a future edit moved the check into a page, these tests
//     would still pass while the real gate rotted — so each one is written against
//     `decideCourseAccess` itself, the function every surface calls.
//
//   * THE COMPATIBILITY RULE SURVIVES. The ACTIVE course stays open to every
//     signed-in student even with an unsatisfied prerequisite recorded against it.
//     src/lib/courses/policy.ts:36 records that gating it "would have silently
//     revoked the course every existing student is on", and a prerequisite that
//     could do the same thing by the back door would be the identical defect.
//
//   * STAFF ARE NOT LOCKED OUT. An admin who had to satisfy a prerequisite before
//     they could see the course they were setting prerequisites on is a deadlock.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

// Same mock, same reason as src/lib/courses/policy.test.ts:25 — `@/lib/guard`
// imports `@/lib/auth`, which pulls in `pg`, and tests/setup.ts forbids reaching a
// real database. `roleSatisfies` itself is pure and is NOT mocked.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { canRequestAccess, decideCourseAccess } from "@/lib/courses/policy";

const ACTIVE = 1;
const OTHER = 2;

const UNSATISFIED = { satisfied: false };
const SATISFIED = { satisfied: true };

function access(overrides: Partial<Parameters<typeof decideCourseAccess>[0]> = {}) {
  return decideCourseAccess({
    courseId: OTHER,
    activeCourseId: ACTIVE,
    role: "student",
    courseExists: true,
    requestStatus: "approved",
    ...overrides,
  });
}

function request(overrides: Partial<Parameters<typeof canRequestAccess>[0]> = {}) {
  return canRequestAccess({
    courseId: OTHER,
    activeCourseId: ACTIVE,
    role: "student",
    requestStatus: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
describe("decideCourseAccess — prerequisites as an input, not a second gate", () => {
  it("REFUSES an approved student whose prerequisite is unmet", () => {
    // The read-time enforcement. Without this a prerequisite added after an approval
    // would be advisory, and IMPLEMENTATION_ROADMAP.md:714 asks for 100% enforcement.
    expect(access({ prerequisites: UNSATISFIED })).toEqual({
      allowed: false,
      denial: "prerequisite_unmet",
    });
  });

  it("allows an approved student whose prerequisites are satisfied", () => {
    expect(access({ prerequisites: SATISFIED })).toEqual({
      allowed: true,
      via: "approved_request",
    });
  });

  it("allows an approved student when NO verdict was supplied", () => {
    // BACKWARDS COMPATIBILITY. Every surface written before feature 8 omits the
    // field, and omitting it must mean "unconstrained" rather than "refuse".
    expect(access({ prerequisites: undefined })).toEqual({
      allowed: true,
      via: "approved_request",
    });
    expect(access({ prerequisites: null })).toEqual({
      allowed: true,
      via: "approved_request",
    });
  });

  it("KEEPS THE ACTIVE COURSE OPEN even with an unmet prerequisite on it", () => {
    // THE MOST IMPORTANT ASSERTION IN THIS FILE. If this ever fails, an admin
    // recording a prerequisite against the cohort's own course revokes it from
    // every student at once — the silent mass revocation the compatibility rule at
    // src/lib/courses/policy.ts:36 exists to prevent.
    expect(
      access({ courseId: ACTIVE, requestStatus: null, prerequisites: UNSATISFIED }),
    ).toEqual({ allowed: true, via: "open_course" });
  });

  it("does not lock STAFF out of a course whose prerequisites they do not meet", () => {
    // An admin who cannot open the course they are configuring cannot configure it.
    expect(access({ role: "admin", prerequisites: UNSATISFIED })).toEqual({
      allowed: true,
      via: "staff",
    });
    expect(access({ role: "instructor", prerequisites: UNSATISFIED })).toEqual({
      allowed: true,
      via: "staff",
    });
  });

  it("still says request_required — not prerequisite_unmet — before a request exists", () => {
    // Ordering, deliberately: the actionable denial wins. Telling a student about a
    // rule for a course they have not tried to enrol in buries the one instruction
    // they can act on ("request access").
    expect(access({ requestStatus: null, prerequisites: UNSATISFIED })).toEqual({
      allowed: false,
      denial: "request_required",
    });
  });

  it("still says pending while a request is pending", () => {
    expect(access({ requestStatus: "pending", prerequisites: UNSATISFIED })).toEqual({
      allowed: false,
      denial: "pending",
    });
  });

  it("still says rejected after a rejection", () => {
    expect(access({ requestStatus: "rejected", prerequisites: UNSATISFIED })).toEqual({
      allowed: false,
      denial: "rejected",
    });
  });

  it("still says not_found for a course that does not exist, whatever the verdict", () => {
    // Existence is checked first so probing ids enumerates nothing. A prerequisite
    // denial on a nonexistent course would confirm the id.
    expect(access({ courseExists: false, prerequisites: UNSATISFIED })).toEqual({
      allowed: false,
      denial: "not_found",
    });
  });
});

// ---------------------------------------------------------------------------
describe("canRequestAccess — the auto-refusal at the moment of asking", () => {
  it("REFUSES a request whose prerequisites are unmet", () => {
    // The "auto-refuse" half of the feature: a request an admin would only decline
    // is better refused now, with the missing course named, than queued.
    expect(request({ prerequisites: UNSATISFIED })).toEqual({
      canRequest: false,
      refusal: "prerequisite_unmet",
    });
  });

  it("allows a request when prerequisites are satisfied", () => {
    expect(request({ prerequisites: SATISFIED })).toEqual({
      canRequest: true,
      isReapplication: false,
    });
  });

  it("allows a re-application after a rejection once prerequisites are met", () => {
    expect(request({ requestStatus: "rejected", prerequisites: SATISFIED })).toEqual({
      canRequest: true,
      isReapplication: true,
    });
  });

  it("allows a request when no verdict was supplied", () => {
    // Backwards compatibility, same as above.
    expect(request({})).toEqual({ canRequest: true, isReapplication: false });
  });

  it("says open_course, not prerequisite_unmet, for the active course", () => {
    // Same compatibility rule seen from the request side: the cohort course needs no
    // request, so it cannot be blocked by one being refused.
    expect(
      request({ courseId: ACTIVE, prerequisites: UNSATISFIED }),
    ).toEqual({ canRequest: false, refusal: "open_course" });
  });

  it("says already_approved before mentioning a prerequisite", () => {
    // Being told "you already have access" is more useful than being told about a
    // requirement for a course you are already in.
    expect(
      request({ requestStatus: "approved", prerequisites: UNSATISFIED }),
    ).toEqual({ canRequest: false, refusal: "already_approved" });
  });

  it("says already_pending before mentioning a prerequisite", () => {
    expect(
      request({ requestStatus: "pending", prerequisites: UNSATISFIED }),
    ).toEqual({ canRequest: false, refusal: "already_pending" });
  });

  it("says staff_not_applicable for staff, whatever the verdict", () => {
    expect(request({ role: "instructor", prerequisites: UNSATISFIED })).toEqual({
      canRequest: false,
      refusal: "staff_not_applicable",
    });
  });
});
