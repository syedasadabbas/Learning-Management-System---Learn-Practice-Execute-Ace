// =============================================================================
// GET /api/weeks/:weekId/quiz  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// Owner: quizzes stream. Path is fixed by ROUTES in src/lib/contracts/api.ts.
//
// THE ANSWER-LEAK RULE: this response must never carry `isCorrect` on an option
// or `explanation` on a question. Both are on the rows the service reads, and
// both are dropped by `toStudentQuiz` (src/lib/quizzes/payload.ts), whose output
// types do not declare the fields at all. This handler does not touch rows
// directly, so it has no way to reintroduce them.
//
// Explanations are returned only by POST .../submit, after grading.
//
// WEEK-LOCK GATE (added at integration).
// This route originally required only a session, so a student could take Week 4's
// quiz without unlocking Weeks 2-3 — which defeats sequential week unlocking. The
// gate reuses course-content's `gateWeek` rather than deriving lock state a second
// time here: `progress.weekUnlocked` is deliberately NOT a source of truth (see
// src/lib/progress/read-model.ts), so a local check against that column would
// disagree with the week list a student can see.
//
// Note the direction of the dependency: unlock is derived from *past* weeks' quiz
// percentages, never from the quiz being requested, so gating a quiz on unlock is
// not circular.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { gateWeek } from "@/components/course/data";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { loadStudentQuizByWeek } from "@/lib/quizzes/service";

export const runtime = "nodejs";
// Per-student attempt counts are in the payload; never serve this from the cache.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ weekId: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { weekId: rawWeekId } = await ctx.params;
  const weekId = parsePositiveInt(rawWeekId);
  if (weekId === null) {
    return apiError(400, "weekId must be a positive integer.", "invalid_week_id");
  }

  // Refuse before loading anything: a locked week must not even reveal whether it
  // has a quiz. An unknown week id and an out-of-course one both read as 404 so
  // the endpoint cannot be used to enumerate weeks.
  const week = await gateWeek(gate.user.id, weekId);
  if (!week.ok) {
    return week.kind === "locked"
      ? apiError(
          403,
          "This week is locked. Pass the previous week's quiz to unlock it.",
          "week_locked",
        )
      : apiError(404, "Week not found.", "not_found");
  }

  const payload = await loadStudentQuizByWeek(weekId, gate.user.id);
  if (!payload) {
    return apiError(404, "This week has no quiz.", "quiz_not_found");
  }

  return apiOk(payload);
}
