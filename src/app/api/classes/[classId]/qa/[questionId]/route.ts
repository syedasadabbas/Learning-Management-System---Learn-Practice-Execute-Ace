// =============================================================================
// PATCH /api/classes/:classId/qa/:questionId  —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// MODERATION ONLY: pin/unpin, and REOPEN a question that was marked answered in
// error. The question TEXT is not editable by anyone, including the asker —
// editing a question after it has been upvoted changes what those votes were
// for, and editing someone else's words under their name is the operation this
// whole feature must not offer.
//
// `is_answered` AND `answered_at` MOVE TOGETHER, always.
// `class_qa_answered_consistent` CHECKs `(answered_at IS NOT NULL) = is_answered`
// and it is not defensive: without it the queue can hide a question whose answer
// was never recorded, or show one that has an answer attached. Reopening
// therefore NULLs `answered_at` in the same statement, and it is written here as
// one `.set()` rather than as two updates for exactly that reason.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { classQa, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { parseBody } from "@/lib/learning/schemas";
import { ownershipFilter } from "@/lib/live-classes/access";
import { patchQuestionSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string; questionId: string }> };

/**
 * Pin, unpin or reopen a question.
 *
 * @param request JSON body validated by `patchQuestionSchema`:
 *        `{ isPinned?: boolean, isAnswered?: boolean }`
 * @param ctx     path: `classId`, `questionId`
 * @returns 200 the updated question
 * @throws 404 flag off, the class does not exist or is not the caller's, or
 *          there is no such question in that class
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 `isAnswered: true` was supplied — marking a question ANSWERED is
 *          POST /qa/:id/answer, which records who answered and when. Allowing it
 *          here would let a question be resolved with no answerer on the row,
 *          which is a queue entry nobody can follow up
 * @throws 422 body fails validation
 * @throws 400 either path segment is malformed
 */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const raw = await ctx.params;
  const classId = parsePositiveInt(raw.classId);
  if (classId === null) return apiError(400, "classId must be a positive integer.", "invalid_id");
  const questionId = parsePositiveInt(raw.questionId);
  if (questionId === null) {
    return apiError(400, "questionId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, patchQuestionSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  if (body.value.isAnswered === true) {
    return apiError(
      409,
      "Use POST /qa/:questionId/answer to mark a question answered, so the answerer is recorded.",
      "use_answer_endpoint",
    );
  }

  // Moderation authority comes from owning the CLASS, so it is checked there.
  const [cls] = await db
    .select({ id: liveClasses.id })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), ownershipFilter(gate.user)))
    .limit(1);
  if (!cls) return apiError(404, "Class not found.", "not_found");

  const patch: Record<string, unknown> = {};
  if (body.value.isPinned !== undefined) patch.isPinned = body.value.isPinned;
  if (body.value.isAnswered === false) {
    // REOPEN. All three columns in one statement — see the module header on
    // `class_qa_answered_consistent`. The `answer` text is cleared too: leaving
    // it would show an answered-looking body under an open question.
    patch.isAnswered = false;
    patch.answeredAt = null;
    patch.answer = null;
    patch.instructorId = null;
  }

  try {
    const [row] = await db
      .update(classQa)
      .set(patch)
      .where(and(eq(classQa.id, questionId), eq(classQa.classId, classId)))
      .returning();

    if (!row) return apiError(404, "Question not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}
