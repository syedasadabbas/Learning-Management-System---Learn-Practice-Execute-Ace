// =============================================================================
// GET /api/weeks/:weekId/assignment  —  ROUTE_AUTH: "student"
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// "student" in ROUTE_AUTH means "signed in, any role" (ROLES_SATISFYING.student
// is student + instructor + admin), so `apiGuard("student")` is the correct gate
// and an instructor previewing the assignment is allowed through it.
//
// The submission returned is ALWAYS the caller's own: the student id comes from
// `gate.user.id`, never from a query parameter. There is deliberately no
// ?studentId= escape hatch — that is what the instructor-admin stream's
// /api/instructor/submissions route is for, and adding one here would be an
// IDOR that no role check could catch.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { getAssignmentForWeek } from "@/lib/submissions/history";

export const runtime = "nodejs";
// Depends on the session and on live submission state; never cache.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ weekId: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  // Next.js 15: route params are async.
  const { weekId: rawWeekId } = await params;
  const weekId = Number(rawWeekId);
  if (!Number.isInteger(weekId) || weekId <= 0) {
    return apiError(400, `"${rawWeekId}" is not a valid week id.`, "invalid_week_id");
  }

  const assignment = await getAssignmentForWeek(weekId, gate.user.id);
  if (!assignment) {
    return apiError(404, `Week ${weekId} has no assignment.`, "assignment_not_found");
  }

  return apiOk(assignment);
}
