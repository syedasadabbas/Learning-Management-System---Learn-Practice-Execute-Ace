// =============================================================================
// COURSE ACCESS POLICY — the whole authorization decision, as pure functions.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// NO DATABASE, NO SESSION, NO `next/*` IMPORT in this file. Everything here is a
// total function over plain data, which is what makes the negative paths
// testable without a server: "a student cannot self-approve" is asserted as a
// property of `canDecideRequest`, not inferred from a button not being rendered.
// The same pattern the auth stream used for `roleSatisfies` in
// `src/lib/guard.ts:68`, and for the same reason — an authorization rule that
// can only be exercised through a page is a rule nobody can prove.
//
// NO ROLE STRING IS COMPARED TO A LITERAL HERE. Every role question goes through
// `roleSatisfies`, which reads the frozen `ROLES_SATISFYING` table in
// `src/lib/contracts/api.ts:191`. Re-levelling who may approve a request is then
// a contract edit, not a grep.
//
// -----------------------------------------------------------------------------
// HOW THIS GATE RELATES TO THE TWO GATES THAT ALREADY EXIST
//
// `docs/SUBJECT_SECTIONS.md` documents two existing layers, and this is a THIRD
// that sits STRICTLY IN FRONT of both. It never relaxes either:
//
//   | Layer                  | Question                                    | Where |
//   |------------------------|---------------------------------------------|-------|
//   | Course access (THIS)   | May this student open this COURSE at all?   | here  |
//   | Section release        | Has the cohort been given this SUBJECT?     | appConfig.curriculumSections |
//   | Quiz progression       | Has the previous week been passed?          | shouldUnlockNextWeek |
//
// A student who is refused here never reaches `gateWeek`, so nothing below can
// grant what this refuses. A student ALLOWED here still meets both existing
// gates unchanged — approval opens a course, not its withheld subjects.
//
// -----------------------------------------------------------------------------
// THE COMPATIBILITY RULE, STATED OUT LOUD: THE ACTIVE COURSE STAYS OPEN
//
// `loadCourseAndWeeks` (src/components/course/data.ts:156) serves the LOWEST-ID
// course to every signed-in student at /weeks, and has done since Wave 0. If
// this stream had made that course require an approved request, every existing
// student and every other stream's e2e spec would have lost the course they are
// enrolled in the moment this merged — a silent mass revocation dressed up as a
// feature.
//
// So the rule is: the active course is OPEN (no request needed, nothing to
// approve); every OTHER course requires an approved request. That is exactly
// today's behaviour for today's data, plus a gate on the courses that do not yet
// exist.
//
// THE COST, not hidden: there is currently no way to WITHHOLD the active course
// from a specific student, and no way to open a second course to everyone
// without an approval each. Both need the explicit "active course" marker that
// `src/components/course/data.ts:123` already carries a TODO for — a column on
// `courses` owned by shared-contracts, not by this stream. When that marker
// lands, `isOpenCourse` below is the ONE function that changes.
// =============================================================================

import { roleSatisfies } from "@/lib/guard";
import type { RouteAuth } from "@/lib/contracts/api";
import type { AccessRequestStatus } from "@/db/schema.access";

import { REQUEST_MESSAGE_MAX } from "./labels";

export type { AccessRequestStatus };
/**
 * Re-exported, NOT redeclared. It lives in ./labels.ts because client components
 * need it and this file transitively imports `pg` — see that file's header.
 */
export { REQUEST_MESSAGE_MAX };

/**
 * The auth level required to approve or reject a request. One constant, one
 * place to change.
 *
 * ADMIN, not instructor — matching `/admin/students` ("Roles and cohort
 * enrolment", admin-only) rather than `/instructor/grading`. Granting course
 * access is an ENROLMENT act: it decides who is on the roll, which downstream
 * changes the leaderboard population and who a deadline applies to. Grading one
 * submission is the instructor's remit; changing the roll is not. This is the
 * same argument `src/lib/videos/access.ts:14` makes for video curation, and it
 * costs the same thing: an instructor who wants a student admitted must ask an
 * admin.
 */
export const COURSE_APPROVAL_AUTH: RouteAuth = "admin";

/**
 * Is `courseId` the open, no-request-needed course?
 *
 * See the header. `activeCourseId` is passed in rather than read here so this
 * file stays free of database imports, and so a caller that already knows the
 * active course does not pay a second round trip (~245 ms against the Neon
 * instance — see docs/SUBJECT_SECTIONS.md appendix).
 *
 * A null `activeCourseId` (no course seeded at all) makes NOTHING open, which is
 * the fail-closed direction: an empty database must not read as "everything is
 * public".
 */
export function isOpenCourse(courseId: number, activeCourseId: number | null): boolean {
  return activeCourseId !== null && courseId === activeCourseId;
}

