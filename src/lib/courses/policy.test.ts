// =============================================================================
// UNIT TESTS for the course access policy.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// THE NEGATIVE PATHS ARE THE POINT. The task this stream exists to satisfy is
// "a student must not be able to self-approve, read another student's request,
// or reach a course's content before approval". Each of those three is asserted
// here as a property of a pure function, so it is proven without a browser, a
// session or a database — and so it stays proven when the pages are rewritten.
//
// A happy-path-only suite would pass identically against a `decideCourseAccess`
// that returned `{ allowed: true }` unconditionally, which is exactly the
// regression worth catching.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

// `policy.ts` imports `roleSatisfies` from `@/lib/guard`, which imports
// `@/lib/auth` and therefore `next-auth` + `pg`. Mocked out for the same reason
// src/lib/guard.test.ts:17 mocks it: importing it for real opens a connection
// pool, which tests/setup.ts forbids, and `next-auth/lib/env.js` does not even
// resolve outside the Next build. `roleSatisfies` itself is pure and is NOT
// mocked — these tests exercise the real frozen ROLES_SATISFYING table.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import {
  canDecideRequest,
  canDecideRequests,
  canReadRequest,
  canRequestAccess,
  COURSE_APPROVAL_AUTH,
  DECISION_REFUSAL_MESSAGE,
  decideCourseAccess,
  DENIAL_MESSAGE,
  isOpenCourse,
  normaliseRequestMessage,
  REFUSAL_MESSAGE,
  REQUEST_MESSAGE_MAX,
  type AccessRequestStatus,
} from "./policy";

/** The seeded shape: course 1 is the one /weeks serves; course 2 is the new one. */
const ACTIVE = 1;
const OTHER = 2;

