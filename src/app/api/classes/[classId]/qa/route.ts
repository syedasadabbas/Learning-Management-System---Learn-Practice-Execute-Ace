// =============================================================================
// GET  /api/classes/:classId/qa  —  "student"
// POST /api/classes/:classId/qa  —  "student"
// Feature flag: liveClasses
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// SAME TWO-WRITER SITUATION AS CHAT. `services/realtime`'s `QaStore` persists
// into `class_qa` and this route reads and writes the same rows. Its stated
// ordering — "open questions first, then by upvotes, then newest" — is the
// default ordering implemented here, so the REST history and the live panel
// agree about what is at the top of the queue.
//
// CONTRACT MISMATCH, RECORDED: `QaStore.upvote` promises "one vote per user. A
// second call from the same user changes nothing." `class_qa` has an `upvotes`
// INTEGER and NO per-user vote table, so that promise is not implementable
// against this schema by either writer. See the /upvote route for what is
// implemented instead and what it costs.
// =============================================================================

import { and, asc, count, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { classAttendance, classQa, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment, statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { parseBody } from "@/lib/learning/schemas";
import { askQuestionSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * The Q&A queue for a class.
 *
 * @param request query: `answered` ("true" | "false" — omit for both),
 *        `limit` (1..100, default 20), `offset`
 * @param ctx     path: `classId`
 * @returns 200 `{ items, limit, offset, total }`, ordered pinned first, then
 *          unanswered before answered, then most-upvoted, then newest. That is
 *          the working queue an instructor scans, and it matches the shape of
 *          `class_qa_class_unanswered_idx`.
 * @throws 404 flag off, or no such class
 * @throws 401 not signed in
 * @throws 422 a bad page window, or an `answered` that is not "true"/"false"
 * @throws 400 `classId` is not a positive integer
 */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const params = new URL(request.url).searchParams;
  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const filters: SQL[] = [eq(classQa.classId, classId)];

  const rawAnswered = params.get("answered");
  if (rawAnswered !== null) {
    if (rawAnswered !== "true" && rawAnswered !== "false") {
      return apiError(422, 'answered must be "true" or "false".', "invalid_answered");
    }
    filters.push(eq(classQa.isAnswered, rawAnswered === "true"));
  }

  const where = and(...filters);

  const [cls] = await db
    .select({ id: liveClasses.id })
    .from(liveClasses)
    .where(eq(liveClasses.id, classId))
    .limit(1);
  if (!cls) return apiError(404, "Class not found.", "not_found");

  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: classQa.id,
        classId: classQa.classId,
        studentId: classQa.studentId,
        studentName: users.name,
        question: classQa.question,
        isAnswered: classQa.isAnswered,
        answer: classQa.answer,
        answeredAt: classQa.answeredAt,
        answeredBy: classQa.instructorId,
        upvotes: classQa.upvotes,
        isPinned: classQa.isPinned,
        createdAt: classQa.createdAt,
      })
      .from(classQa)
      .innerJoin(users, eq(users.id, classQa.studentId))
      .where(where)
      // Pinned first (an instructor promoting a question means it), then open
      // before resolved, then by demand, then newest. `asc(isAnswered)` puts
      // false before true, which is the intended order.
      .orderBy(
        desc(classQa.isPinned),
        asc(classQa.isAnswered),
        desc(classQa.upvotes),
        desc(classQa.createdAt),
      )
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(classQa).where(where),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Ask a question.
 *
 * Transactional: the question row and the asker's
 * `class_attendance.questions_asked` counter, which feeds the participation
 * score, move together.
 *
 * THE ASKER IS THE SESSION. `askQuestionSchema` has no `studentId`, so there is
 * no way to ask a question in someone else's name.
 *
 * @param request JSON body validated by `askQuestionSchema`
 * @param ctx     path: `classId`
 * @returns 201 the created question with the asker's name attached
 * @throws 404 flag off, or no such class
 * @throws 401 not signed in
 * @throws 409 Q&A is disabled for this class (`allow_qa = false`), or the class
 *          has ended or was cancelled
 * @throws 422 body fails validation
 * @throws 400 `classId` is not a positive integer
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, askQuestionSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const outcome = await db.transaction(async (tx) => {
      const [cls] = await tx
        .select({ id: liveClasses.id, allowQa: liveClasses.allowQa, status: liveClasses.status })
        .from(liveClasses)
        .where(eq(liveClasses.id, classId))
        .limit(1);

      if (!cls) return { kind: "not_found" as const };
      if (!cls.allowQa) {
        return { kind: "closed" as const, reason: "Q&A is disabled for this class." };
      }
      if (cls.status === "ended" || cls.status === "cancelled") {
        return { kind: "closed" as const, reason: `This class has ${cls.status}.` };
      }

      const [row] = await tx
        .insert(classQa)
        .values({ classId, studentId: gate.user.id, question: body.value.question })
        .returning();

      await tx
        .update(classAttendance)
        .set({ questionsAsked: increment(classAttendance.questionsAsked) })
        .where(
          and(eq(classAttendance.classId, classId), eq(classAttendance.studentId, gate.user.id)),
        );

      return { kind: "ok" as const, row };
    });

    switch (outcome.kind) {
      case "not_found":
        return apiError(404, "Class not found.", "not_found");
      case "closed":
        return apiError(409, outcome.reason, "qa_closed");
      case "ok":
        return apiOk({ ...outcome.row, studentName: gate.user.name }, 201);
    }
  } catch (error) {
    const status = statusForDbError(error);
    if (status) {
      return apiError(status, "The question was rejected by the database.", "db_rejected");
    }
    throw error;
  }
}