/** May `role` approve or reject access requests? */
export function canDecideRequests(role: string | null | undefined): boolean {
  return roleSatisfies(COURSE_APPROVAL_AUTH, role);
}

// ---------------------------------------------------------------------------
// Reading a course
// ---------------------------------------------------------------------------

export type CourseAccessDenial =
  /** No such course, or one the caller may not even learn the existence of. */
  | "not_found"
  /** Exists, but the student has never asked. */
  | "request_required"
  /** Asked, awaiting an admin. */
  | "pending"
  /** Asked and was refused. */
  | "rejected"
  /**
   * Admitted by an approved request, but a COURSE PREREQUISITE is not satisfied
   * and no admin override covers it. Added by the prerequisites stream (feature
   * 8) — see `CourseAccessInput.prerequisites` below and the long argument in
   * src/lib/prerequisites/policy.ts. This is NOT a fourth gate: the verdict is
   * computed elsewhere and consumed here, so this function remains the only
   * answer to "may this student open this course".
   */
  | "prerequisite_unmet";

export type CourseAccessDecision =
  | { allowed: true; via: "open_course" | "approved_request" | "staff" }
  | { allowed: false; denial: CourseAccessDenial };

export interface CourseAccessInput {
  courseId: number;
  /** The course the existing /weeks surface serves. Null when none is seeded. */
  activeCourseId: number | null;
  role: string | null | undefined;
  /** True only when a `courses` row with this id was actually read. */
  courseExists: boolean;
  /** The caller's own request row for this course, or null if they never filed one. */
  requestStatus: AccessRequestStatus | null;
  /**
   * The prerequisite verdict for this (student, course), from
   * `evaluateCoursePrerequisites` in src/lib/prerequisites/gate.ts. Omit or pass
   * null on a surface that has not computed one — the course is then treated as
   * unconstrained, which is the behaviour before feature 8 existed and the reason
   * this field is OPTIONAL rather than required.
   *
   * TYPED STRUCTURALLY, not imported. This file must not depend on the
   * prerequisites stream: the dependency runs one way (that stream imports
   * `isOpenCourse` from here), and a cycle between two policy modules would be
   * unpickable. A one-field structural type is also the smallest possible surface
   * for this stream to have widened someone else's contract by.
   */
  prerequisites?: { satisfied: boolean } | null;
}

/**
 * THE decision. Every surface — the catalog page, the course page, and the
 * server actions — routes through this one function rather than restating the
 * rule, because the copy that drifts is always the one guarding the deeper URL.
 * That is the lesson `decideWeekGate` in `src/components/course/data.ts:352`
 * records, and this is the same shape of function for the same reason.
 *
 * ORDER MATTERS AND IS DELIBERATE:
 *
 *  1. Existence first. A nonexistent course and a course the student has not
 *     been admitted to are DIFFERENT denials, but only because the caller
 *     already proved the row exists by reading it — `courseExists` is never
 *     inferred from the id.
 *
 *  2. Staff next. `roleSatisfies("instructor", …)` is ["instructor","admin"], so
 *     staff read every course without filing a request. An admin who had to
 *     approve their own access before they could see what they were approving is
 *     a deadlock, and an instructor who cannot open the course they teach cannot
 *     grade it. NOTE this grants the COURSE only: `gateWeek` still applies its
 *     section and progression locks to staff exactly as
 *     docs/SUBJECT_SECTIONS.md:109 describes, and this function does not touch
 *     that.
 *
 *  3. The open course, so today's students keep today's course.
 *
 *  4. Only then the request row — and `approved` is the ONLY status that opens
 *     anything. `pending` and `rejected` are separate denials rather than one
 *     generic refusal because the student needs to know whether to wait or to
 *     re-apply, and because a rejection that reads as "still pending" is how a
 *     student waits forever for an answer they already got.
 *
 *  5. PREREQUISITES, and ONLY on the `approved` branch. Added by feature 8.
 *     Placed there, and nowhere else, for three reasons:
 *
 *       - AFTER the staff branch, so staff still read every course. An admin who
 *         had to satisfy a prerequisite before they could see the course they were
 *         setting prerequisites on is a deadlock.
 *       - AFTER `isOpenCourse`, so the compatibility rule in this file's header
 *         holds unchanged: NO prerequisite can close the active course, and no
 *         admin data-entry mistake in the prerequisites stream can revoke the
 *         course the whole cohort is studying.
 *       - INSIDE the `approved` case rather than in front of the switch, so a
 *         student who has not yet asked still gets `request_required` — the
 *         actionable denial — rather than being told about a rule before they have
 *         tried to enrol. The prerequisite is surfaced to them separately, by
 *         `canRequestAccess` below, at the moment they ask.
 */
