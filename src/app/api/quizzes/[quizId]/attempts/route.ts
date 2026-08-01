// =============================================================================
// GET /api/quizzes/:quizId/attempts  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// Owner: quizzes stream. Path is fixed by ROUTES in src/lib/contracts/api.ts.
//
// Returns the SIGNED-IN student's own attempts only. The student id comes from
// the session and goes into the WHERE clause — there is no query parameter a
// caller could use to ask for somebody else's history.
//
// No per-question detail here, therefore no explanations and no answer key: this
// is the summary the results view and the dashboard need (score, percentage,
// pass, attempts remaining).
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { loadAttemptHistory } from "@/lib/quizzes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ quizId: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { quizId: rawQuizId } = await ctx.params;
  const quizId = parsePositiveInt(rawQuizId);
  if (quizId === null) {
    return apiError(400, "quizId must be a positive integer.", "invalid_quiz_id");
  }

  const history = await loadAttemptHistory(quizId, gate.user.id);
  if (!history) {
    return apiError(404, "Quiz not found.", "quiz_not_found");
  }

  return apiOk(history);
}
