// =============================================================================
// GET  /api/assignments/:assignmentId/samples   —  ROUTE_AUTH "student"
// POST /api/assignments/:assignmentId/samples   —  ROUTE_AUTH "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// A "sample" is a worked example shown BEFORE the student attempts the
// assignment — see schema.learning.ts. There is no answer-key projection here
// and that is deliberate, recorded in src/lib/learning/projection.ts: a sample
// IS the answer, published on purpose.
//
// THE 404 ON A MISSING ASSIGNMENT IS A REAL QUERY, not an inference from an
// empty sample list. An assignment with zero samples and an assignment that does
// not exist are different answers (200 with `items: []` vs 404), and collapsing
// them would tell a client that a typo'd id is a valid assignment awaiting
// content.
// =============================================================================

import { asc, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments } from "@/db/schema";
import { assignmentSamples } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment, statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { createSampleSchema, parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the worked samples for one assignment, in carousel order.
 *
 * @param request query: `limit` (1..100, default 20), `offset` (0..100000)
 * @param ctx     path: `assignmentId`, a positive integer
 * @returns 200 `{ items, limit, offset, total }` ordered by `sample_order` ASC
 * @throws 404 the feature flag is off, OR the assignment does not exist
 * @throws 401 not signed in
 * @throws 422 malformed `limit` / `offset`
 * @throws 400 `assignmentId` is not a positive integer
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const assignmentId = parsePositiveInt((await ctx.params).assignmentId);
  if (assignmentId === null) {
    return apiError(400, "assignmentId must be a positive integer.", "invalid_id");
  }

  const pageResult = parsePage(new URL(request.url).searchParams);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const [parent] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!parent) return apiError(404, "Assignment not found.", "not_found");

  // Two statements rather than a window function: the COUNT is an index-only
  // scan on `assignment_samples_assignment_idx` and the page is the same index
  // walked in order, so the second one is cheap and the SQL stays readable.
  const [items, [totals]] = await Promise.all([
    db
      .select()
      .from(assignmentSamples)
      .where(eq(assignmentSamples.assignmentId, assignmentId))
      .orderBy(asc(assignmentSamples.sampleOrder), asc(assignmentSamples.id))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ total: count() })
      .from(assignmentSamples)
      .where(eq(assignmentSamples.assignmentId, assignmentId)),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Create a worked sample under an assignment.
 *
 * Runs in a transaction because it writes two rows: the sample, and
 * `assignments.samples_count`. The counter is a display hint (see
 * src/lib/learning/db-errors.ts) but a hint that drifts on every failed insert
 * is worse than no hint, and the transaction costs nothing here.
 *
 * @param request JSON body validated by `createSampleSchema`
 * @param ctx     path: `assignmentId`
 * @returns 201 the created row, with `id`
 * @throws 404 flag off, or the assignment does not exist
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 `sampleOrder` is already taken for this assignment
 *             (UNIQUE assignment_samples_order_idx — the constraint exists so
 *             two concurrent authors cannot both land at position 3)
 * @throws 422 body fails validation, or a CHECK rejects it
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const assignmentId = parsePositiveInt((await ctx.params).assignmentId);
  if (assignmentId === null) {
    return apiError(400, "assignmentId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, createSampleSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const created = await db.transaction(async (tx) => {
      // Existence is checked inside the transaction so the 404 cannot be
      // answered from a row that a concurrent DELETE removed a moment later.
      const [parent] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(eq(assignments.id, assignmentId))
        .limit(1);
      if (!parent) return null;

      const [row] = await tx
        .insert(assignmentSamples)
        .values({
          assignmentId,
          title: body.value.title,
          description: body.value.description,
          sampleOrder: body.value.sampleOrder,
          sampleOutputHtml: body.value.sampleOutputHtml,
          screenshotUrl: body.value.screenshotUrl,
          codeExample: body.value.codeExample,
          liveUrl: body.value.liveUrl,
          features: body.value.features,
          videoWalkthroughUrl: body.value.videoWalkthroughUrl,
          createdBy: gate.user.id,
        })
        .returning();

      await tx
        .update(assignments)
        .set({ samplesCount: increment(assignments.samplesCount) })
        .where(eq(assignments.id, assignmentId));

      return row;
    });

    if (!created) return apiError(404, "Assignment not found.", "not_found");

    // 201 with the row; `id` is the "Location" a client needs and this API's
    // envelope has no header convention, so it travels in the body.
    return apiOk(created, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another sample already occupies that sampleOrder for this assignment.",
        "order_taken",
      );
    }
    if (status) return apiError(status, "The sample was rejected by the database.", "db_rejected");
    throw error;
  }
}
