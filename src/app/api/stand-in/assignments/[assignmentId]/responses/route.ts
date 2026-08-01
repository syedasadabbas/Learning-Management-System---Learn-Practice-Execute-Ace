// =============================================================================
// GET /api/stand-in/assignments/:assignmentId/responses  — the LOCAL STAND-IN
// for a published Google Sheet. Owner: submissions stream.
// -----------------------------------------------------------------------------
// THIS IS NOT GOOGLE. It emits a Google-Forms-SHAPED CSV that this repository
// manufactures, so that the ingestion pipeline has something real to fetch,
// parse, match and write while no Google Form exists. See the long header in
// src/lib/submissions/stand-in.ts for exactly what is real and what is not.
//
// WHY IT IS AN HTTP ENDPOINT AND NOT A FILE OR AN IN-PROCESS SHORTCUT
//
// The point is to exercise the REAL path. `fetchPublishedCsv` is the only part of
// ingestion that touches the network and it carries the SSRF allow-list, the
// 15_000 ms timeout, the redirect policy and the no-store cache rule
// (src/lib/submissions/fetch-csv.ts). Handing ingestion a string from disk would
// skip all of it and prove nothing about the transport. Loopback is on that
// allow-list already, and its comment says why: "so the e2e suite can serve a
// fixture CSV locally".
//
// It is also NOT a static file under public/, because the timestamps have to be
// positioned relative to `assignments.due_at`, which is computed from the cohort
// start date at seed time and differs per database. A committed .csv would be
// wildly early or wildly late depending on which database it met, and the
// lateness assertions would be accidental.
//
// WHY IT IS PUBLIC, AND HOW IT IS FENCED
//
// Ingestion fetches this over HTTP from the server itself with NO cookies, so it
// cannot be behind a session. That is a route serving seeded student emails
// without authentication, which is stated here rather than buried:
//
//   1. It 404s unless NODE_ENV is not "production", or SUBMISSIONS_STAND_IN_SHEET
//      is exactly "1". A production build therefore has no such endpoint, and
//      ingestion there reports `fetch_failed` — visible, not silent.
//   2. It emits ONE address, `student@codequeenshub.test`, a demo account created
//      by scripts/seed.ts with a password that is already committed to this
//      repository (DEMO_PASSWORD). It discloses nothing that `git log` does not.
//   3. It is read-only and takes no input beyond the assignment id.
//
// NOT IN THE FROZEN ROUTE_AUTH MAP (src/lib/contracts/api.ts), which is the
// shared-contracts stream's file and is not this stream's to edit. Same precedent
// and same reasoning as /api/account/dev-outbox and /api/account/password. The
// authorization decision is made here, in the handler, and written down above.
// Note also that the path deliberately avoids the "/api/assignments" prefix:
// src/middleware.ts gates that whole prefix at "instructor", which would make the
// endpoint unreachable by the very fetch it exists to serve.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, weeks } from "@/db/schema";
import { apiError } from "@/lib/guard";
import { buildStandInResponsesCsv } from "@/lib/submissions/stand-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** See fence (1) in the header. */
function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SUBMISSIONS_STAND_IN_SHEET === "1";
}

/** A 404 that does not confirm the route exists. */
function notFound(): Response {
  return apiError(404, "Not found.", "not_found");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  if (!enabled()) return notFound();

  const { assignmentId: rawId } = await params;
  const assignmentId = Number(rawId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) return notFound();

  const [row] = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      dueAt: assignments.dueAt,
      weekNumber: weeks.weekNumber,
    })
    .from(assignments)
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  if (!row) return notFound();

  const csv = buildStandInResponsesCsv({ dueAt: row.dueAt, weekNumber: row.weekNumber });

  return new Response(csv, {
    status: 200,
    headers: {
      // Google serves "text/csv" for a published sheet; matching it means the
      // ingestion path is not accidentally tolerant of a wrong content type.
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      // A blunt, machine-readable marker for anyone who finds this response in a
      // log or a proxy and needs to know it did not come from Google.
      "x-stand-in": "1",
    },
  });
}
