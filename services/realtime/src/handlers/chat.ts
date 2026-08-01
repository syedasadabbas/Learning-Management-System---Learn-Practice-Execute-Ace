// =============================================================================
// CHAT HANDLERS.
// -----------------------------------------------------------------------------
// AUTHORITY COMES FROM `ctx.identity` — the token claims — IN EVERY FUNCTION
// BELOW. No handler reads a userId, a role or a classId out of its payload,
// because ../schemas.ts does not declare those fields and zod strips them. If
// you are adding a handler and find yourself wanting one from the payload, the
// answer is that the token already has it.
//
// PERSIST THEN BROADCAST, never the reverse. Broadcasting first would show every
// participant a message that a failed INSERT then loses, and the only person who
// would ever learn it was lost is whoever reads the log. The cost is that a
// message's latency includes a database round trip; that is the correct thing to
// pay for a transcript that matches what people saw.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { isModerator } from "../authz";
import { log } from "../log";
import type {
  chatDeleteSchema,
  chatEditSchema,
  chatPinSchema,
  chatReactSchema,
  chatSendSchema,
  chatTypingSchema,
} from "../schemas";
import type { z } from "zod";

import { respond, type Ack, type HandlerContext } from "./context";

/**
 * How much history a joining client receives.
 *
 * 200 messages is roughly the whole of a normal class and fits in one frame
 * comfortably. Anything older is the REST history endpoint's job — the same
 * endpoint the client falls back to entirely when this service is unavailable,
 * so paging through it is a path that is exercised either way.
 */
export const HISTORY_LIMIT = 200;

/** Map a store rejection onto an ack. One place, so the codes cannot drift. */
function rejectionAck(reason: "not_found" | "not_permitted" | "already_deleted"): Ack<never> {
  switch (reason) {
    case "not_found":
      return { ok: false, code: "not_found", message: "That message no longer exists." };
    case "already_deleted":
      return { ok: false, code: "not_found", message: "That message has been deleted." };
    case "not_permitted":
      return { ok: false, code: "forbidden", message: "That is not your message." };
  }
}

/**
 * Wrap a handler body so an unexpected throw becomes an ack instead of an
 * unhandled rejection.
 *
 * An unhandled promise rejection inside a Socket.io listener does not fail the
 * event — it fails the PROCESS on Node 15+. One database hiccup would take down
 * every class this instance is serving. The client gets `internal_error` and no
 * detail: the detail goes to the log, because a database error string quotes SQL.
 */
async function guarded(
  ctx: HandlerContext,
  event: string,
  ack: unknown,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (error) {
    log.error("handler threw", {
      event,
      classId: ctx.identity.classId,
      userId: ctx.identity.userId,
      error,
    });
    respond(ack, { ok: false, code: "internal_error", message: "Something went wrong." });
  }
}

export async function handleChatSend(
  ctx: HandlerContext,
  payload: z.infer<typeof chatSendSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "chat:send", ack, async () => {
    const message = await ctx.store.chat.create({
      classId: ctx.identity.classId,
      authorId: ctx.identity.userId,
      authorRole: ctx.identity.role,
      body: payload.body,
    });

    ctx.engagement.record(ctx.identity.classId, ctx.identity.userId, "message");

    // `io.to(room)` and not `socket.broadcast.to(room)`: the sender is IN the
    // room and must receive the same authoritative row as everybody else. A
    // sender who only ever sees their optimistic copy is the client that ends up
    // with a different transcript from the rest of the class.
    ctx.io.of("/classes").to(ctx.room).emit("chat:message", message);

    // Sending clears your own typing indicator — nobody is still typing the
    // message they just sent, and leaving it up for the TTL looks like a bug.
    ctx.presence.setTyping(ctx.identity.classId, ctx.identity.userId, false);

    respond(ack, { ok: true, data: { message, clientRef: payload.clientRef ?? null } });
  });
}

export async function handleChatEdit(
  ctx: HandlerContext,
  payload: z.infer<typeof chatEditSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "chat:edit", ack, async () => {
    const result = await ctx.store.chat.edit({
      messageId: payload.messageId,
      editorId: ctx.identity.userId,
      // Passed for completeness; the store deliberately does NOT let a moderator
      // rewrite another person's words. See ../store/memory.ts.
      editorIsModerator: isModerator(ctx.identity),
      body: payload.body,
    });

    if (!result.ok) {
      respond(ack, rejectionAck(result.reason));
      return;
    }

    ctx.io.of("/classes").to(ctx.room).emit("chat:edited", result.value);
    respond(ack, { ok: true, data: { message: result.value } });
  });
}

