// =============================================================================
// GET    /api/visualizations/:visualizationId  —  "student"
// PUT    /api/visualizations/:visualizationId  —  "instructor"
// DELETE /api/visualizations/:visualizationId  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// TOP-LEVEL RATHER THAN NESTED UNDER THE LECTURE, unlike assignment samples.
// The reason is the cross-lecture read the schema was designed for: a
// visualisation is addressable by concept (`topic_key`) across lectures, so a
// client holding an id from that query does not necessarily know which lecture
// it came from. Forcing `/lectures/:lectureId/visualizations/:id` would make the
// caller carry a parent id it has no reason to have.
//
// The consequence is that these three handlers cannot use the parent id as a
// second WHERE predicate the way the sample routes do. That costs nothing here:
// visualisations are curriculum, staff-writable and student-readable, with no
// per-row ownership to scope by.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { lectures } from "@/db/schema";
import { lectureVisualizations } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { decrement, statusForDbError } from "@/lib/learning/db-errors";
import { parseBody, updateVisualizationSchema } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ visualizationId: string }> };

/**
 * Read one visualisation.
 *
 * @returns 200 the full row, including `svgMarkup` / `animationSpec` /
 *          `interactiveData` verbatim (see the module header on sandboxing)
 * @throws 404 flag off, or no such visualisation
 * @throws 401 not signed in
 * @throws 400 `visualizationId` is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const id = parsePositiveInt((await ctx.params).visualizationId);
  if (id === null) {
    return apiError(400, "visualizationId must be a positive integer.", "invalid_id");
  }

  const [row] = await db
    .select()
    .from(lectureVisualizations)
    .where(eq(lectureVisualizations.id, id))
    .limit(1);

  if (!row) return apiError(404, "Visualisation not found.", "not_found");
  return apiOk(row);
}

/**
 * Update a visualisation. Partial.
 *
 * @returns 200 the updated row
 * @throws 404 flag off, or no such visualisation
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the new `orderIndex` is taken for that lecture
 * @throws 422 body fails validation, or a dimension CHECK rejects it
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const id = parsePositiveInt((await ctx.params).visualizationId);
  if (id === null) {
    return apiError(400, "visualizationId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, updateVisualizationSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const [row] = await db
      .update(lectureVisualizations)
      .set(body.value)
      .where(eq(lectureVisualizations.id, id))
      .returning();

    if (!row) return apiError(404, "Visualisation not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another visualisation already occupies that orderIndex for this lecture.",
        "order_taken",
      );
    }
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Delete a visualisation and decrement its lecture's display counter.
 *
 * @returns 204 no content
 * @throws 404 flag off, or no such visualisation
 * @throws 401 / 403 not signed in / not staff
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const id = parsePositiveInt((await ctx.params).visualizationId);
  if (id === null) {
    return apiError(400, "visualizationId must be a positive integer.", "invalid_id");
  }

  const removed = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(lectureVisualizations)
      .where(eq(lectureVisualizations.id, id))
      .returning({ lectureId: lectureVisualizations.lectureId });

    if (!deleted) return false;

    await tx
      .update(lectures)
      .set({ visualizationsCount: decrement(lectures.visualizationsCount) })
      .where(eq(lectures.id, deleted.lectureId));

    return true;
  });

  if (!removed) return apiError(404, "Visualisation not found.", "not_found");
  return new Response(null, { status: 204 });
}
