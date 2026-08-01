// =============================================================================
// GET    /api/interview-questions/:questionId  —  "student"
// PUT    /api/interview-questions/:questionId  —  "instructor"
// DELETE /api/interview-questions/:questionId  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THIS GET RETURNS THE MODEL ANSWER, and it is the deliberate exception to the
// answer-key rule rather than a hole in it. An interview question is not
// assessed, is not scored, and unlocks nothing; "show answer" IS the feature
// (TECHNICAL_SPECIFICATION.md:650-682). What the split between this route and
// the list buys is that the answer is a request the student chose to make.
// The full reasoning lives in src/lib/learning/projection.ts, one place, so a
// reviewer does not have to reconstruct it from two handlers.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { interviewQuestions } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { interviewQuestionDetailColumns } from "@/lib/learning/projection";
import { parseBody, updateInterviewQuestionSchema } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ questionId: string }> };

/**
 * Read one interview question in full, model answer included.
 *
 * @returns 200 the question with `sampleAnswer`, `answerExplanation`,
 *          `commonMistakes`, `followUpQuestions` and the visual walkthrough
 * @throws 404 flag off, or no such question
 * @throws 401 not signed in
 * @throws 400 `questionId` is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const questionId = parsePositiveInt((await ctx.params).questionId);
  if (questionId === null) {
    return apiError(400, "questionId must be a positive integer.", "invalid_id");
  }

  const [row] = await db
    .select(interviewQuestionDetailColumns)
    .from(interviewQuestions)
    .where(eq(interviewQuestions.id, questionId))
    .limit(1);

  if (!row) return apiError(404, "Interview question not found.", "not_found");
  return apiOk(row);
}

/**
 * Update an interview question. Partial.
 *
 * RE-PARENTING IS ALLOWED but constrained: the schema's CHECK requires exactly
 * one of `lecture_id` / `week_id`. Supplying neither leaves the parent alone;
 * supplying both is a 422 caught by the schema; supplying one moves the
 * question and NULLS the other, which is done explicitly below because a
 * partial update that set only `weekId` would leave `lectureId` in place and
 * the CHECK would reject the whole statement with a 500-shaped error.
 *
 * @returns 200 the updated row
 * @throws 404 flag off, or no such question
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 `questionOrder` is taken under the (possibly new) parent
 * @throws 422 body fails validation, or the new parent does not exist
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const questionId = parsePositiveInt((await ctx.params).questionId);
  if (questionId === null) {
    return apiError(400, "questionId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, updateInterviewQuestionSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const patch: Record<string, unknown> = { ...body.value };
  // See the JSDoc: moving to one parent must clear the other in the SAME
  // statement, or the CHECK sees a row with both set.
  if (body.value.lectureId !== undefined) patch.weekId = null;
  if (body.value.weekId !== undefined) patch.lectureId = null;

  try {
    const [row] = await db
      .update(interviewQuestions)
      .set(patch)
      .where(eq(interviewQuestions.id, questionId))
      .returning();

    if (!row) return apiError(404, "Interview question not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another question already occupies that questionOrder under this parent.",
        "order_taken",
      );
    }
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Delete an interview question.
 *
 * No counter to maintain and no transaction: one row, one statement. Note the
 * cascade shape this relies on — `interview_questions.related_practice_id` is
 * `ON DELETE SET NULL` in the other direction, so nothing here orphans a
 * practice problem.
 *
 * @returns 204 no content
 * @throws 404 flag off, or no such question
 * @throws 401 / 403 not signed in / not staff
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const questionId = parsePositiveInt((await ctx.params).questionId);
  if (questionId === null) {
    return apiError(400, "questionId must be a positive integer.", "invalid_id");
  }

  const deleted = await db
    .delete(interviewQuestions)
    .where(eq(interviewQuestions.id, questionId))
    .returning({ id: interviewQuestions.id });

  if (deleted.length === 0) return apiError(404, "Interview question not found.", "not_found");
  return new Response(null, { status: 204 });
}