export function decideCourseAccess(input: CourseAccessInput): CourseAccessDecision {
  const { courseId, activeCourseId, role, courseExists, requestStatus } = input;

  if (!Number.isInteger(courseId) || courseId <= 0) return { allowed: false, denial: "not_found" };
  if (!courseExists) return { allowed: false, denial: "not_found" };

  // Anonymous callers never reach here (every page above calls requireUser
  // first), but a null role must still deny rather than fall through to the
  // request check, where `requestStatus` could not belong to anyone.
  if (!role) return { allowed: false, denial: "not_found" };

  if (roleSatisfies("instructor", role)) return { allowed: true, via: "staff" };
  if (isOpenCourse(courseId, activeCourseId)) return { allowed: true, via: "open_course" };

  switch (requestStatus) {
    case "approved":
      // Feature 8. `input.prerequisites` is the verdict computed by
      // src/lib/prerequisites/gate.ts, which has ALREADY folded in any admin
      // override — so `satisfied: true` covers both "met on merit" and "admitted by
      // a recorded exception", and this branch does not need to know which. The
      // page renders the difference; the decision does not depend on it.
      if (input.prerequisites && !input.prerequisites.satisfied) {
        return { allowed: false, denial: "prerequisite_unmet" };
      }
      return { allowed: true, via: "approved_request" };
    case "pending":
      return { allowed: false, denial: "pending" };
    case "rejected":
      return { allowed: false, denial: "rejected" };
    case null:
    case undefined:
      return { allowed: false, denial: "request_required" };
  }
}

/** Student-facing copy for a denial. Never leaks whether a course exists. */
export const DENIAL_MESSAGE: Record<CourseAccessDenial, string> = {
  not_found: "That course does not exist, or is not available to you.",
  request_required:
    "You are not enrolled in this course yet. Request access and an admin will review it.",
  pending: "Your access request is awaiting an admin decision. You will see the course here once it is approved.",
  rejected: "Your access request was declined. You can request again if your circumstances have changed.",
  /**
   * GENERIC ON PURPOSE, and the only entry in this map that is incomplete on its
   * own. The unmet prerequisites are NAMED by the page, from the same evaluation it
   * passed in — see `PrerequisiteNotice` in src/components/prerequisites. Baking a
   * course title into a constant here is impossible, and "Locked" with no reason is
   * precisely the failure mode feature 8 exists to remove, so the sentence below
   * must never be shown without the list beside it.
   */
  prerequisite_unmet:
    "You have access to this course, but its entry requirements are not met yet.",
};

// ---------------------------------------------------------------------------
// Filing a request
// ---------------------------------------------------------------------------

export type RequestRefusal =
  | "open_course"
  | "already_approved"
  | "already_pending"
  | "staff_not_applicable"
  /**
   * A COURSE PREREQUISITE is not satisfied. Added by feature 8: this is the
   * "auto-refuse" the prerequisite feature is for — a request that an admin would
   * only decline is better refused at the moment it is filed, WITH the missing
   * prerequisite named, than queued for a decision the student cannot influence.
   */
  | "prerequisite_unmet";

export type RequestEligibility =
  | { canRequest: true; isReapplication: boolean }
  | { canRequest: false; refusal: RequestRefusal };

/**
 * May this caller file (or re-file) a request for this course?
 *
 * `rejected` -> yes, and `isReapplication` is true. A rejection is not a
 * lifetime ban; the student's circumstances change, and the alternative is an
 * email to an admin that leaves no record on the queue. The unique index on
 * (student_id, course_id) means the re-application UPDATEs the existing row, so
 * a student cannot flood the queue by re-clicking — they hold exactly one row
 * forever, whatever they do.
 *
 * Staff are refused with `staff_not_applicable` rather than allowed: they
 * already read every course via `decideCourseAccess`, so a staff request would
 * be a row that grants nothing and an admin has to clear.
 */
export function canRequestAccess(input: {
  courseId: number;
  activeCourseId: number | null;
  role: string | null | undefined;
  requestStatus: AccessRequestStatus | null;
  /**
   * Feature 8. Same optional structural field as on `CourseAccessInput`, and the
   * same default: omitted means unconstrained, i.e. exactly the behaviour before
   * prerequisites existed.
   */
  prerequisites?: { satisfied: boolean } | null;
}): RequestEligibility {
  if (roleSatisfies("instructor", input.role)) {
    return { canRequest: false, refusal: "staff_not_applicable" };
  }
  if (isOpenCourse(input.courseId, input.activeCourseId)) {
    return { canRequest: false, refusal: "open_course" };
  }
  if (input.requestStatus === "approved") {
    return { canRequest: false, refusal: "already_approved" };
  }
  if (input.requestStatus === "pending") {
    return { canRequest: false, refusal: "already_pending" };
  }
  // LAST of the refusals, deliberately. The four above describe the student's own
  // position and are cheaper to act on; being told "you already have access" is
  // more useful than being told about a prerequisite for a course you are already
  // in. Placing this ahead of them would also make an override-holder unable to
  // re-request after a rejection, since `prerequisites.satisfied` reflects the
  // override and a student without one would be stuck behind a rule while their
  // pending request sat unmentioned.
  if (input.prerequisites && !input.prerequisites.satisfied) {
    return { canRequest: false, refusal: "prerequisite_unmet" };
  }
  return { canRequest: true, isReapplication: input.requestStatus === "rejected" };
}

