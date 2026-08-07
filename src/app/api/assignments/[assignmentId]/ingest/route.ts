// =============================================================================
// POST /api/assignments/:assignmentId/ingest  —  ROUTE_AUTH: "instructor"
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// SECURITY: this endpoint WRITES submission rows. ROUTE_AUTH in
// src/lib/contracts/api.ts marks it "instructor", and an earlier revision of this
// stream shipped it unauthenticated, which let any visitor trigger a server-side
// fetch and a batch of database writes. `apiGuard("instructor")` is therefore the
// FIRST statement in the handler, before the path parameter is even parsed —
// nothing about the request is acted on until the caller is known to be staff.
// `ROLES_SATISFYING.instructor` is ["instructor", "admin"], so an admin is also
// allowed; a student is not.
//
// This is the MANUAL trigger, for an instructor who wants a student's just-filed
// response to appear now rather than at the top of the hour. The scheduled sweep
// is a separate route with a separate credential — see
// /api/cron/ingest-submissions, which is "cron" and satisfied by NO user role.
// Splitting them is deliberate: the cron secret must not become a way for a
// browser session to write, and a logged-in admin must not be able to stand in
// for the scheduler.
//
// GET is not implemented on purpose. Ingestion is a write; exposing it on a GET
// would make it triggerable by an <img src> on any page a signed-in instructor
// visits (CSRF via a safe method).
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { ingestAssignment } from "@/lib/submissions/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Seconds (Vercel's unit for this export, not ours). Ingestion fetches a
 * published CSV with a 15_000 ms timeout and then writes one statement per row.
 */
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const { assignmentId: rawId } = await params;
  const assignmentId = Number(rawId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
    return apiError(400, `"${rawId}" is not a valid assignment id.`, "invalid_assignment_id");
  }

  // `triggeredBy: "manual"` is recorded on the operator surface
  // (/assignments/ingest-status). It matters there: "ingested 3 minutes ago" only
  // means the scheduler is alive if the scheduler is what did it.
  const report = await ingestAssignment(assignmentId, { triggeredBy: "manual" });

  if (report.aborted === "assignment_not_found") {
    return apiError(404, `No assignment with id ${assignmentId}.`, "assignment_not_found");
  }

  // Every other abort reason is a REPORTED NO-OP, not an error: a 200 with
  // `aborted: "no_csv_url"` is the honest answer while the Google Sheet URLs are
  // still unset (see the TODO(decision) in scripts/seed.ts). Returning 500 for
  // the seeded state would make a correctly-behaving system look broken and
  // would put the scheduled cron into permanent alarm.
  return apiOk({
    ...report,
    triggeredBy: { instructorId: gate.user.id, mode: "manual" as const },
  });
}
