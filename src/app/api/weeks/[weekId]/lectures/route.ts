// =============================================================================
// GET /api/weeks/:weekId/lectures — ROUTE_AUTH "student".
// Owner: course-content stream.
// -----------------------------------------------------------------------------
// The lecture INDEX for a week (titles and flags, not bodies). Gated by the same
// `gateWeek` the page uses, because a separate endpoint that forgot the check
// would be a complete bypass of the week lock.
// =============================================================================

import { gateWeek, getLectureSummaries } from "@/components/course/data";
import { ROUTE_AUTH } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ weekId: string }> },
): Promise<Response> {
  const gate = await apiGuard(ROUTE_AUTH["GET  /api/weeks/:weekId/lectures"]);
  if (!gate.ok) return gate.response;

  const { weekId: raw } = await context.params;
  const weekId = Number(raw);
  if (!Number.isInteger(weekId) || weekId <= 0) {
    return apiError(400, "weekId must be a positive integer.", "bad_week_id");
  }

  try {
    const result = await gateWeek(gate.user.id, weekId);

    if (!result.ok && result.kind === "not_found") {
      return apiError(404, "Week not found.", "week_not_found");
    }
    if (!result.ok) {
      return apiError(
        403,
        result.lock.reason ?? "This week is not yet available.",
        "week_locked",
      );
    }

    return apiOk({
      weekId: result.week.id,
      weekNumber: result.week.weekNumber,
      lectures: await getLectureSummaries(result.week.id),
    });
  } catch (error) {
    console.error(`GET /api/weeks/${weekId}/lectures failed`, error);
    return apiError(500, "Could not load the lectures.", "lectures_read_failed");
  }
}
