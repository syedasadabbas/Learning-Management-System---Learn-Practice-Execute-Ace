// =============================================================================
// GET /api/assignments/ingest-status  —  ROUTE_AUTH: "instructor"
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// The machine-readable half of the operator surface. The page at
// /assignments/ingest-status is what a human reads; this exists so that an e2e
// spec, an uptime check or a future dashboard can assert on the same facts
// without scraping markup.
//
// "instructor" (ROLES_SATISFYING.instructor is ["instructor", "admin"]) rather
// than "admin": an instructor is the person who chases a student whose response
// did not arrive, and telling them "ask an admin why" is the failure this surface
// exists to end. A student must not see it — the skipped-row samples carry other
// respondents' email addresses.
//
// READ-ONLY. It does not trigger an ingest. A GET that writes is the CSRF hole
// the manual-ingest route's header warns about; the trigger stays a POST.
//
// NOT IN THE FROZEN ROUTE_AUTH MAP (src/lib/contracts/api.ts) — that is the
// shared-contracts stream's file. Same precedent as /api/stand-in/**: the
// authorization decision is made here in the handler and written down above.
// Note it DOES sit under the "/api/assignments" prefix, which src/middleware.ts
// already gates at "instructor", so the guard below is defence in depth rather
// than the only gate.
// =============================================================================

import { apiGuard, apiOk } from "@/lib/guard";
import { getIngestStatus } from "@/lib/submissions/ingest-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const status = await getIngestStatus();

  return apiOk({
    // False when the run table could not be read at all. Surfaced rather than
    // flattened into an empty list, because "no runs recorded" and "the report
    // store is unavailable" call for completely different actions.
    available: status.available,
    assignments: status.rows,
    /** Counts an operator would otherwise compute by eye. */
    summary: {
      total: status.rows.length,
      neverRun: status.rows.filter((r) => r.lastRun === null).length,
      lastRunAborted: status.rows.filter((r) => r.lastRun?.aborted != null).length,
      sheetUnconfigured: status.rows.filter((r) => !r.sheetConfigured).length,
      standInSheets: status.rows.filter((r) => r.sheetIsStandIn).length,
    },
  });
}
