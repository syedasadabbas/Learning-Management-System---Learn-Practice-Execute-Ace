// =============================================================================
// GET  /api/classes/:classId/chat  —  "student"
// POST /api/classes/:classId/chat  —  "student"
// Feature flag: liveClasses
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THIS IS THE REST HALF OF A TWO-WRITER TABLE. `services/realtime` persists chat
// through its own `ChatStore` (services/realtime/src/store/types.ts) and this
// route reads and writes the SAME `class_chat` rows. Two consequences that are
// not negotiable:
//   - nothing here may cache a transcript, because the other writer is a socket
//     service this process never hears from;
//   - the soft-delete convention must match. The store's contract says
//     soft-deleted rows ARE returned with a tombstone marker so the client can
//     show "message deleted" in place rather than reflowing the transcript
//     around a gap. This route does the same: `is_deleted` rows come back with
//     their `message` replaced by null, not filtered out.
//
// THE CONTRACT MISMATCH THIS HEADER USED TO RECORD IS CLOSED. The realtime
// service's `ChatMessage` carries `deletedAt` and `reactions`; `class_chat` had
// only `is_deleted` and no reactions column at all, and the two writers were
// therefore describing different rows. `class_chat` now carries BOTH halves of
// the tombstone (`is_deleted` and `deleted_at`, held in agreement by the
// `class_chat_deleted_consistent` CHECK, so neither writer can set one without
// the other) and a `reactions` jsonb column. This route reads both:
//   - the tombstone is still projected the way its clients already consume it,
//     `message: null` with `isDeleted: true`, and `deletedAt` is returned beside
//     them so a reader can say WHEN rather than only THAT;
//   - `reactions` is returned as stored, `{ emoji: [userId, ...] }`, the same
//     shape the socket service emits on `chat:reacted`. This route does not
//     WRITE reactions — toggling one is a live-session act and belongs to the
//     socket path, whose single-statement jsonb toggle is what makes a double-tap
//     idempotent. A REST writer would be a second, racier way to do it.
//
// PAGINATION IS MANDATORY AND IS A KEYSET. An unbounded read of `class_chat` is
// a denial-of-service any signed-in student can fire from a URL bar: an
// eighty-person class produces thousands of rows. The `before` cursor is a
// keyset on `(created_at, id)` — the transcript's natural key and the shape of
// `class_chat_class_created_idx` — because a chat log grows at the end while
// you are paging through it, and offset paging over a growing list silently
// repeats rows.
// =============================================================================

import { and, count, desc, eq, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { classAttendance, classChat, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment, statusForDbError } from "@/lib/learning/db-errors";
import { parsePage } from "@/lib/learning/pagination";
import { parseBody } from "@/lib/learning/schemas";
import { postChatSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Read the transcript of a class, newest first.
 *
 * @param request query: `limit` (1..100, default 20); `before` — a message id
 *        to page backwards from, exclusive
 * @param ctx     path: `classId`
 * @returns 200 `{ items, limit, total, nextBefore }`. `nextBefore` is the id to
 *          pass on the following request, or null at the start of the
 *          transcript — so a client never discovers the end by fetching an empty
 *          page. Soft-deleted messages appear with `message: null` and
 *          `isDeleted: true`.
 * @throws 404 flag off, or no such class
 * @throws 401 not signed in
 * @throws 422 a bad page window, or a malformed `before`
 * @throws 400 `classId` is not a positive integer
 *
 * NOT RESTRICTED TO ATTENDEES. Any signed-in user who can see the class can read
 * its transcript, deliberately: a student who missed the session catching up on
 * what was asked is the normal case, and an attendance-gated transcript would
 * punish exactly them. The transcript is course discussion, not private
 * correspondence — and nothing in it is assessment data.
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

  const rawBefore = params.get("before");
  let before: number | null = null;
  if (rawBefore !== null) {
    before = parsePositiveInt(rawBefore);
    if (before === null) {
      return apiError(422, "before must be a positive message id.", "invalid_cursor");
    }
  }

  const [cls] = await db
    .select({ id: liveClasses.id })
    .from(liveClasses)
    .where(eq(liveClasses.id, classId))
    .limit(1);
  if (!cls) return apiError(404, "Class not found.", "not_found");

  const filters: SQL[] = [eq(classChat.classId, classId)];
  if (before !== null) {
    // Keyset on the id alone, which is safe HERE because `class_chat.id` is a
    // serial and therefore monotonic in insertion order — the same order
    // `created_at` gives, without the tie-breaking problem two messages in the
    // same millisecond would create.
    filters.push(lt(classChat.id, before));
  }
  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: classChat.id,
        classId: classChat.classId,
        senderId: classChat.senderId,
        senderName: users.name,
        senderRole: users.role,
        message: classChat.message,
        messageType: classChat.messageType,
        isPinned: classChat.isPinned,
        isDeleted: classChat.isDeleted,
        // Beside the flag, not instead of it: existing clients branch on the
        // boolean, and the socket service's wire type needs the timestamp.
        deletedAt: classChat.deletedAt,
        reactions: classChat.reactions,
        parentMessageId: classChat.parentMessageId,
        createdAt: classChat.createdAt,
        editedAt: classChat.editedAt,
      })
      .from(classChat)
      .innerJoin(users, eq(users.id, classChat.senderId))
      .where(where)
      .orderBy(desc(classChat.id))
      .limit(page.limit),
    db.select({ total: count() }).from(classChat).where(eq(classChat.classId, classId)),
  ]);

  // TOMBSTONE, not omission. Matching the realtime store's stated contract: a
  // reader must see that something was removed, or they are left unsure whether
  // they misread the conversation.
  const items = rows.map((row) => (row.isDeleted ? { ...row, message: null } : row));

  return apiOk({
    items,
    limit: page.limit,
    total: totals?.total ?? 0,
    // Null at the start of the transcript, so the client stops rather than
    // fetching an empty page to find out.
    nextBefore: rows.length === page.limit ? rows[rows.length - 1].id : null,
  });
}

