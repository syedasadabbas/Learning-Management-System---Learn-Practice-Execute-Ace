// =============================================================================
// POST /api/auth/logout  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// "student" in ROUTE_AUTH means "signed in": ROLES_SATISFYING.student lists all
// three roles, so an instructor or admin signing out passes the same guard. That
// is exactly why the guard reads the table instead of comparing role strings.
//
// POST only. A GET that destroys a session can be fired by any <img> tag on a
// third-party page.
// =============================================================================

import { signOut } from "@/lib/auth";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  try {
    // `redirect: false` — clear the cookie and answer in the ApiResult envelope
    // instead of 302-ing a fetch() caller.
    await signOut({ redirect: false });
  } catch (err) {
    console.error("[auth] logout failed:", (err as Error)?.name);
    return apiError(500, "Could not sign out.", "logout_failed");
  }

  return apiOk({ signedOut: true });
}
