// =============================================================================
// POST /api/instructor/submissions/:id/grade  —  ROUTE_AUTH: "instructor"
// -----------------------------------------------------------------------------
// THE MOST SENSITIVE ENDPOINT IN THIS STREAM. It writes a score, and a score
// feeds the leaderboard and the student's final grade. A student who reaches it
// can grade themselves, so the guard is the first statement and there is no path
// through this handler that reaches `applyGrade` without it.
//
// `apiGuard("instructor")` returns 401 when unauthenticated and 403 when signed
// in as a student. `ROLES_SATISFYING.instructor` admits admins, deliberately: an
// admin covering for an instructor should not need a role change to grade.
//
// The path `:id` and the body's `submissionId` must agree. Trusting the body
// alone would let a request addressed to submission 5 write submission 6, and
// trusting the path alone would silently ignore a mismatched body.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { authLevelFor } from "@/lib/instructor/access";
import { applyGrade, GradeError, parseGradePayload } from "@/lib/instructor/grading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_KEY = "POST /api/instructor/submissions/:id/grade" as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await apiGuard(authLevelFor(ROUTE_KEY));
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return apiError(400, "Invalid submission id.", "invalid_id");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  // Fill in submissionId from the path so a client may omit it, but refuse a
  // body that names a DIFFERENT submission than the URL.
  const candidate =
    body && typeof body === "object"
      ? { ...(body as Record<string, unknown>) }
      : {};
  if (candidate.submissionId === undefined) {
    candidate.submissionId = submissionId;
  } else if (Number(candidate.submissionId) !== submissionId) {
    return apiError(
      400,
      "Body submissionId does not match the URL.",
      "submission_id_mismatch",
    );
  }

  // gradeSubmissionSchema: stars 1..5 required, score 0..40 optional,
  // feedback <= 4000 chars. Bounds live in the frozen contract, not here.
  const parsed = parseGradePayload(candidate);
  if (!parsed.ok) {
    return apiError(400, parsed.error, "validation_failed");
  }

  try {
    const result = await applyGrade(parsed.data, gate.user.id);
    return apiOk(result);
  } catch (error) {
    if (error instanceof GradeError) {
      return apiError(error.status, error.message, error.code);
    }
    console.error("[instructor-admin] grade write failed", error);
    return apiError(500, "The grade could not be saved.", "grade_failed");
  }
}
