// =============================================================================
// PATCH  /api/classes/:classId/chat/:messageId  —  "student" (author or moderator)
// DELETE /api/classes/:classId/chat/:messageId  —  "student" (author or moderator)
// Feature flag: liveClasses
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// TWO DIFFERENT CALLERS, ONE RESOURCE. An AUTHOR may edit the text of their own
// message and delete it. A MODERATOR (the class's instructor, or an admin) may
// pin, unpin and delete anyone's. Nobody may edit someone else's words — an
// instructor rewriting a student's message and leaving it under their name is
// the one operation this endpoint must never offer, which is why `message` is
// gated on authorship and not on the moderator flag.
//
// AUTHORSHIP IS A WHERE CLAUSE. The author path's UPDATE carries
// `sender_id = session.id`; the handler never fetches a message, compares, and
// then writes. Student B editing student A's message matches no row and is
// answered 404.
//
// DELETION IS A FLAG. `is_deleted`, never a DELETE — the schema header states
// the reason and it is worth repeating: a conduct complaint is investigated
// after the fact, and a hard DELETE leaves the moderator's own action
// unexplainable. The 204 is honest about the OUTCOME the caller asked for; the
// row survives.
// =============================================================================

import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { classChat, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parseBody } from "@/lib/learning/schemas";
import { patchChatSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string; messageId: string }> };

/** Both path segments, or the 400 naming the bad one. */
async function ids(ctx: Ctx): Promise<{ classId: number; messageId: number } | Response> {
  const raw = await ctx.params;
  const classId = parsePositiveInt(raw.classId);
  if (classId === null) return apiError(400, "classId must be a positive integer.", "invalid_id");
  const messageId = parsePositiveInt(raw.messageId);
  if (messageId === null) {
    return apiError(400, "messageId must be a positive integer.", "invalid_id");
  }
  return { classId, messageId };
}

/**
 * Is this caller a moderator of this class?
 *
 * One query, and it is the CLASS that is checked rather than the message —
 * moderation authority comes from owning the session, not from anything about
 * the individual message.
 */
async function isModerator(classId: number, userId: number, role: string): Promise<boolean> {
  if (role === "admin") return true;
  if (role !== "instructor") return false;
  const [cls] = await db
    .select({ id: liveClasses.id })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), eq(liveClasses.instructorId, userId)))
    .limit(1);
  return cls !== undefined;
}

/**
 * Edit or moderate one message.
 *
 * @param request JSON body validated by `patchChatSchema`:
 *        `{ message?, isPinned?, isDeleted? }`
 * @param ctx     path: `classId`, `messageId`
 * @returns 200 the updated message
 * @throws 404 flag off, or no such message in that class — also the answer when
 *          a non-author tries to edit text, because "you may not" and "it is not
 *          here for you" are the same fact from the caller's side
 * @throws 401 not signed in
 * @throws 403 a non-moderator supplied `isPinned` — a distinct answer from the
 *          404 above because pinning is a moderation capability the caller
 *          plainly does not have, and pretending the message vanished would be
 *          confusing when they can see it in the transcript
 * @throws 422 body fails validation
 * @throws 400 either path segment is malformed
 */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const body = await parseBody(request, patchChatSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const moderator = await isModerator(parsed.classId, gate.user.id, gate.user.role);

  if (body.value.isPinned !== undefined && !moderator) {
    return apiError(403, "Only the class instructor may pin messages.", "forbidden");
  }

  const patch: Record<string, unknown> = {};
  if (body.value.isPinned !== undefined) patch.isPinned = body.value.isPinned;
  if (body.value.isDeleted !== undefined) {
    patch.isDeleted = body.value.isDeleted;
    // BOTH HALVES OF THE TOMBSTONE, ALWAYS. `class_chat_deleted_consistent`
    // CHECKs `(deleted_at IS NOT NULL) = is_deleted`, so setting the flag alone
    // aborts the statement. `COALESCE` on the delete path preserves the FIRST
    // removal time: a moderator re-applying a delete must not rewrite when it
    // happened, which is the one fact a conduct review asks this column for.
    patch.deletedAt = body.value.isDeleted
      ? sql`COALESCE(${classChat.deletedAt}, now())`
      : null;
  }
  if (body.value.message !== undefined) {
    patch.message = body.value.message;
    // `edited_at` is stamped by the server, never accepted from the client.
    // `class_chat_edited_after_created` would reject a client clock that ran
    // backwards, aborting an edit the author cannot retry.
    patch.editedAt = new Date();
  }

  // AUTHORSHIP PREDICATE. A moderator's statement is unscoped; anyone else may
  // only touch their own row. Editing TEXT is author-only regardless of
  // moderation rights — see the module header.
  const editsText = body.value.message !== undefined;
  const authorOnly = editsText || !moderator;
  const scope: SQL | undefined = authorOnly ? eq(classChat.senderId, gate.user.id) : undefined;

  const [row] = await db
    .update(classChat)
    .set(patch)
    .where(and(eq(classChat.id, parsed.messageId), eq(classChat.classId, parsed.classId), scope))
    .returning();

  if (!row) return apiError(404, "Message not found.", "not_found");
  return apiOk(row.isDeleted ? { ...row, message: null } : row);
}

/**
 * Soft-delete one message.
 *
 * @param ctx path: `classId`, `messageId`
 * @returns 204 no content. IDEMPOTENT: deleting an already-deleted message is
 *          still a 204, because the caller's requested state is the state the
 *          row is in, and a 404 on the second click of a double-tap would be a
 *          lie about a message that is, in fact, gone.
 * @throws 404 flag off, or no such message in that class that this caller may
 *          delete (not the author, not a moderator)
 * @throws 401 not signed in
 * @throws 400 either path segment is malformed
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const moderator = await isModerator(parsed.classId, gate.user.id, gate.user.role);
  const scope: SQL | undefined = moderator ? undefined : eq(classChat.senderId, gate.user.id);

  const updated = await db
    .update(classChat)
    // The flag and the timestamp move together or the CHECK rejects the
    // statement; `COALESCE` keeps the idempotent second delete from rewriting
    // when the first one happened. See the PATCH handler above.
    .set({ isDeleted: true, deletedAt: sql`COALESCE(${classChat.deletedAt}, now())` })
    .where(and(eq(classChat.id, parsed.messageId), eq(classChat.classId, parsed.classId), scope))
    .returning({ id: classChat.id });

  if (updated.length === 0) return apiError(404, "Message not found.", "not_found");
  return new Response(null, { status: 204 });
}
