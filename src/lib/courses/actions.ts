"use server";

// =============================================================================
// SERVER ACTIONS — request access / approve / reject.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// WHY ACTIONS AND NOT API ROUTES. `ROUTES` in `@/lib/contracts/api` is frozen and
// lists no course-access endpoint. Adding `POST /api/courses/:id/request` would
// create a path with no `ROUTE_AUTH` entry — the unguarded-by-omission bug that
// map exists to prevent, and the reason its own header calls an unlisted route a
// defeat of the compile-time check. Server actions keep the mutation inside the
// frozen contract while still being guarded. Same call the video-ingestion
// stream made (src/lib/videos/actions.ts:8).
//
// EVERY EXPORT HERE IS AN HTTP-REACHABLE POST TARGET once Next.js compiles it.
// The first statement of each is a guard from ./access; no exception, and any
// action added later must open the same way.
//
// NO ACTION TAKES A STUDENT ID. `requestCourseAccessAction` writes for the
// SESSION user and nobody else — a `studentId` parameter would let any signed-in
// user file, or in the decision actions' case grant, access on someone else's
// behalf. The only id crossing the wire from a student is a COURSE id, and from
// an admin a REQUEST id, both of which are re-checked server-side.
//
// Actions return a typed result rather than throwing across the RSC boundary: a
// thrown error reaches the browser as a generic "unexpected response", which
// tells a student nothing about whether their request was filed.
// =============================================================================

import { revalidatePath } from "next/cache";

// FEATURE 8. Imported from ./gate, the composition seam — NOT from
// @/lib/prerequisites (the barrel re-exports the write functions, and a request
// action has no business being able to author a prerequisite rule).
import { evaluateCoursePrerequisites } from "@/lib/prerequisites/gate";

import { CourseAccessForbiddenError, requireCourseApprover, requireCourseRequester } from "./access";
import {
  canDecideRequest,
  canRequestAccess,
  DECISION_REFUSAL_MESSAGE,
  normaliseRequestMessage,
  REFUSAL_MESSAGE,
} from "./policy";
import {
  decideRequest,
  getActiveCourseId,
  getCourse,
  getOwnRequest,
  getRequestById,
  upsertRequest,
} from "./store";

export type CourseAccessActionResult =
  | { ok: true; status: "pending" | "approved" | "rejected" }
  | { ok: false; error: string };

function fail(error: string): CourseAccessActionResult {
  return { ok: false, error };
}

function toFailure(error: unknown): CourseAccessActionResult {
  if (error instanceof CourseAccessForbiddenError) return fail(error.message);
  // A database error string in the browser is an information leak.
  console.error("[courses] access action failed", error);
  return fail("The request could not be saved. Please try again.");
}

function validId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Revalidate every surface a decision changes.
 *
 * `/courses` is where the student reads their own status and `/admin/…` is the
 * queue the admin is looking at. Without the first, an approval would appear to
 * do nothing on the student's side until the route cache aged out — and "I was
 * approved but the page still says pending" is indistinguishable from "the
 * approval failed".
 */
function revalidate(courseId?: number): void {
  revalidatePath("/courses");
  if (courseId != null) revalidatePath(`/courses/${courseId}`);
  revalidatePath("/admin/course-requests");
}

/**
 * File (or re-file, after a rejection) a request for one course.
 *
 * Three independent checks before anything is written, none of which the client
 * can skip:
 *   1. a session exists (the row is written FOR that session's user);
 *   2. the course actually exists — `getCourse` returns null otherwise, and the
 *      refusal is deliberately the same "not available" wording as an
 *      unauthorised course, so probing ids enumerates nothing;
 *   3. `canRequestAccess` — which refuses the open course, an existing approval,
 *      and an already-pending row.
 */
