// =============================================================================
// GET /api/auth/me  —  ROUTE_AUTH: "student"  ("signed in", any role)
// -----------------------------------------------------------------------------
// Reads the row from the database rather than echoing the JWT, so a profile edit
// or a cohort assignment shows up immediately instead of waiting for the token to
// refresh (the cost of the adapter-free JWT strategy — see src/lib/auth.ts).
//
// The response goes through `toPublicUser`, whose return type has no
// passwordHash field, so the hash cannot be serialised out of here even by a
// careless later edit.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { toPublicUser } from "@/lib/auth";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const runtime = "nodejs";
// Session-dependent: never serve this from the full route cache.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const [row] = await db.select().from(users).where(eq(users.id, gate.user.id)).limit(1);
  if (!row) {
    // Valid signature, deleted user. The token outlives the row because there is
    // no session table to cascade the delete into.
    return apiError(401, "Account no longer exists.", "user_deleted");
  }

  return apiOk(toPublicUser(row));
}
