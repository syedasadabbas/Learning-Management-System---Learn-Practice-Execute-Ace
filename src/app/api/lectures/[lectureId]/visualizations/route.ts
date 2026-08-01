// =============================================================================
// GET  /api/lectures/:lectureId/visualizations  —  "student"
// POST /api/lectures/:lectureId/visualizations  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// NO ANSWER-KEY PROJECTION, and that is a decision rather than an omission: a
// visualisation is a diagram explaining a concept. There is nothing in
// `lecture_visualizations` that answers an assessed question. Recorded in
// src/lib/learning/projection.ts alongside the resources that DO need one.
//
// `svg_markup` and any authored HTML in these rows are UNTRUSTED BY
// CONSTRUCTION — the schema says so at the column. This API returns them
// verbatim; sanitising here would silently break legitimate authored SVG while
// giving the renderer a false reason to drop its sandbox. The barrier is at the
// render site, not at this boundary.
//
// `topic_key` DENORMALIZATION. The column exists so "every diagram explaining
// css-flexbox" is answerable without a join. When a visualisation is created
// without one, this handler copies it from the parent lecture, because a null
// there silently excludes the row from that cross-lecture query and nothing
// would ever report it. `lectures.topic_key` remains the source of truth.
// =============================================================================

import { asc, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { lectures } from "@/db/schema";
import { lectureVisualizations } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment, statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { createVisualizationSchema, parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List a lecture's visualisations, in figure order.
 *
 * @param request query: `limit` (1..100, default 20), `offset`
 * @param ctx     path: `lectureId`
 * @returns 200 `{ items, limit, offset, total }` ordered by `order_index` ASC
 * @throws 404 flag off, or the lecture does not exist
 * @throws 401 not signed in
 * @throws 422 malformed `limit` / `offset`
 * @throws 400 `lectureId` is not a positive integer
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ lectureId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const lectureId = parsePositiveInt((await ctx.params).lectureId);
  if (lectureId === null) {
    return apiError(400, "lectureId must be a positive integer.", "invalid_id");
  }

  const pageResult = parsePage(new URL(request.url).searchParams);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const [parent] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(eq(lectures.id, lectureId))
    .limit(1);
  if (!parent) return apiError(404, "Lecture not found.", "not_found");

  const [items, [totals]] = await Promise.all([
    db
      .select()
      .from(lectureVisualizations)
      .where(eq(lectureVisualizations.lectureId, lectureId))
      // Matches `lecture_visualizations_lecture_idx`, which is (lecture_id,
      // order_index) precisely so this read is an index walk.
      .orderBy(asc(lectureVisualizations.orderIndex), asc(lectureVisualizations.id))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ total: count() })
      .from(lectureVisualizations)
      .where(eq(lectureVisualizations.lectureId, lectureId)),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Create a visualisation under a lecture.
 *
 * Transactional: the row and `lectures.visualizations_count` change together.
 *
 * @param request JSON body validated by `createVisualizationSchema`
 * @returns 201 the created row
 * @throws 404 flag off, or the lecture does not exist
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 `orderIndex` is taken for this lecture
 * @throws 422 body fails validation, or a CHECK rejects it (a zero or negative
 *          dimension is caught by `lecture_visualizations_size_positive`)
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ lectureId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const lectureId = parsePositiveInt((await ctx.params).lectureId);
  if (lectureId === null) {
    return apiError(400, "lectureId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, createVisualizationSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const created = await db.transaction(async (tx) => {
      const [parent] = await tx
        .select({ id: lectures.id, topicKey: lectures.topicKey })
        .from(lectures)
        .where(eq(lectures.id, lectureId))
        .limit(1);
      if (!parent) return null;

      const [row] = await tx
        .insert(lectureVisualizations)
        .values({
          lectureId,
          // Inherit the parent's concept slug when the author did not name one.
          // See the module header for why a null here is a silent exclusion.
          topicKey: body.value.topicKey ?? parent.topicKey,
          type: body.value.type,
          title: body.value.title,
          description: body.value.description,
          svgMarkup: body.value.svgMarkup,
          animationSpec: body.value.animationSpec,
          interactiveData: body.value.interactiveData,
          explanation: body.value.explanation,
          learningPoint: body.value.learningPoint,
          widthPx: body.value.widthPx,
          heightPx: body.value.heightPx,
          isInteractive: body.value.isInteractive,
          orderIndex: body.value.orderIndex,
          createdBy: gate.user.id,
        })
        .returning();

      await tx
        .update(lectures)
        .set({ visualizationsCount: increment(lectures.visualizationsCount) })
        .where(eq(lectures.id, lectureId));

      return row;
    });

    if (!created) return apiError(404, "Lecture not found.", "not_found");
    return apiOk(created, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another visualisation already occupies that orderIndex for this lecture.",
        "order_taken",
      );
    }
    if (status) {
      return apiError(status, "The visualisation was rejected by the database.", "db_rejected");
    }
    throw error;
  }
}
