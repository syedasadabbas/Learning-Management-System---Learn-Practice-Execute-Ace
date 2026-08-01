// =============================================================================
// GET /api/weeks/:weekId — ROUTE_AUTH "student". Owner: course-content stream.
// -----------------------------------------------------------------------------
// One week, with its lectures, GATED. A locked week returns 403 `week_locked`
// with the reason and NO lecture data — the reason is safe to disclose (it is the
// same sentence the student sees on the week list) but the content is not.
//
// An unknown week id returns 404, identical to a week belonging to another course,
// so the endpoint cannot be used to discover which ids exist.
// =============================================================================

import { gateWeek, getLectureSummaries } from "@/components/course/data";
import { ROUTE_AUTH } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  // Next.js 15: route-handler params are a Promise.
  context: { params: Promise<{ weekId: string }> },
): Promise<Response> {
  const gate = await apiGuard(ROUTE_AUTH["GET  /api/weeks/:weekId"]);
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

    const lectureList = await getLectureSummaries(result.week.id);

    return apiOk({
      week: result.week,
      lock: result.lock,
      lectures: lectureList,
    });
  } catch (error) {
    console.error(`GET /api/weeks/${weekId} failed`, error);
    return apiError(500, "Could not load the week.", "week_read_failed");
  }
}
