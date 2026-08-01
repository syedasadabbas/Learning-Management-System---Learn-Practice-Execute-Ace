// =============================================================================
// GET /api/admin/activity/export  —  auth level "admin". CSV compliance export.
// Owner: the activity-logs stream.
// -----------------------------------------------------------------------------
// THE EXPORT IS AN ACT, NOT A VIEW, AND IT IS RECORDED BEFORE IT HAPPENS.
//
// A downloaded file is more sensitive than the table it came from: the table stores
// no names and no email addresses (src/db/schema.activity.ts), and the export joins
// them in — so the CSV leaves this system carrying identities the database
// deliberately does not keep next to the events. It then lives in a downloads
// folder, an inbox, a shared drive, outside every control this application has.
//
// So the order of operations is deliberate and is the same pre-write ordering the
// mail ledger uses for the same reason (src/db/schema.queue.ts:35-47):
//
//   1. authorise;
//   2. validate the filter;
//   3. WRITE the `activity_export` row, recording who, when, with what filter and
//      how many rows;
//   4. only then read the rows and emit the bytes.
//
// IF STEP 3 FAILS, THE EXPORT DOES NOT HAPPEN — 503, no bytes. That is the whole
// point of putting it before step 4: if the pre-write fails, nothing has left the
// building, so refusing is completely safe; if it were written afterwards, a
// failure would leave data exported with no record of the export, which is the
// exact state an audit trail exists to make impossible. The cost — an admin cannot
// export while the database is unwell — is acceptable, because the same database
// failure would have prevented reading the rows anyway.
//
// The refusal is itself recorded where it can be: `activity_export_denied` is
// written when the filter is rejected (a database that can take that row is a
// database that could have taken the export row). When the pre-write itself is what
// failed, there is by definition nowhere to record it, and the response says so
// rather than pretending otherwise.
// =============================================================================

import { apiError, apiGuard } from "@/lib/guard";
import {
  MAX_EXPORT_ROWS,
  csvFilename,
  exportActivity,
  filterToQuery,
  parseActivityFilter,
  recordActivity,
  toCsv,
} from "@/lib/activity";
import { originFromRequest } from "@/lib/activity/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard("admin");
  if (!gate.ok) return gate.response;
  const admin = gate.user;

  const url = new URL(request.url);
  const origin = originFromRequest(request);

  // The export path raises the row ceiling: a compliance export is expected to be
  // large. It is still bounded — MAX_EXPORT_ROWS, roughly 3 MB of this shape, which
  // one serverless invocation can produce inside its wall-clock limit.
  const parsed = parseActivityFilter(url.searchParams, {
    maxLimit: MAX_EXPORT_ROWS,
    defaultLimit: MAX_EXPORT_ROWS,
  });

  if (!parsed.ok) {
    // A refused export is still an attempt to take data out, and is recorded as
    // one. Not detached: if this row cannot be written the caller gets a 503 from
    // the throw, which is honest — the alternative is a silent gap in the trail on
    // the one path an operator probing the export would take.
    await recordActivity(
      {
        action: "activity_export_denied",
        actorId: admin.id,
        actorRole: admin.role,
        status: "failure",
        entityType: "activity_log",
        errorCode: parsed.code,
        origin,
      },
    );
    return apiError(400, parsed.error, parsed.code);
  }

  const filter = parsed.filter;
  const rows = await exportActivity(filter);

  // STEP 3 — before any bytes. `filterQuery` records exactly what was taken, so a
  // later reviewer can reproduce the same selection rather than guess at it.
  try {
    await recordActivity(
      {
        action: "activity_export",
        actorId: admin.id,
        actorRole: admin.role,
        entityType: "activity_log",
        details: {
          exportedRows: rows.length,
          truncated: rows.length >= filter.limit,
          // A query string, not the parsed object: it is short, reproducible, and
          // contains only filter values from a closed vocabulary plus integers and
          // ISO instants. (`filterToQuery` omits paging.)
          filterQuery: filterToQuery(filter).toString() || "(unfiltered)",
        },
        origin,
      },
    );
  } catch (error) {
    // FAIL CLOSED. See this file's header: no record, no export.
    console.error("[activity] refusing an export because it could not be recorded:", error);
    return apiError(
      503,
      "The export was not performed: the audit trail could not record it, and an " +
        "unrecorded bulk export of the audit trail is not permitted. Try again once " +
        "the database is reachable.",
      "export_unrecordable",
    );
  }

  const filename = csvFilename();
  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      // `text/csv; charset=utf-8` with an explicit charset: without it Excel on a
      // non-UTF-8 locale mis-decodes any non-ASCII name in the actor column.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // An audit export must never be cached by a proxy or by the browser: the
      // whole file is other people's activity.
      "cache-control": "no-store, private",
      // Belt and braces against a browser sniffing the CSV as something renderable.
      "x-content-type-options": "nosniff",
    },
  });
}
