// =============================================================================
// STAFF ACCESS HELPERS — instructor-admin stream.
// -----------------------------------------------------------------------------
// AUTHORIZATION IS THE POINT OF THIS FILE. Nothing here compares a role string
// to a literal. Every decision is delegated to `roleSatisfies` in
// `@/lib/guard`, which in turn reads the frozen `ROLES_SATISFYING` table in
// `@/lib/contracts/api`. That indirection is what encodes the two rules an
// `if (role === "instructor")` check gets wrong:
//
//   * admin satisfies an instructor-scoped route (ROLES_SATISFYING.instructor
//     is ["instructor", "admin"]),
//   * instructor does NOT satisfy an admin-scoped one (ROLES_SATISFYING.admin
//     is ["admin"] alone).
//
// A student satisfies neither. A student who reaches the grading endpoint can
// grade themselves, so that refusal is the highest-value assertion in this
// stream's test suite (see access.test.ts).
//
// Three call shapes, three failure modes, all pointing at the same decision:
//   pages         -> requireRole()      from @/lib/guard  (redirects)
//   route handlers-> apiGuard()         from @/lib/guard  (401/403 envelope)
//   server actions-> requireStaffAction / requireAdminAction below (throws)
// =============================================================================

import {
  ROUTE_AUTH,
  type RouteAuth,
  type RouteKey,
} from "@/lib/contracts/api";
import { getSessionUser, roleSatisfies, type AuthUser } from "@/lib/guard";

/**
 * The four routes this stream owns, as they appear in the frozen route map.
 * Spelling matches `ROUTES` exactly (including the double space after `GET`)
 * so that `ROUTE_AUTH[key]` type-checks — a typo here is a compile error, not a
 * silently unguarded endpoint.
 */
export const INSTRUCTOR_ROUTE_KEYS = [
  "GET  /api/instructor/submissions",
  "POST /api/instructor/submissions/:id/grade",
  "GET  /api/instructor/students",
  "GET  /api/instructor/analytics",
] as const satisfies readonly RouteKey[];

export type InstructorRouteKey = (typeof INSTRUCTOR_ROUTE_KEYS)[number];

/**
 * The required auth level for one of this stream's routes, read from the frozen
 * contract rather than restated. If shared-contracts ever re-levels one of these
 * routes, the handlers follow automatically.
 */
export function authLevelFor(key: InstructorRouteKey): RouteAuth {
  return ROUTE_AUTH[key];
}

/** May a user with `role` reach `key`? Pure; unit-tested. */
export function canAccessRoute(
  key: InstructorRouteKey,
  role: string | null | undefined,
): boolean {
  return roleSatisfies(authLevelFor(key), role);
}

/**
 * Thrown by the server-action guards. Server actions have no response envelope
 * to fill in and a redirect out of a mutation is hostile (the user loses their
 * form state to a login page they do not need), so an action refuses by
 * throwing and the calling component renders the message.
 */
export class ForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function requireActionRole(required: RouteAuth): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new ForbiddenError("Not signed in.");
  if (!roleSatisfies(required, user.role)) throw new ForbiddenError();
  return user;
}

/** Guard for a server action an instructor OR an admin may perform. */
export function requireStaffAction(): Promise<AuthUser> {
  return requireActionRole("instructor");
}

/**
 * Guard for an admin-only server action (quiz/assignment CRUD, account
 * management, deadline config, report export). Deliberately "admin", not
 * "instructor": ROLES_SATISFYING.admin excludes instructors.
 */
export function requireAdminAction(): Promise<AuthUser> {
  return requireActionRole("admin");
}
