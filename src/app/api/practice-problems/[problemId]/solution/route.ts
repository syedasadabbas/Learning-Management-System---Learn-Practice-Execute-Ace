// =============================================================================
// GET /api/practice-problems/:problemId/solution  —  "student"
// Feature flag: learningEnhancements
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THE ONLY ROUTE IN THIS FEATURE THAT RETURNS SOLUTION MATERIAL, and it uses
// the only projection that names those columns
// (`practiceProblemSolutionColumns`). Everything else about practice problems
// selects a column list that cannot include them.
//
// THE ACCESS RULE, STATED HONESTLY. Any signed-in user may call this. There is
// no "you must attempt it first" gate, and I did not invent one, because there
// is nothing to gate on: `practice_problems` deliberately has no attempts
// ledger (schema.learning.ts contrasts it with `coding_problems`, which has
// `coding_attempts`), these problems are UNGRADED, and no score anywhere in the
// LMS depends on them. A gate keyed on a client-supplied "I attempted it" flag
// would be theatre — forgeable in one line of fetch — and a gate keyed on a
// table that does not exist is not implementable.
//
// So the barrier is architectural rather than authorizational: the solution is
// never in a payload the student did not explicitly request. That is the
// property this route exists to provide, and it is the property the projection
// test asserts.
//
// IF THIS SHOULD LATER BE GATED, the change is: add a
// `practice_problem_attempts` table (schema stream), then add a WHERE-EXISTS on
// it here. Noted so the decision is revisitable rather than forgotten.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { practiceProblems } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { practiceProblemSolutionColumns } from "@/lib/learning/projection";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reveal the reference solution for a practice problem.
 *
 * @param ctx path: `problemId`
 * @returns 200 `{ id, lectureId, solutionCode, solutionExplanation,
 *          solutionScreenshotUrl }`
 * @throws 404 flag off, no such problem, OR the problem has no published
 *          solution — the last case is a 404 rather than a 200 with three nulls
 *          because "there is no solution at this address" is what happened, and
 *          a payload of nulls makes a client render an empty answer panel
 * @throws 401 not signed in
 * @throws 400 `problemId` is not a positive integer
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ problemId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const problemId = parsePositiveInt((await ctx.params).problemId);
  if (problemId === null) {
    return apiError(400, "problemId must be a positive integer.", "invalid_id");
  }

  const [row] = await db
    .select(practiceProblemSolutionColumns)
    .from(practiceProblems)
    .where(eq(practiceProblems.id, problemId))
    .limit(1);

  if (!row) return apiError(404, "Practice problem not found.", "not_found");

  if (row.solutionCode === null && row.solutionExplanation === null) {
    return apiError(404, "This problem has no published solution.", "no_solution");
  }

  return apiOk(row);
}
