// =============================================================================
// GET    /api/practice-problems/:problemId  —  "student"
// PUT    /api/practice-problems/:problemId  —  "instructor"
// DELETE /api/practice-problems/:problemId  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THE DETAIL VIEW STILL WITHHOLDS THE SOLUTION, which is the one decision in
// this file worth arguing about. The technical spec (line 553) describes this
// endpoint as "single problem with full details (including solution)". It is
// implemented without the solution, and the reason is stated in
// src/lib/learning/projection.ts: this payload backs the page that HOSTS the
// editor the student is meant to work in, and shipping the answer into it puts
// the answer one devtools tab away from the person trying not to look. The
// solution is a separate GET on /solution — one deliberate click, no ambiguity
// about whether it was consulted. Divergence from the spec is recorded here and
// in the stream report rather than resolved silently.
//
// PUT and DELETE return the full row including solution columns: the caller is
// staff, and there is nothing to withhold from the author of the content.
// =============================================================================

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { lectures } from "@/db/schema";
import { practiceProblems } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { decrement, statusForDbError } from "@/lib/learning/db-errors";
import {
  maxHintLevel,
  practiceProblemDetailColumns,
} from "@/lib/learning/projection";
import { parseBody, updatePracticeProblemSchema } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ problemId: string }> };

/**
 * Read one practice problem, WITHOUT its solution.
 *
 * @returns 200 the problem, plus `solutionAvailable`, `hintCount` and
 *          `maxHintLevel` so the client can render the hint ladder and the
 *          "reveal solution" affordance without holding either payload
 * @throws 404 flag off, or no such problem
 * @throws 401 not signed in
 * @throws 400 `problemId` is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const problemId = parsePositiveInt((await ctx.params).problemId);
  if (problemId === null) {
    return apiError(400, "problemId must be a positive integer.", "invalid_id");
  }

  const [row] = await db
    .select({
      ...practiceProblemDetailColumns,
      solutionAvailable: sql<boolean>`${practiceProblems.solutionCode} is not null`,
    })
    .from(practiceProblems)
    .where(eq(practiceProblems.id, problemId))
    .limit(1);

  if (!row) return apiError(404, "Practice problem not found.", "not_found");

  const { hints, ...rest } = row;
  return apiOk({
    ...rest,
    // The hint TEXT is metered by /hints; the detail view gets only the shape of
    // the ladder, so the client knows how many rungs there are before it asks
    // for the first one.
    hintCount: Array.isArray(hints) ? hints.length : 0,
    maxHintLevel: maxHintLevel(hints),
  });
}

/**
 * Update a practice problem. Partial.
 *
 * @param request JSON body validated by `updatePracticeProblemSchema`
 * @returns 200 the updated row
 * @throws 404 flag off, or no such problem
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the new `problemOrder` is taken for that lecture
 * @throws 422 body fails validation
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const problemId = parsePositiveInt((await ctx.params).problemId);
  if (problemId === null) {
    return apiError(400, "problemId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, updatePracticeProblemSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const [row] = await db
      .update(practiceProblems)
      .set(body.value)
      .where(eq(practiceProblems.id, problemId))
      .returning();

    if (!row) return apiError(404, "Practice problem not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another problem already occupies that problemOrder for this lecture.",
        "order_taken",
      );
    }
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Delete a practice problem and decrement its lecture's display counter.
 *
 * The DELETE returns `lecture_id` so the counter update knows which lecture to
 * touch without a prior SELECT — one statement fewer, and no window in which
 * the problem is gone but the parent id is stale.
 *
 * @returns 204 no content
 * @throws 404 flag off, or no such problem
 * @throws 401 / 403 not signed in / not staff
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const problemId = parsePositiveInt((await ctx.params).problemId);
  if (problemId === null) {
    return apiError(400, "problemId must be a positive integer.", "invalid_id");
  }

  const removed = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(practiceProblems)
      .where(eq(practiceProblems.id, problemId))
      .returning({ lectureId: practiceProblems.lectureId });

    if (!deleted) return false;

    await tx
      .update(lectures)
      .set({ practiceProblemsCount: decrement(lectures.practiceProblemsCount) })
      .where(eq(lectures.id, deleted.lectureId));

    return true;
  });

  if (!removed) return apiError(404, "Practice problem not found.", "not_found");
  return new Response(null, { status: 204 });
}
