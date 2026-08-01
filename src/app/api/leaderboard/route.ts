// =============================================================================
// GET /api/leaderboard  —  ROUTE_AUTH: "student"  ("signed in", any role)
// Owner: leaderboard stream. Path is fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// Query parameters (all optional, all narrowed — never trusted):
//   scope     = overall | week          default overall
//   weekId    = integer                 default the first week, only for scope=week
//   cohortId  = integer                 IGNORED for students (see queries.ts)
//   sort      = rank|name|total|quiz|assignment|participation|finalProject|stars
//   dir       = asc | desc              default depends on the column
//
// Response is the frozen `ApiResult<LeaderboardView>` envelope. `LeaderboardView`
// carries name + avatar + scores only — no email addresses, by construction of
// the row types in src/lib/leaderboard/types.ts.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { getLeaderboardView } from "@/lib/leaderboard/queries";
import { parseDirection, parseSortKey } from "@/lib/leaderboard/sorting";
import type { LeaderboardScope } from "@/lib/leaderboard/types";

export const runtime = "nodejs";
// Session- and cohort-dependent, and it changes on every grading event. Serving
// this from the full route cache would show one student another student's board.
export const dynamic = "force-dynamic";

/** Positive integer or null. Rejects "abc", "-1", "1.5" and "1e9" alike. */
function intParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function scopeParam(raw: string | null): LeaderboardScope {
  return raw === "week" ? "week" : "overall";
}

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;
  const sort = parseSortKey(params.get("sort"));

  try {
    const view = await getLeaderboardView(gate.user, {
      scope: scopeParam(params.get("scope")),
      cohortId: intParam(params.get("cohortId")),
      weekId: intParam(params.get("weekId")),
      sort,
      // Null means "use the column's natural direction" — resolved in the query
      // layer so the API and the page cannot disagree about the default.
      direction: parseDirection(params.get("dir")),
    });

    return apiOk(view);
  } catch (error) {
    console.error("[leaderboard] GET /api/leaderboard failed", error);
    return apiError(500, "Could not load the leaderboard.", "leaderboard_read_failed");
  }
}
