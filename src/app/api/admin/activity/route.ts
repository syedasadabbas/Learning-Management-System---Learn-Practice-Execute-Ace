// =============================================================================
// GET /api/admin/activity  —  auth level "admin"
// Owner: the activity-logs stream.
// -----------------------------------------------------------------------------
// WHY A JSON ENDPOINT WHEN THE PAGE ALREADY RENDERS THE TABLE. Two reasons, both
// about the log being usable by the people who need it rather than only by someone
// clicking:
//
//   1. an institutional audit asks for a query, not a screenshot. `?actor=7
//      &action=login_failed&days=30` is something a compliance officer can be given
//      as a URL, and something a script can poll for a fraud-detection alert;
//   2. it is the seam the e2e specs assert against, so the filter contract is
//      tested without depending on the rendered DOM.
//
// ADMIN, NOT INSTRUCTOR — the same argument as GET /api/admin/jobs, and stronger:
// this endpoint returns every act of every user, including instructors' own grading
// decisions. `ROLES_SATISFYING.instructor` admits admins but not the reverse, so
// "instructor" here would let colleagues audit each other.
//
// READ-ONLY. There is deliberately NO POST that writes a log entry. A route that
// accepted a hand-made row would make the trail forgeable by anyone who could reach
// it; entries are written only by server-side code holding the actor from
// `apiGuard`/`requireRole`, never from a request body. See record.ts's header.
//
// PAGE VIEWS OF THE LOG ARE NOT THEMSELVES LOGGED. Bulk EXPORT is (see
// ./export/route.ts), because egress of the joined actor identities is an act.
// Recording every read would multiply the largest table in the database by its own
// admin traffic and, worse, an admin investigating an incident would spend the
// investigation writing rows about the investigation.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  activitySummary,
  listActivity,
  parseActivityFilter,
} from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List events, newest first, plus the headline counts.
 *
 * Every filter is validated by `parseActivityFilter`; an unrecognised value is a
 * 400, never a silently widened query. `limit` is clamped to MAX_PAGE_SIZE inside
 * the parser, so no caller can ask for the whole table.
 *
 * Paging is a keyset cursor (`?before=<id>`), returned as `nextCursor`. Not OFFSET:
 * see query.ts for why an offset window can silently skip a row under concurrent
 * inserts, which on an audit surface is the worst available defect.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard("admin");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const parsed = parseActivityFilter(url.searchParams);
  if (!parsed.ok) {
    return apiError(400, parsed.error, parsed.code);
  }

  const [page, summary] = await Promise.all([
    listActivity(parsed.filter),
    activitySummary(),
  ]);

  return apiOk({
    summary,
    rows: page.rows,
    nextCursor: page.nextCursor,
    paging: { limit: parsed.filter.limit, defaultLimit: DEFAULT_PAGE_SIZE, maxLimit: MAX_PAGE_SIZE },
  });
}
