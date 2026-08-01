// =============================================================================
// GET /api/instructor/analytics/advanced  —  staff only
// -----------------------------------------------------------------------------
// The feature-7 metrics as JSON: engagement, the daily series, the activity
// heatmap, problem difficulty, the grade distribution and the risk ranking.
//
// PATH: THE ROADMAP SAID `/api/analytics/[metric]`. IT IS HERE INSTEAD, AND THE
// REASON IS AUTHORIZATION, NOT TASTE.
//   * `/api/instructor/**` is already a protected prefix in src/middleware.ts
//     (required: "instructor"), so this endpoint is rejected at the edge for a
//     student without editing that table. A new top-level `/api/analytics` prefix
//     is matched by NOTHING in it, and would have reached the handler
//     unauthenticated with only this file's own guard between a student and
//     cohort-wide data. Middleware is defence in depth here, but shipping a route
//     that deliberately opts out of it to match a path in a planning document is
//     the wrong trade.
//   * It sits beside the existing `GET /api/instructor/analytics`, which is where
//     someone looking for analytics JSON will look.
// A `[metric]` dynamic segment was also dropped: the whole payload is ONE
// statement, so per-metric routes would turn one round trip into one per metric
// for a caller wanting the dashboard — the opposite of this feature's point.
//
// AUTH LEVEL IS READ FROM THE FROZEN CONTRACT, NOT RESTATED. There is no
// ROUTE_AUTH key for this path (src/lib/contracts/api.ts is Wave-0 frozen and not
// this stream's to edit), so the level is taken from its parent route
// `GET  /api/instructor/analytics` via `authLevelFor`. If shared-contracts ever
// re-levels analytics, this endpoint follows automatically instead of silently
// keeping a stale literal. `apiGuard` refuses a student with a 403 envelope and an
// anonymous caller with a 401.
//
// NO EMAIL ADDRESSES IN THE RESPONSE. The risk rows carry `studentId` and `name`
// only; nothing in this payload has an email field to begin with (see
// src/lib/analytics/privacy.ts for the decision), and the response is asserted
// against that in tests/e2e/analytics/analytics.spec.ts.
// =============================================================================

import { apiGuard, apiOk } from "@/lib/guard";
import { getAdvancedAnalytics } from "@/lib/analytics";
import { authLevelFor } from "@/lib/instructor/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Spelling matches ROUTES exactly, including the double space after GET. */
const PARENT_ROUTE_KEY = "GET  /api/instructor/analytics" as const;

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard(authLevelFor(PARENT_ROUTE_KEY));
  if (!gate.ok) return gate.response;

  // Same parse as the parent route and both pages: a non-integer, zero, negative
  // or absent ?cohort= means "all cohorts" rather than an error. An analytics URL
  // someone hand-edited should show the platform-wide view, not a 400.
  const raw = new URL(request.url).searchParams.get("cohort");
  const parsed = raw === null ? null : Number(raw);
  const cohortId =
    parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  const advanced = await getAdvancedAnalytics(cohortId);
  return apiOk(advanced);
}
