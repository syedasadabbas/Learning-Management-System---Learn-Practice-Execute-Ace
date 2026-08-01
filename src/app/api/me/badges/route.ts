// =============================================================================
// GET /api/me/badges  —  guard: "student" ("signed in", any role)
// Owner: badges stream. Roadmap: IMPLEMENTATION_ROADMAP.md:263.
// -----------------------------------------------------------------------------
// The VIEWER'S OWN badges, plus the whole catalogue with each entry marked earned
// or not. Takes no parameters at all: "me" is the session, never a query string.
// Accepting a `studentId` here would turn a student-scoped route into a way to read
// any classmate's achievement history — the same rule
// src/app/api/leaderboard/me/route.ts:5-8 states for standings.
//
// NOT LISTED IN `ROUTES` (src/lib/contracts/api.ts). That map's own header says
// add-on routes are "Declared here, once, by the contracts owner — NOT by the
// streams that implement them", and it is a frozen Wave 0 seam being edited
// concurrently by seven other agents in this wave. Three earlier streams shipped
// guarded routes that the map did not list and the coordinator added them at
// integration; the same applies here.
//
// TODO(shared-contracts): add
//   "GET  /api/me/badges": "badges",
//   "GET  /api/badges": "badges",
// to ROUTES and ROUTE_AUTH (both "student"). Enforcement does not change — both
// handlers already call `apiGuard("student")` — but until they are listed, the
// `Record<RouteKey, RouteAuth>` exhaustiveness check cannot notice a badges route
// that forgot to authorize itself.
// =============================================================================

import { getBadgeView, toBadgeViewJson } from "@/lib/badges";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  try {
    // `evaluate` mirrors the page (src/app/(app)/badges/page.tsx): a student's own
    // read re-evaluates the criteria, which is the backfill path argued for in
    // src/lib/badges/queries.ts:60-79; a staff read does not write.
    const view = await getBadgeView(gate.user.id, {
      evaluate: gate.user.role === "student",
    });
    return apiOk(toBadgeViewJson(view));
  } catch (error) {
    console.error("[badges] GET /api/me/badges failed", error);
    return apiError(500, "Could not load your achievements.", "badges_read_failed");
  }
}
