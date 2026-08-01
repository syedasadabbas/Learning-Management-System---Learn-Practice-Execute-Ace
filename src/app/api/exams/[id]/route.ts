// =============================================================================
// GET /api/exams/:attemptId  —  ROUTE_AUTH: "student"
// Owner: grand-quiz stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// (See ./start/route.ts for why the folder slug is `[id]`.)
// -----------------------------------------------------------------------------
// Expiry trigger 2 of 3 lives behind this GET: `loadExam` FINALIZES an expired
// in-progress attempt before it returns anything. A read is therefore not
// side-effect free, which is unusual enough to state plainly:
//
//   * it is idempotent — the second GET replays the same recorded result (I3);
//   * it writes only what the deadline already decided, never anything the
//     request chose;
//   * and it is the reason there is no sequence of requests that yields an open
//     exam past its deadline. A client that simply never fires trigger 1 gains
//     nothing, because the only way to see the questions again is this endpoint,
//     and it closes the attempt first.
//
// The response for an in-progress attempt carries NO answer key: no
// `options.isCorrect`, no `questions.explanation`, no `questions.tests`. That is
// structural, not careful — see src/lib/grand-quiz/payload.ts.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { loadExam } from "@/lib/grand-quiz";

export const runtime = "nodejs";
// Never cached. The countdown seed and the saved answers are per-request facts,
// and a cached exam page would hand a student a stale deadline.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
};

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { id: rawAttemptId } = await ctx.params;
  const attemptId = parsePositiveInt(rawAttemptId);
  if (attemptId === null) {
    return apiError(400, "attemptId must be a positive integer.", "invalid_attempt_id");
  }

  const outcome = await loadExam({ attemptId, studentId: gate.user.id });
  if (!outcome.ok) {
    return apiError(STATUS_FOR[outcome.code] ?? 400, outcome.error, outcome.code);
  }
  return apiOk(outcome.data);
}
