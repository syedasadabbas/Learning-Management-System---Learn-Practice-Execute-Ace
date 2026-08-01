// =============================================================================
// GET /api/leaderboard/me  —  ROUTE_AUTH: "student"  ("signed in", any role)
// Owner: leaderboard stream. Path is fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// The viewer's own standing only. Takes no parameters at all: "me" is the
// session, never a query string. Accepting a `studentId` here would turn a
// student-scoped route into a way to read any classmate's full score breakdown.
//
// Returns `data: null` (200, not 404) when the viewer has no leaderboard row:
//   - every instructor and admin, who have no cohort and no standing;
//   - a student who has not been graded yet.
// A 404 would make the client treat a perfectly normal "not ranked yet" state as
// an error; null lets it render the real message.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { getMyStanding } from "@/lib/leaderboard/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  try {
    const standing = await getMyStanding(gate.user);
    return apiOk(standing);
  } catch (error) {
    console.error("[leaderboard] GET /api/leaderboard/me failed", error);
    return apiError(500, "Could not load your standing.", "leaderboard_read_failed");
  }
}
