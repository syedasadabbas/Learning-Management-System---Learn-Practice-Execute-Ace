// =============================================================================
// POST /api/classes/:classId/qa/:questionId/answer
//   —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// A SEPARATE ROUTE FROM PATCH, and the separation is what makes the record
// usable: answering writes THREE facts that must agree — `is_answered`,
// `answered_at`, and `instructor_id` (who answered). `class_qa_answered_
// consistent` enforces the first two; the third is enforced by there being no
// other way to set `is_answered = true`.
//
// AN EMPTY ANSWER IS VALID. The schema anticipates it: `is_answered` exists
// separately from `answer` precisely because an instructor often answers
// VERBALLY during the class and just marks the question resolved. What is not
// valid is `answered_at` and `is_answered` disagreeing, which is why they are
// set as a pair.
//
// IDEMPOTENT-ISH, DELIBERATELY NOT FULLY. Answering an already-answered question
// REPLACES the answer and re-stamps `answered_at`, because "I want to correct
// what I wrote" is the common case and refusing it would send the instructor to
// PATCH-reopen-then-answer for a typo. What it does NOT do is create a second
// row, so a double-submit is harmless.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { classQa, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { formatZodError } from "@/lib/learning/schemas";
import { ownershipFilter } from "@/lib/live-classes/access";
import { answerQuestionSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string; questionId: string }> };

/**
 * Answer a question, or mark it answered verbally.
 *
 * @param request optional JSON body `{ answer?: string }`. Absent means
 *        "answered verbally" — see the module header.
 * @param ctx     path: `classId`, `questionId`
 * @returns 200 the answered question
 * @throws 404 flag off, the class does not exist or is not the caller's, or
 *          there is no such question in that class
 * @throws 401 / 403 not signed in / not staff
 * @throws 422 body fails validation
 * @throws 400 either path segment is malformed
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
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

  // An absent body means "answered verbally", so it is `{}` rather than a 422.
  const rawBody = (await request.text()).trim();
  let input: { answer?: string } = {};
  if (rawBody.length > 0) {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return apiError(422, "Request body must be valid JSON.", "validation_failed");
    }
    const parsed = answerQuestionSchema.safeParse(json);
    if (!parsed.success) return apiError(422, formatZodError(parsed.error), "validation_failed");
    input = parsed.data;
  }

  const [cls] = await db
    .select({ id: liveClasses.id })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), ownershipFilter(gate.user)))
    .limit(1);
  if (!cls) return apiError(404, "Class not found.", "not_found");

  try {
    const [row] = await db
      .update(classQa)
      .set({
        // The three facts, in one statement, so they cannot disagree.
        isAnswered: true,
        answeredAt: new Date(),
        // From the SESSION. An `answeredBy` in the payload would let one
        // instructor credit another with an answer they did not give.
        instructorId: gate.user.id,
        answer: input.answer ?? null,
      })
      .where(and(eq(classQa.id, questionId), eq(classQa.classId, classId)))
      .returning();

    if (!row) return apiError(404, "Question not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status) return apiError(status, "The answer was rejected by the database.", "db_rejected");
    throw error;
  }
}