export async function handleChatDelete(
  ctx: HandlerContext,
  payload: z.infer<typeof chatDeleteSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "chat:delete", ack, async () => {
    const result = await ctx.store.chat.softDelete({
      messageId: payload.messageId,
      actorId: ctx.identity.userId,
      actorIsModerator: isModerator(ctx.identity),
    });

    if (!result.ok) {
      respond(ack, rejectionAck(result.reason));
      return;
    }

    // The TOMBSTONE is broadcast, not a removal instruction: clients render
    // "message deleted" in place. A transcript that silently reflows around a
    // gap leaves participants unsure whether they misread something.
    ctx.io.of("/classes").to(ctx.room).emit("chat:deleted", {
      messageId: result.value.id,
      deletedAt: result.value.deletedAt,
    });
    respond(ack, { ok: true, data: { messageId: result.value.id } });
  });
}

export async function handleChatPin(
  ctx: HandlerContext,
  payload: z.infer<typeof chatPinSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "chat:pin", ack, async () => {
    // The role check already happened in ../server.ts against the authz table.
    // Not repeated here — a second, hand-written copy of a rule is how the two
    // copies come to disagree.
    const result = await ctx.store.chat.setPinned({
      messageId: payload.messageId,
      pinned: payload.pinned,
    });

    if (!result.ok) {
      respond(ack, rejectionAck(result.reason));
      return;
    }

    ctx.io.of("/classes").to(ctx.room).emit("chat:pinned", result.value);
    respond(ack, { ok: true, data: { message: result.value } });
  });
}

export async function handleChatTyping(
  ctx: HandlerContext,
  payload: z.infer<typeof chatTypingSchema>,
  ack: unknown,
): Promise<void> {
  // NOT PERSISTED and not rate-limit-charged as a message: a typing indicator is
  // a keystroke-frequency signal, and spending chat budget on it would throttle
  // the message the user is in the middle of writing. It is still bounded — the
  // limiter charges it, just from the same bucket, and the client is expected to
  // debounce.
  ctx.presence.setTyping(ctx.identity.classId, ctx.identity.userId, payload.typing);

  ctx.socket.to(ctx.room).emit("chat:typing", {
    classId: ctx.identity.classId,
    userIds: ctx.presence.typingIn(ctx.identity.classId),
  });

  respond(ack, { ok: true, data: { typing: payload.typing } });
}

export async function handleChatReact(
  ctx: HandlerContext,
  payload: z.infer<typeof chatReactSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "chat:react", ack, async () => {
    const result = await ctx.store.chat.react({
      messageId: payload.messageId,
      userId: ctx.identity.userId,
      emoji: payload.emoji,
      add: payload.add,
    });

    if (!result.ok) {
      respond(ack, rejectionAck(result.reason));
      return;
    }

    // Only ADDING counts toward engagement. Counting removals too would make a
    // tap-untap loop an engagement generator, which is a metric inviting the one
    // behaviour it should not reward.
    if (payload.add) ctx.engagement.record(ctx.identity.classId, ctx.identity.userId, "reaction");

    ctx.io.of("/classes").to(ctx.room).emit("chat:reacted", {
      messageId: result.value.id,
      reactions: result.value.reactions,
    });
    respond(ack, { ok: true, data: { reactions: result.value.reactions } });
  });
}

/** History sent to a client immediately after a successful handshake. */
export async function loadHistory(ctx: HandlerContext): Promise<void> {
  const [messages, questions] = await Promise.all([
    ctx.store.chat.history(ctx.identity.classId, HISTORY_LIMIT),
    ctx.store.qa.list(ctx.identity.classId, HISTORY_LIMIT),
  ]);

  // Emitted to THIS SOCKET only. A join must not push a re-render of the whole
  // transcript onto everybody already in the room.
  ctx.socket.emit("class:snapshot", {
    classId: ctx.identity.classId,
    messages,
    questions,
    presence: ctx.presence.snapshot(ctx.identity.classId),
  });
}
