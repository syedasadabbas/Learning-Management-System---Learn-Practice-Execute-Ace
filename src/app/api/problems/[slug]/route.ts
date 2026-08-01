// =============================================================================
// GET /api/problems/:slug  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// Owner: coding-problems stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
//
// THE HIDDEN-TEST RULE: this response must never carry a hidden test's input or
// expected output, and must not carry the reference solution for an unsolved
// executable problem. Both live on the rows the service reads, and both are dropped
// by `toStudentProblem` (src/lib/problems/payload.ts), whose output type does not
// declare a hidden-test field at all. This handler never touches a row directly, so
// it has no way to reintroduce them.
//
// LEVEL GATE. A problem whose level is not yet unlocked is refused with 403, not
// served. The shape follows the precedent set by the week-lock gate on
// `GET /api/weeks/:weekId/quiz`: authorization is "signed in", and the progression
// rule is enforced inside the handler because it is a content rule, not a role.
//
// The lock reason is returned in the error body so the client can explain it. That
// is not a leak: the ladder is derived from the student's OWN completion counts,
// which they can already see.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { LEVEL_UNLOCK_THRESHOLD } from "@/lib/problems";
import { loadProblem } from "@/lib/problems/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { slug } = await ctx.params;
  if (typeof slug !== "string" || slug.trim() === "") {
    return apiError(400, "A problem slug is required.", "invalid_slug");
  }

  const result = await loadProblem(slug, gate.user.id);
  // One 404 for "no such slug" and for "not published", so the endpoint cannot be
  // used to discover unpublished content.
  if (!result) return apiError(404, "Problem not found.", "not_found");

  if (result.locked) {
    const state = result.levels.find((l) => l.level === result.problem.level);
    const needed = state ? Math.max(0, state.requiredBelow - state.solvedBelow) : LEVEL_UNLOCK_THRESHOLD;
    return apiError(
      403,
      `This level is locked. Solve ${needed} more problem${needed === 1 ? "" : "s"} at the level below to unlock it.`,
      "level_locked",
    );
  }

  return apiOk(result.problem);
}
