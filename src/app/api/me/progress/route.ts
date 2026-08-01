// =============================================================================
// GET /api/me/progress — owned by the progress-tracking stream.
// -----------------------------------------------------------------------------
// Contract: `ROUTES["GET  /api/me/progress"]`, `ROUTE_AUTH` = "student".
// Response: `ApiResult<WeekProgress[]>` (the frozen envelope from contracts/api).
//
// SECURITY: the student id comes from the SESSION and from nowhere else. There is
// deliberately no `?studentId=` parameter to honour — accepting one would turn a
// self-service endpoint into a read of any classmate's grades, and no amount of
// "but we check it matches" is as safe as never reading it. Staff who need
// another student's progress use the instructor-admin routes.
// =============================================================================

import type { WeekProgress } from "@/lib/contracts/events";
import { ROUTE_AUTH } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { getWeekProgress } from "@/lib/progress/read-model";

/** Pulled from the frozen map so the route and the contract cannot drift. */
const REQUIRED_AUTH = ROUTE_AUTH["GET  /api/me/progress"];

// Progress changes on every quiz submission and every ingest, so a cached
// response would show a student a stale score right after they earned it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  try {
    const weeks: WeekProgress[] = await getWeekProgress(gate.user.id);
    return apiOk(weeks);
  } catch (err) {
    // Log server-side, return a generic message: a driver error string can carry
    // the connection host and the failing SQL.
    console.error("[GET /api/me/progress] failed", err);
    return apiError(500, "Could not load your progress.", "progress_read_failed");
  }
}