/**
 * Post a chat message.
 *
 * Transactional, because two rows change: the message, and the sender's
 * `class_attendance.messages_sent` counter that the participation score is
 * computed from. The counter is incremented with a SQL `+ 1` on a row located by
 * (class_id, student_id), so two messages posted concurrently cannot lose one
 * another's increment.
 *
 * THE SENDER IS THE SESSION. `postChatSchema` has no `senderId`.
 *
 * @param request JSON body validated by `postChatSchema`
 * @param ctx     path: `classId`
 * @returns 201 the created message with the sender's name attached
 * @throws 404 flag off, or no such class
 * @throws 401 not signed in
 * @throws 409 chat is disabled for this class (`allow_chat = false`), or the
 *          class has ended — a transcript is closed when the session is
 * @throws 422 body fails validation, or `parentMessageId` names a message that
 *          is not in this class
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

  const body = await parseBody(request, postChatSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  // `announcement` and `system` are staff speech acts. A student posting one
  // would render with the instructor's styling, which is impersonation by
  // stylesheet.
  const isStaff = gate.user.role === "instructor" || gate.user.role === "admin";
  if (!isStaff && body.value.messageType !== "text") {
    return apiError(
      403,
      "Only staff may post system, poll or announcement messages.",
      "forbidden_message_type",
    );
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const [cls] = await tx
        .select({ id: liveClasses.id, allowChat: liveClasses.allowChat, status: liveClasses.status })
        .from(liveClasses)
        .where(eq(liveClasses.id, classId))
        .limit(1);

      if (!cls) return { kind: "not_found" as const };
      if (!cls.allowChat) return { kind: "closed" as const, reason: "Chat is disabled for this class." };
      if (cls.status === "ended" || cls.status === "cancelled") {
        return { kind: "closed" as const, reason: `This class has ${cls.status}.` };
      }

      if (body.value.parentMessageId !== undefined) {
        // A reply must be to a message IN THIS CLASS. Without the second
        // predicate, a reply could be threaded onto another class's transcript.
        const [parent] = await tx
          .select({ id: classChat.id })
          .from(classChat)
          .where(
            and(eq(classChat.id, body.value.parentMessageId), eq(classChat.classId, classId)),
          )
          .limit(1);
        if (!parent) return { kind: "bad_parent" as const };
      }

      const [row] = await tx
        .insert(classChat)
        .values({
          classId,
          senderId: gate.user.id,
          message: body.value.message,
          messageType: body.value.messageType,
          parentMessageId: body.value.parentMessageId,
        })
        .returning();

      // The engagement counter. Scoped to the sender's OWN attendance row; a
      // student who never joined simply has no row and nothing is updated,
      // which is correct — posting without joining should not manufacture
      // attendance.
      await tx
        .update(classAttendance)
        .set({ messagesSent: increment(classAttendance.messagesSent) })
        .where(
          and(eq(classAttendance.classId, classId), eq(classAttendance.studentId, gate.user.id)),
        );

      return { kind: "ok" as const, row };
    });

    switch (outcome.kind) {
      case "not_found":
        return apiError(404, "Class not found.", "not_found");
      case "closed":
        return apiError(409, outcome.reason, "chat_closed");
      case "bad_parent":
        return apiError(422, "The message being replied to is not in this class.", "bad_parent");
      case "ok":
        return apiOk({ ...outcome.row, senderName: gate.user.name }, 201);
    }
  } catch (error) {
    const status = statusForDbError(error);
    if (status) return apiError(status, "The message was rejected by the database.", "db_rejected");
    throw error;
  }
}