export async function requestCourseAccessAction(
  courseId: unknown,
  message?: unknown,
): Promise<CourseAccessActionResult> {
  try {
    const user = await requireCourseRequester();
    const id = validId(courseId);
    if (!id) return fail("That course does not exist, or is not available to you.");

    // Concurrent, not sequential: none of the three depends on another's result,
    // and at ~245 ms per Neon round trip (docs/SUBJECT_SECTIONS.md appendix) a
    // serial chain here would cost three quarters of a second before the first
    // check even ran.
    const [course, activeCourseId, existing] = await Promise.all([
      getCourse(id),
      getActiveCourseId(),
      getOwnRequest(user.id, id),
    ]);

    if (!course) return fail("That course does not exist, or is not available to you.");

    // FEATURE 8 (prerequisites). Evaluated SERVER-SIDE here, not only on the page
    // that renders the button: this action is a plain HTTP POST target, so a
    // student who never loaded the catalog can still call it. It is issued after
    // the three reads above rather than alongside them because it needs
    // `activeCourseId` — the open course is never prerequisite-gated, and asking
    // without that fact would evaluate a course that cannot be constrained.
    // Returns the unconstrained verdict in one query for a course with no rules,
    // which is every course until an admin authors one.
    const prerequisites = await evaluateCoursePrerequisites(
      user.id,
      id,
      activeCourseId,
      user.role,
    );

    const eligibility = canRequestAccess({
      courseId: id,
      activeCourseId,
      role: user.role,
      requestStatus: existing?.status ?? null,
      prerequisites,
    });
    if (!eligibility.canRequest) return fail(REFUSAL_MESSAGE[eligibility.refusal]);

    const written = await upsertRequest({
      studentId: user.id,
      courseId: id,
      message: normaliseRequestMessage(message),
    });
    // False means the conflict branch was fenced off by `status <> 'approved'`,
    // i.e. an approval landed between the read above and this write. Reporting
    // the truth is better than claiming a request was filed that was not.
    if (!written) return fail(REFUSAL_MESSAGE.already_approved);

    revalidate(id);
    return { ok: true, status: "pending" };
  } catch (error) {
    return toFailure(error);
  }
}

/** Shared body of approve and reject — they differ only in the status written. */
async function decide(
  requestId: unknown,
  status: "approved" | "rejected",
  note: unknown,
): Promise<CourseAccessActionResult> {
  try {
    // Role check FIRST, before the row is even read, so a student probing this
    // action with a guessed id learns nothing about whose request it is or
    // whether it exists.
    const user = await requireCourseApprover();
    const id = validId(requestId);
    if (!id) return fail("That request no longer exists.");

    const row = await getRequestById(id);
    if (!row) return fail("That request no longer exists.");

    const eligibility = canDecideRequest({
      deciderId: user.id,
      deciderRole: user.role,
      requesterId: row.studentId,
      currentStatus: row.status,
    });
    if (!eligibility.canDecide) return fail(DECISION_REFUSAL_MESSAGE[eligibility.refusal]);

    const changed = await decideRequest({
      requestId: id,
      status,
      deciderId: user.id,
      // Reuses the student-note normaliser: same column length, same reason for
      // enforcing it server-side rather than trusting a maxLength attribute.
      note: normaliseRequestMessage(note),
    });
    // The compare-and-set in `decideRequest` matched nothing, so another admin
    // decided this row in the window since it was read. Do NOT report success:
    // the decision on file is not this admin's.
    if (!changed) return fail(DECISION_REFUSAL_MESSAGE.already_decided);

    revalidate(row.courseId);
    return { ok: true, status };
  } catch (error) {
    return toFailure(error);
  }
}

/** Grant access. This is the act that puts a course in front of a student. */
export async function approveCourseAccessAction(
  requestId: unknown,
  note?: unknown,
): Promise<CourseAccessActionResult> {
  return decide(requestId, "approved", note);
}

/**
 * Refuse access. The row is KEPT rather than deleted, so the student sees a
 * decision instead of their request silently vanishing, and so the audit record
 * of who refused survives.
 */
export async function rejectCourseAccessAction(
  requestId: unknown,
  note?: unknown,
): Promise<CourseAccessActionResult> {
  return decide(requestId, "rejected", note);
}
