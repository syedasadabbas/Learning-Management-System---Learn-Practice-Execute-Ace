// =============================================================================
// SESSION-BOUND GUARDS for the course access stream.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// `policy.ts` decides; this file supplies the decider with a real session and
// turns a refusal into something a server action can return. Split in two so the
// rules stay unit-testable without a session (see policy.test.ts), which is the
// same split `src/lib/videos/access.ts` makes between `canCurateVideos` and
// `requireVideoCurator`.
//
// EVERY EXPORTED SERVER ACTION IN THIS STREAM OPENS WITH ONE OF THESE. Once
// Next.js compiles an action, the export IS a public HTTP POST endpoint — the
// button that calls it is markup, not a control. An action that reads the
// session but does not check the role is an authenticated privilege escalation,
// which is precisely the "student self-approves" path this stream has to close.
// =============================================================================

import { getSessionUser, type AuthUser } from "@/lib/guard";

import { canDecideRequests } from "./policy";

/**
 * Thrown by the guards below and caught by each action's `catch`.
 *
 * Actions refuse by throwing rather than redirecting: `redirect()` inside a
 * mutation throws away the admin's place in the queue, and a raw thrown Error
 * reaches the browser as a generic "unexpected response" that tells nobody
 * whether the decision was recorded. The action converts this into a typed
 * result object instead. Same reasoning, and the same shape, as
 * `VideoForbiddenError` in src/lib/videos/access.ts:54.
 */
export class CourseAccessForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to course access requests.") {
    super(message);
    this.name = "CourseAccessForbiddenError";
  }
}

/**
 * Any signed-in user. Used by the student-facing request action, which needs an
 * identity but no privilege — the identity is the whole point, because the
 * action writes a row FOR THAT USER and never accepts a student id from the
 * caller. A `studentId` parameter on a request action would let any signed-in
 * user file requests as anyone else.
 */
export async function requireCourseRequester(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new CourseAccessForbiddenError("Not signed in.");
  return user;
}

/**
 * An admin. Used by the approve/reject actions.
 *
 * This is the coarse gate. It is NOT the whole check: `canDecideRequest` in
 * policy.ts additionally refuses self-approval and double-decision, and the
 * actions call it after loading the row. Passing this guard means "you are the
 * kind of person who decides requests", not "you may decide THIS request".
 */
export async function requireCourseApprover(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new CourseAccessForbiddenError("Not signed in.");
  if (!canDecideRequests(user.role)) throw new CourseAccessForbiddenError();
  return user;
}
