// =============================================================================
// ROUTE / PAGE GUARDS — owned by the auth stream, consumed by every other stream.
// -----------------------------------------------------------------------------
// This is the enforcement seam. Authorization decisions are NOT made with ad-hoc
// role comparisons anywhere in the app; they are made here, against the frozen
// `ROLES_SATISFYING` table in `src/lib/contracts/api.ts`. That table encodes two
// rules an `if (role === "instructor")` check would get wrong:
//
//   1. Staff satisfy student-scoped routes (an instructor can read a student
//      endpoint), so "student" means "signed in", not "role === student".
//   2. `cron` is satisfied by NO user role at all — `ROLES_SATISFYING.cron` is
//      the empty array. A logged-in admin must not be able to trigger the
//      scheduled sweep; only the CRON_SECRET bearer token can. See requireCron.
//
// Usage:
//   Server component / page :  const user = await requireRole("instructor");
//   Route handler           :  const gate = await apiGuard("instructor");
//                              if (!gate.ok) return gate.response;
//   Cron endpoint           :  const denied = requireCron(req); if (denied) return denied;
// =============================================================================

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import type { userRole } from "@/db/schema";
import {
  ROLES_SATISFYING,
  type ApiErr,
  type ApiOk,
  type RouteAuth,
} from "@/lib/contracts/api";

export type UserRole = (typeof userRole.enumValues)[number];

/**
 * The session user as the rest of the app consumes it.
 *
 * `id` is a NUMBER here, unlike `session.user.id` which Auth.js fixes as a
 * string (see src/types/next-auth.d.ts for why). Converting in this one place
 * means no stream has to remember to call `Number(...)` before a Drizzle
 * `eq(users.id, ...)` comparison.
 */
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  /** Null for instructors and admins — staff are not cohort-scoped. */
  cohortId: number | null;
}

/** Where an unauthenticated visitor is sent. */
export const LOGIN_PATH = "/login";

// ---------------------------------------------------------------------------
// The pure authorization decision (unit-tested in guard.test.ts)
// ---------------------------------------------------------------------------

/**
 * Does `role` satisfy a route requiring `required`?
 *
 * Delegates entirely to the frozen `ROLES_SATISFYING` table so that adding a
 * role or changing who may reach what is a single edit in the contract file.
 *
 * @param required the route's `RouteAuth` level, from `ROUTE_AUTH`
 * @param role     the signed-in user's role, or undefined/null when anonymous
 */
export function roleSatisfies(required: RouteAuth, role: string | null | undefined): boolean {
  if (required === "public") return true;
  if (!role) return false;
  return ROLES_SATISFYING[required].includes(role);
}

/**
 * Does a route requiring `required` need a signed-in user at all?
 *
 * `public` does not. `cron` does not either — and must not accept one: it is
 * satisfied by the shared secret only, which is exactly why its entry in
 * `ROLES_SATISFYING` is empty.
 */
export function requiresSession(required: RouteAuth): boolean {
  return required !== "public" && ROLES_SATISFYING[required].length > 0;
}

// ---------------------------------------------------------------------------
// Session reads
// ---------------------------------------------------------------------------

/** The current user, or null when there is no valid session. Never throws. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.role) return null;

  const id = Number(user.id);
  // A non-numeric id means a token from a different schema revision. Treat it as
  // no session rather than passing NaN into a query.
  if (!Number.isInteger(id) || id <= 0) return null;

  return {
    id,
    email: user.email ?? "",
    name: user.name ?? "",
    role: user.role,
    cohortId: user.cohortId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Page / server-component guards (redirect on failure)
// ---------------------------------------------------------------------------

/**
 * Return the signed-in user, or redirect to /login.
 *
 * `next` carries the originally requested path so the login form can send the
 * user back where they were headed.
 */
export async function requireUser(next?: string): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) redirect(loginUrl(next));
  return user;
}

/**
 * Return the signed-in user if their role satisfies `required`, otherwise
 * redirect: to /login when there is no session, or to /login?error=forbidden
 * when there is one but it is not privileged enough.
 *
 * A page requiring `"cron"` is a programming error — no browser session can
 * ever satisfy it — so that is rejected loudly instead of redirecting.
 */
export async function requireRole(required: RouteAuth, next?: string): Promise<AuthUser> {
  if (required === "cron") {
    throw new Error(
      "requireRole(\"cron\") is never satisfiable by a user session. Use requireCron(request).",
    );
  }

  const user = await getSessionUser();
  if (!user) redirect(loginUrl(next));
  if (!roleSatisfies(required, user.role)) redirect(`${LOGIN_PATH}?error=forbidden`);
  return user;
}

function loginUrl(next?: string): string {
  if (!next) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

// ---------------------------------------------------------------------------
// Route-handler guards (ApiResult envelope on failure, never a redirect)
// ---------------------------------------------------------------------------

/** `ApiOk` response in the frozen envelope. */
export function apiOk<T>(data: T, status = 200): Response {
  const body: ApiOk<T> = { ok: true, data };
  return Response.json(body, { status });
}

/** `ApiErr` response in the frozen envelope. */
export function apiError(status: number, error: string, code?: string): Response {
  const body: ApiErr = code ? { ok: false, error, code } : { ok: false, error };
  return Response.json(body, { status });
}

export type ApiGuardResult =
  | { ok: true; user: AuthUser }
  | { ok: false; response: Response };

/**
 * Route-handler equivalent of `requireRole`. Returns 401 when unauthenticated
 * and 403 when authenticated but under-privileged — a redirect would turn an
 * API call into an HTML login page, which fetch() callers cannot act on.
 */
export async function apiGuard(required: RouteAuth): Promise<ApiGuardResult> {
  if (required === "public") {
    const user = await getSessionUser();
    return user
      ? { ok: true, user }
      : { ok: false, response: apiError(401, "Not signed in.", "unauthenticated") };
  }

  if (required === "cron") {
    return {
      ok: false,
      response: apiError(
        403,
        "This endpoint is server-to-server only.",
        "cron_only",
      ),
    };
  }

  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: apiError(401, "Not signed in.", "unauthenticated") };
  }
  if (!roleSatisfies(required, user.role)) {
    return {
      ok: false,
      response: apiError(403, "You do not have access to this resource.", "forbidden"),
    };
  }
  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// Cron guard
// ---------------------------------------------------------------------------

/**
 * Guard for `RouteAuth: "cron"` endpoints (currently
 * `POST /api/cron/ingest-submissions`, owned by the submissions stream).
 *
 * Returns a Response to send when the request is NOT authorised, or null when it
 * is. No user role satisfies this — `ROLES_SATISFYING.cron` is empty — so the
 * only accepted credential is `Authorization: Bearer $CRON_SECRET`.
 *
 * Comparison is not constant-time. The secret is high-entropy and every attempt
 * costs a full HTTPS round trip, so a timing oracle is not the practical attack;
 * a weak secret is.
 */
export function requireCron(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed. An unset secret must not mean "everyone may trigger ingestion".
    return apiError(503, "Cron endpoint is not configured.", "cron_unconfigured");
  }
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (presented !== expected) {
    return apiError(401, "Invalid cron credentials.", "cron_unauthorised");
  }
  return null;
}
