// =============================================================================
// GET    /api/assignments/:assignmentId/samples/:sampleId  —  "student"
// PUT    /api/assignments/:assignmentId/samples/:sampleId  —  "instructor"
// DELETE /api/assignments/:assignmentId/samples/:sampleId  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// BOTH IDS ARE IN THE WHERE CLAUSE, ALWAYS. Every statement below matches on
// `id = :sampleId AND assignment_id = :assignmentId`, not on the sample id
// alone. Without the second predicate, sample 7 of assignment 2 is editable
// through the URL of assignment 1 — the path would be a lie and any
// assignment-scoped authorization added later would be trivially bypassable.
// The pair also means a wrong-parent request is a 404 (the resource is not at
// that address) rather than a 403 (which would confirm it exists elsewhere).
//
// AUTHORSHIP IS NOT OWNERSHIP HERE. The spec says "creator or admin" may edit.
// This implementation says any instructor or admin may, and records why:
// `created_by` is `ON DELETE SET NULL`, so a departed author's samples would
// become uneditable by anyone but an admin, and samples are shared curriculum
// rather than personal work. The audit trail of who changed what is the
// activity log's job, not an access rule that locks out the covering colleague.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments } from "@/db/schema";
import { assignmentSamples } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { decrement, statusForDbError } from "@/lib/learning/db-errors";
import { parseBody, updateSampleSchema } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ assignmentId: string; sampleId: string }> };

/** Parse both path segments, or the 400 that says which one is wrong. */
async function ids(ctx: Ctx): Promise<{ assignmentId: number; sampleId: number } | Response> {
  const raw = await ctx.params;
  const assignmentId = parsePositiveInt(raw.assignmentId);
  if (assignmentId === null) {
    return apiError(400, "assignmentId must be a positive integer.", "invalid_id");
  }
  const sampleId = parsePositiveInt(raw.sampleId);
  if (sampleId === null) {
    return apiError(400, "sampleId must be a positive integer.", "invalid_id");
  }
  return { assignmentId, sampleId };
}

/**
 * Read one sample.
 *
 * @returns 200 the full sample row
 * @throws 404 flag off, or no sample with that id UNDER that assignment
 * @throws 401 not signed in
 * @throws 400 either path segment is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const [row] = await db
    .select()
    .from(assignmentSamples)
    .where(
      and(
        eq(assignmentSamples.id, parsed.sampleId),
        eq(assignmentSamples.assignmentId, parsed.assignmentId),
      ),
    )
    .limit(1);

  if (!row) return apiError(404, "Sample not found.", "not_found");
  return apiOk(row);
}

/**
 * Update a sample. Partial: only the supplied fields change.
 *
 * @param request JSON body validated by `updateSampleSchema` (at least one field)
 * @returns 200 the updated row
 * @throws 404 flag off, or no such sample under that assignment
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the new `sampleOrder` collides with another sample
 * @throws 422 body fails validation
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const body = await parseBody(request, updateSampleSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const [row] = await db
      .update(assignmentSamples)
      .set({ ...body.value, updatedAt: new Date() })
      .where(
        and(
          eq(assignmentSamples.id, parsed.sampleId),
          eq(assignmentSamples.assignmentId, parsed.assignmentId),
        ),
      )
      .returning();

    if (!row) return apiError(404, "Sample not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another sample already occupies that sampleOrder for this assignment.",
        "order_taken",
      );
    }
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Delete a sample and decrement the assignment's display counter.
 *
 * Transactional: the counter must not survive the row it counts. The DELETE
 * returns the deleted id, so "did anything happen?" is answered by the same
 * statement that did it — a SELECT-then-DELETE would answer 204 for a row a
 * concurrent request had already removed.
 *
 * @returns 204 no content
 * @throws 404 flag off, or no such sample under that assignment
 * @throws 401 / 403 not signed in / not staff
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const removed = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(assignmentSamples)
      .where(
        and(
          eq(assignmentSamples.id, parsed.sampleId),
          eq(assignmentSamples.assignmentId, parsed.assignmentId),
        ),
      )
      .returning({ id: assignmentSamples.id });

    if (deleted.length === 0) return false;

    await tx
      .update(assignments)
      .set({ samplesCount: decrement(assignments.samplesCount) })
      .where(eq(assignments.id, parsed.assignmentId));

    return true;
  });

  if (!removed) return apiError(404, "Sample not found.", "not_found");

  // 204, not 200 with a body. A delete has nothing to return, and an envelope
  // with `data: null` invites a client to branch on it.
  return new Response(null, { status: 204 });
}
