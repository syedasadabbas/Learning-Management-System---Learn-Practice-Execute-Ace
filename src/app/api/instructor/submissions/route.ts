// =============================================================================
// GET /api/instructor/submissions  —  ROUTE_AUTH: "instructor"
// -----------------------------------------------------------------------------
// The grading queue, filterable by ?week= and ?status=.
//
// AUTHORIZATION. `apiGuard("instructor")` consults `ROLES_SATISFYING.instructor`
// = ["instructor", "admin"]. An admin is therefore allowed and a STUDENT IS
// REFUSED with 403 — not redirected, not given an empty list. A student who can
// read this queue can find their own submission id and post a grade to it.
//
// The auth level is not written as a literal twice: `authLevelFor` reads it out
// of the frozen ROUTE_AUTH map keyed by this file's route.
//
// An empty array is a valid, expected response. No Google Form URL is configured
// in seeded data, so nothing has been ingested and the queue starts empty.
// =============================================================================

import { apiGuard, apiOk } from "@/lib/guard";
import { authLevelFor } from "@/lib/instructor/access";
import {
  getGradingQueue,
  getQueueCounts,
  parseStatus,
  parseWeekNumber,
} from "@/lib/instructor/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_KEY = "GET  /api/instructor/submissions" as const;

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard(authLevelFor(ROUTE_KEY));
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const weekNumber = parseWeekNumber(url.searchParams.get("week"));
  // An unrecognised ?status= is ignored rather than rejected: the default
  // needs-review view is a safe answer, and a 400 on a stale bookmark is noise.
  const allStatuses = url.searchParams.get("status") === "all";

  const [rows, counts] = await Promise.all([
    getGradingQueue({ status, weekNumber, allStatuses }),
    getQueueCounts(),
  ]);

  return apiOk({
    rows,
    counts,
    filter: { status: status ?? null, week: weekNumber ?? null, allStatuses },
  });
}
