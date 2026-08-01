// =============================================================================
// SESSION-BOUND GUARD for the prerequisites stream.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// `policy.ts` decides; this file supplies the decider with a real session and
// turns a refusal into something a server action can return. The split exists so
// the rules stay unit-testable without a session — the same split
// src/lib/courses/access.ts:6 makes, and src/lib/videos/access.ts before it.
//
// EVERY EXPORTED SERVER ACTION IN THIS STREAM OPENS WITH THIS GUARD. Once Next.js
// compiles an action, the export IS a public HTTP POST endpoint; the button that
// calls it is markup, not a control. An action that reads the session but does not
// check the role is an authenticated privilege escalation — and the actions here
// author the rules that decide who may enter a course and grant the exceptions to
// them, so an unguarded one is a student writing their own entry conditions.
// =============================================================================

import { getSessionUser, type AuthUser } from "@/lib/guard";

import { canManagePrerequisites } from "./policy";

/**
 * Thrown by the guard below and caught by each action's `catch`.
 *
 * Actions refuse by THROWING and then converting, rather than redirecting:
 * `redirect()` inside a mutation throws away the admin's place in the console, and
 * a raw thrown Error reaches the browser as a generic "unexpected response" that
 * tells nobody whether the rule was saved. Same shape and same reasoning as
 * `CourseAccessForbiddenError` (src/lib/courses/access.ts:33).
 */
export class PrerequisiteForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to prerequisite rules.") {
    super(message);
    this.name = "PrerequisiteForbiddenError";
  }
}

/**
 * An admin. Used by every action in this stream — authoring a rule and granting an
 * override are both admin acts, for the reason `PREREQUISITE_ADMIN_AUTH` in
 * policy.ts states.
 *
 * This is the COARSE gate. It is not the whole check: `canGrantOverride` in
 * policy.ts additionally refuses an unexplained override, a duplicate one, and one
 * that would grant nothing, and the actions call it after loading the rows.
 * Passing this guard means "you are the kind of person who edits prerequisites",
 * not "you may make THIS edit".
 */
export async function requirePrerequisiteAdmin(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new PrerequisiteForbiddenError("Not signed in.");
  if (!canManagePrerequisites(user.role)) throw new PrerequisiteForbiddenError();
  return user;
}
