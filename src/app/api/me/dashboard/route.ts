// =============================================================================
// GET /api/me/dashboard — owned by the progress-tracking stream.
// -----------------------------------------------------------------------------
// Contract: `ROUTES["GET  /api/me/dashboard"]`, `ROUTE_AUTH` = "student".
// Response: `ApiResult<DashboardPayload>` in the frozen envelope.
//
// Same self-only rule as /api/me/progress: the id is read from the session, never
// from a query parameter. There is no `?studentId=` to honour, by design.
//
// Only `GET` and the route-segment config are exported — Next.js type-checks the
// export surface of a route file, so the payload type and its serialiser live in
// `@/lib/progress/dashboard`.
// =============================================================================

import { ROUTE_AUTH } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { getDashboard, serialiseDashboard } from "@/lib/progress/dashboard";

/** Pulled from the frozen map so the route and the contract cannot drift. */
const REQUIRED_AUTH = ROUTE_AUTH["GET  /api/me/dashboard"];

// A cached dashboard would show a stale score immediately after a quiz submit.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  try {
    const model = await getDashboard(gate.user.id);
    return apiOk(serialiseDashboard(model));
  } catch (err) {
    // Log server-side, return a generic message: driver errors can carry the
    // connection host and the failing SQL.
    console.error("[GET /api/me/dashboard] failed", err);
    return apiError(500, "Could not load your dashboard.", "dashboard_read_failed");
  }
}