export const REFUSAL_MESSAGE: Record<RequestRefusal, string> = {
  open_course: "This course is open to everyone in the cohort — no request is needed.",
  already_approved: "You already have access to this course.",
  already_pending: "You already have a request awaiting a decision on this course.",
  staff_not_applicable: "Staff accounts can already read every course.",
  /** Generic for the same reason `DENIAL_MESSAGE.prerequisite_unmet` is — the page names the rules. */
  prerequisite_unmet:
    "You do not meet this course's entry requirements yet, so a request would be declined.",
};

/**
 * Normalise a student-supplied note.
 *
 * Returns null for blank input so an empty textarea stores NULL rather than "",
 * and TRUNCATES rather than rejecting: losing the tail of an over-long note is a
 * better outcome than throwing away a request the student meant to file. The
 * server action calls this — the form's maxLength attribute is presentation, and
 * the action is a plain HTTP POST target that no client-side attribute protects.
 */
export function normaliseRequestMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, REQUEST_MESSAGE_MAX);
}

// ---------------------------------------------------------------------------
// Deciding a request  —  the anti-self-approval rule
// ---------------------------------------------------------------------------

export type DecisionRefusal =
  | "not_authorized"
  | "self_approval"
  | "already_decided";

export type DecisionEligibility =
  | { canDecide: true }
  | { canDecide: false; refusal: DecisionRefusal };

/**
 * May `decider` rule on this request?
 *
 * THREE INDEPENDENT REFUSALS, and the order is the security order:
 *
 *  1. `not_authorized` — role check first, so a student probing the action with
 *     a guessed request id learns nothing about whose it is or what state it is
 *     in. This is the one that stops "a student self-approves".
 *
 *  2. `self_approval` — an ADMIN may not rule on their OWN request. Rule 1 does
 *     not cover this: an admin passes the role check by definition. Today this
 *     is nearly unreachable (staff are granted access by `decideCourseAccess`
 *     and `canRequestAccess` refuses to create their row at all), which is
 *     exactly why it is written down now — the day an admin account is
 *     downgraded to student and back, or the day staff requests become
 *     meaningful, the check has to already exist. A four-eyes rule added after
 *     the first self-approval is a post-mortem, not a control.
 *
 *  3. `already_decided` — a second decision on a settled row is refused rather
 *     than silently overwritten. Two admins clearing the same queue would
 *     otherwise race, and the loser's click would quietly reverse the winner's
 *     with no trace but a changed `decided_by`.
 */
export function canDecideRequest(input: {
  deciderId: number;
  deciderRole: string | null | undefined;
  requesterId: number;
  currentStatus: AccessRequestStatus;
}): DecisionEligibility {
  if (!canDecideRequests(input.deciderRole)) {
    return { canDecide: false, refusal: "not_authorized" };
  }
  if (input.deciderId === input.requesterId) {
    return { canDecide: false, refusal: "self_approval" };
  }
  if (input.currentStatus !== "pending") {
    return { canDecide: false, refusal: "already_decided" };
  }
  return { canDecide: true };
}

export const DECISION_REFUSAL_MESSAGE: Record<DecisionRefusal, string> = {
  not_authorized: "You do not have access to course access requests.",
  self_approval:
    "You cannot decide your own access request. Ask another admin to review it.",
  already_decided:
    "That request has already been decided. Reload the queue to see the current state.",
};

/**
 * May `viewerId` read the request row belonging to `ownerId`?
 *
 * The rule the store layer is built to make unnecessary — every student-scoped
 * read there takes the session id and filters on it, so there is no query that
 * could return someone else's row. This function exists so the rule is ASSERTED
 * somewhere rather than only being an emergent property of how the queries
 * happen to be written today, and so a future read-by-id path has an obvious
 * thing to call.
 */
export function canReadRequest(input: {
  viewerId: number;
  viewerRole: string | null | undefined;
  ownerId: number;
}): boolean {
  if (canDecideRequests(input.viewerRole)) return true;
  return input.viewerId === input.ownerId;
}
