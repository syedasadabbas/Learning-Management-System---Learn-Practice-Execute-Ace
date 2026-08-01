// =============================================================================
// GET /api/problems  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// Owner: coding-problems stream. The path is fixed by ROUTES in
// src/lib/contracts/api.ts; this stream did not invent it.
//
// Query parameters, all optional:
//   bank  = "practice" | "interview"   (default "practice")
//   track = one of PROBLEM_TRACKS
//   level = "beginner" | "intermediate" | "advanced"
//
// An unrecognised value is a 400 rather than a silent fall-back to "everything".
// Silently widening a filter is how a student is shown advanced problems after
// asking for beginner ones and concludes the filter is broken.
//
// WHAT THIS RESPONSE DOES NOT CONTAIN: statements, tests of any kind, and reference
// solutions. Every row is built by `toProblemSummary`, whose output type declares
// none of them — see src/lib/problems/payload.ts and its test.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { isLevel, isProblemBank, isProblemTrack } from "@/lib/problems";
import { listProblems } from "@/lib/problems/service";

export const runtime = "nodejs";
// The payload carries this student's derived solved state and lock state. Never
// cache it.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;

  const rawBank = params.get("bank") ?? "practice";
  if (!isProblemBank(rawBank)) {
    return apiError(400, 'bank must be "practice" or "interview".', "invalid_bank");
  }

  const rawTrack = params.get("track");
  if (rawTrack !== null && !isProblemTrack(rawTrack)) {
    return apiError(400, `"${rawTrack}" is not a known track.`, "invalid_track");
  }

  const rawLevel = params.get("level");
  if (rawLevel !== null && !isLevel(rawLevel)) {
    return apiError(400, `"${rawLevel}" is not a proficiency level.`, "invalid_level");
  }

  const result = await listProblems({
    bank: rawBank,
    studentId: gate.user.id,
    track: rawTrack,
    level: rawLevel,
  });

  return apiOk(result);
}
