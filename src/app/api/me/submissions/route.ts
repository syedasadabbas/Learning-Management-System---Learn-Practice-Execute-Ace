// =============================================================================
// GET /api/me/submissions — the student's own submission history.
// -----------------------------------------------------------------------------
// Owned by the submissions stream per the frozen ROUTES map. Added at integration
// because the coordinator's file allowlist for that agent listed the stream's
// other three routes and omitted this one, so the handler was never written even
// though the route is in the contract and its read model was complete.
//
// The student id comes from the session ONLY. ROUTE_AUTH marks this "student",
// and accepting a ?studentId= parameter would turn a self-service endpoint into a
// read of any classmate's grades and feedback.
// =============================================================================

import { apiGuard, apiError, apiOk } from "@/lib/guard";
import { ROUTE_AUTH } from "@/lib/contracts/api";
import { getAssignmentHistory } from "@/lib/submissions/history";

// Reads per-student rows, so there is nothing cacheable here.
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node-postgres needs TCP sockets

export async function GET(): Promise<Response> {
  // Level read out of the frozen map rather than restated as "student", so a
  // re-levelling in shared-contracts propagates here automatically.
  const gate = await apiGuard(ROUTE_AUTH["GET  /api/me/submissions"]);
  if (!gate.ok) return gate.response;

  try {
    return apiOk(await getAssignmentHistory(gate.user.id));
  } catch (error) {
    console.error("[api] GET /api/me/submissions failed", {
      studentId: gate.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError(500, "Could not load your submissions.", "internal_error");
  }
}