function access(overrides: Partial<Parameters<typeof decideCourseAccess>[0]> = {}) {
  return decideCourseAccess({
    courseId: OTHER,
    activeCourseId: ACTIVE,
    role: "student",
    courseExists: true,
    requestStatus: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
describe("decideCourseAccess — a student cannot reach a course before approval", () => {
  it("refuses a course the student has never asked for", () => {
    expect(access({ requestStatus: null })).toEqual({
      allowed: false,
      denial: "request_required",
    });
  });

  it("refuses while the request is still pending", () => {
    // The whole feature is worthless if `pending` reads as access. This is the
    // single most important assertion in the file.
    expect(access({ requestStatus: "pending" })).toEqual({
      allowed: false,
      denial: "pending",
    });
  });

  it("refuses after a rejection", () => {
    expect(access({ requestStatus: "rejected" })).toEqual({
      allowed: false,
      denial: "rejected",
    });
  });

  it("distinguishes pending from rejected rather than collapsing both to 'denied'", () => {
    // A rejection that reads as "still pending" leaves a student waiting forever
    // for an answer they already got.
    const pending = access({ requestStatus: "pending" });
    const rejected = access({ requestStatus: "rejected" });
    expect(pending).not.toEqual(rejected);
    expect(DENIAL_MESSAGE.pending).not.toEqual(DENIAL_MESSAGE.rejected);
  });

  it("allows only once the request is approved", () => {
    expect(access({ requestStatus: "approved" })).toEqual({
      allowed: true,
      via: "approved_request",
    });
  });
});

describe("decideCourseAccess — existence and identity are checked before anything else", () => {
  it("reports not_found for a course that does not exist, whatever the request says", () => {
    // A stale `approved` row pointing at a deleted course must not open it.
    expect(access({ courseExists: false, requestStatus: "approved" })).toEqual({
      allowed: false,
      denial: "not_found",
    });
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects the non-id %p as not_found", (bad) => {
    expect(access({ courseId: bad as number })).toEqual({
      allowed: false,
      denial: "not_found",
    });
  });

  it("denies a null role instead of falling through to the request check", () => {
    // A request row cannot belong to nobody; treating one as the caller's would
    // be an authorization decision made on someone else's data.
    expect(access({ role: null, requestStatus: "approved" })).toEqual({
      allowed: false,
      denial: "not_found",
    });
  });

  it("uses copy that does not confirm a course exists", () => {
    expect(DENIAL_MESSAGE.not_found).toContain("does not exist, or is not available");
  });
});

describe("decideCourseAccess — the active course stays open (backwards compatibility)", () => {
  // If this breaks, every existing student silently loses the course they are on
  // and every other stream's e2e suite fails at once. See policy.ts header.
  it("opens the active course to a student with no request at all", () => {
    expect(access({ courseId: ACTIVE, requestStatus: null })).toEqual({
      allowed: true,
      via: "open_course",
    });
  });

  it("opens the active course even to a student whose request was rejected", () => {
    // There is nothing to reject on the open course — canRequestAccess refuses
    // to create the row — but a row surviving from a previous data shape must
    // not be able to revoke the course everyone is enrolled in.
    expect(access({ courseId: ACTIVE, requestStatus: "rejected" })).toEqual({
      allowed: true,
      via: "open_course",
    });
  });

  it("opens NOTHING when no course is seeded — fail closed", () => {
    expect(access({ courseId: ACTIVE, activeCourseId: null })).toEqual({
      allowed: false,
      denial: "request_required",
    });
    expect(isOpenCourse(1, null)).toBe(false);
  });
});

describe("decideCourseAccess — staff", () => {
  it.each(["instructor", "admin"])("%s reads any course without filing a request", (role) => {
    expect(access({ role })).toEqual({ allowed: true, via: "staff" });
  });

  it("staff access is still refused for a course that does not exist", () => {
    expect(access({ role: "admin", courseExists: false })).toEqual({
      allowed: false,
      denial: "not_found",
    });
  });

  it("a student is never treated as staff", () => {
    expect(access({ role: "student" })).not.toEqual({ allowed: true, via: "staff" });
  });
});

// ---------------------------------------------------------------------------
describe("canRequestAccess", () => {
  function eligibility(overrides: Partial<Parameters<typeof canRequestAccess>[0]> = {}) {
    return canRequestAccess({
      courseId: OTHER,
      activeCourseId: ACTIVE,
      role: "student",
      requestStatus: null,
      ...overrides,
    });
  }

  it("lets a student with no row file a first request", () => {
    expect(eligibility()).toEqual({ canRequest: true, isReapplication: false });
  });

  it("lets a rejected student re-apply, flagged as a re-application", () => {
    expect(eligibility({ requestStatus: "rejected" })).toEqual({
      canRequest: true,
      isReapplication: true,
    });
  });

  it("refuses a second request while one is pending", () => {
    // Without this a double-click files twice; the unique index then makes the
    // second an UPDATE, but the student should be told, not silently no-op'd.
    expect(eligibility({ requestStatus: "pending" })).toEqual({
      canRequest: false,
      refusal: "already_pending",
    });
  });

  it("refuses a student who already has access", () => {
    expect(eligibility({ requestStatus: "approved" })).toEqual({
      canRequest: false,
      refusal: "already_approved",
    });
  });

  it("refuses a request for the open course — there is nothing to grant", () => {
    expect(eligibility({ courseId: ACTIVE })).toEqual({
      canRequest: false,
      refusal: "open_course",
    });
  });

  it.each(["instructor", "admin"])("refuses %s — a staff row would grant nothing", (role) => {
    expect(eligibility({ role })).toEqual({
      canRequest: false,
      refusal: "staff_not_applicable",
    });
  });

  it("every refusal has student-facing copy", () => {
    for (const key of Object.keys(REFUSAL_MESSAGE)) {
      expect(REFUSAL_MESSAGE[key as keyof typeof REFUSAL_MESSAGE].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe("canDecideRequest — a student cannot self-approve", () => {
  function decision(overrides: Partial<Parameters<typeof canDecideRequest>[0]> = {}) {
    return canDecideRequest({
      deciderId: 10,
      deciderRole: "admin",
      requesterId: 20,
      currentStatus: "pending",
      ...overrides,
    });
  }

  it("an admin may decide another person's pending request", () => {
    expect(decision()).toEqual({ canDecide: true });
  });

  it("A STUDENT MAY NOT DECIDE THEIR OWN REQUEST", () => {
    // The headline negative path: the student is both decider and requester.
    expect(
      decision({ deciderRole: "student", deciderId: 20, requesterId: 20 }),
    ).toEqual({ canDecide: false, refusal: "not_authorized" });
  });

  it("a student may not decide anyone else's request either", () => {
    expect(decision({ deciderRole: "student" })).toEqual({
      canDecide: false,
      refusal: "not_authorized",
    });
  });

  it("an INSTRUCTOR may not decide — approval is admin-only", () => {
    // ROLES_SATISFYING.admin is ["admin"] alone. If this starts passing, someone
    // has re-levelled COURSE_APPROVAL_AUTH; that is a reviewable decision, not a
    // silent one.
    expect(decision({ deciderRole: "instructor" })).toEqual({
      canDecide: false,
      refusal: "not_authorized",
    });
  });

  it.each([null, undefined, "", "superuser"])("refuses the role %p", (role) => {
    expect(decision({ deciderRole: role as string })).toEqual({
      canDecide: false,
      refusal: "not_authorized",
    });
  });

  it("an ADMIN may not decide their own request — four eyes", () => {
    // Rule 1 cannot catch this: an admin passes the role check by definition.
    expect(decision({ deciderId: 7, requesterId: 7 })).toEqual({
      canDecide: false,
      refusal: "self_approval",
    });
  });

  it("checks the role BEFORE the self-approval rule", () => {
    // Order matters: a student probing with a guessed request id must learn
    // "not_authorized", never "self_approval", which would confirm whose row it
    // is.
    expect(decision({ deciderRole: "student", deciderId: 5, requesterId: 5 }).canDecide).toBe(
      false,
    );
    expect(
      (decision({ deciderRole: "student", deciderId: 5, requesterId: 5 }) as {
        refusal: string;
      }).refusal,
    ).toBe("not_authorized");
  });

  it.each<AccessRequestStatus>(["approved", "rejected"])(
    "refuses a second decision on an already-%s row",
    (currentStatus) => {
      expect(decision({ currentStatus })).toEqual({
        canDecide: false,
        refusal: "already_decided",
      });
    },
  );

  it("every decision refusal has copy", () => {
    for (const key of Object.keys(DECISION_REFUSAL_MESSAGE)) {
      expect(
        DECISION_REFUSAL_MESSAGE[key as keyof typeof DECISION_REFUSAL_MESSAGE].length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("canDecideRequests reads the frozen role table", () => {
  it("is admin-level", () => {
    expect(COURSE_APPROVAL_AUTH).toBe("admin");
  });
  it.each([
    ["admin", true],
    ["instructor", false],
    ["student", false],
    [null, false],
  ])("%s -> %s", (role, expected) => {
    expect(canDecideRequests(role as string | null)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
describe("canReadRequest — a student cannot read another student's request", () => {
  it("a student reads their own", () => {
    expect(canReadRequest({ viewerId: 3, viewerRole: "student", ownerId: 3 })).toBe(true);
  });

  it("A STUDENT CANNOT READ SOMEONE ELSE'S", () => {
    expect(canReadRequest({ viewerId: 3, viewerRole: "student", ownerId: 4 })).toBe(false);
  });

  it("an instructor cannot read a student's request either", () => {
    // Deliberate: requests are an enrolment matter, and COURSE_APPROVAL_AUTH is
    // admin. An instructor has no reason to read who applied to what.
    expect(canReadRequest({ viewerId: 3, viewerRole: "instructor", ownerId: 4 })).toBe(false);
  });

  it("an admin may, because they have to decide it", () => {
    expect(canReadRequest({ viewerId: 3, viewerRole: "admin", ownerId: 4 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("normaliseRequestMessage", () => {
  it("trims", () => {
    expect(normaliseRequestMessage("  hello  ")).toBe("hello");
  });

  it("turns blank input into null so the column stores NULL, not an empty string", () => {
    expect(normaliseRequestMessage("")).toBeNull();
    expect(normaliseRequestMessage("   \n\t ")).toBeNull();
  });

  it.each([null, undefined, 42, {}, []])("rejects the non-string %p", (bad) => {
    // The action is an HTTP POST target; the client can send anything at all.
    expect(normaliseRequestMessage(bad)).toBeNull();
  });

  it("truncates rather than rejecting an over-long note", () => {
    // Losing the tail beats throwing away a request the student meant to file.
    const long = "x".repeat(REQUEST_MESSAGE_MAX + 250);
    const result = normaliseRequestMessage(long);
    expect(result).toHaveLength(REQUEST_MESSAGE_MAX);
  });

  it("never returns more than the column can hold", () => {
    // varchar(500) in src/db/schema.access.ts. A longer value is a runtime
    // insert error, i.e. a lost request, not a truncated one.
    expect(REQUEST_MESSAGE_MAX).toBe(500);
  });
});
