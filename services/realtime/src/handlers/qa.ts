// =============================================================================
// Q&A HANDLERS.
// -----------------------------------------------------------------------------
// Same rules as ../handlers/chat.ts: identity from the token, persist before
// broadcast, every event acknowledged including the failures.
//
// THE ASKER IS NOTIFIED SEPARATELY WHEN THEIR QUESTION IS ANSWERED. The whole
// room gets `qa:answered` so the list re-sorts, and the asker's own sockets
// additionally get `qa:answered:mine`. Two events rather than one because the
// client's response differs in kind: the room re-renders a list, the asker gets
// a toast. Deriving "was this mine" client-side would work and would also mean
// every client in the room evaluating a condition about somebody else's data.
// =============================================================================

import { log } from "../log";
import type {
  qaAnswerSchema,
  qaAskSchema,
  qaPinSchema,
  qaResolveSchema,
  qaUpvoteSchema,
} from "../schemas";
import type { z } from "zod";

import { respond, type HandlerContext } from "./context";

async function guarded(
  ctx: HandlerContext,
  event: string,
  ack: unknown,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (error) {
    // See ../handlers/chat.ts#guarded: an unhandled rejection in a Socket.io
    // listener terminates the process on modern Node, taking every class with it.
    log.error("handler threw", {
      event,
      classId: ctx.identity.classId,
      userId: ctx.identity.userId,
      error,
    });
    respond(ack, { ok: false, code: "internal_error", message: "Something went wrong." });
  }
}

export async function handleQaAsk(
  ctx: HandlerContext,
  payload: z.infer<typeof qaAskSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "qa:ask", ack, async () => {
    const question = await ctx.store.qa.ask({
      classId: ctx.identity.classId,
      askerId: ctx.identity.userId,
      body: payload.body,
    });

    ctx.engagement.record(ctx.identity.classId, ctx.identity.userId, "question");
    ctx.io.of("/classes").to(ctx.room).emit("qa:asked", question);
    respond(ack, { ok: true, data: { question, clientRef: payload.clientRef ?? null } });
  });
}

export async function handleQaAnswer(
  ctx: HandlerContext,
  payload: z.infer<typeof qaAnswerSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "qa:answer", ack, async () => {
    const result = await ctx.store.qa.answer({
      questionId: payload.questionId,
      answeredById: ctx.identity.userId,
      body: payload.body,
    });

    if (!result.ok) {
      respond(ack, { ok: false, code: "not_found", message: "That question no longer exists." });
      return;
    }

    // CROSS-CLASS GUARD. The question id came from the client, and a question
    // belongs to a class. Without this, an instructor of class A could answer a
    // question in class B by guessing an id — the token pins the room, not the
    // row, so the row has to be checked against the room.
    if (result.value.classId !== ctx.identity.classId) {
      log.warn("rejected a qa:answer for a question in another class", {
        userId: ctx.identity.userId,
        tokenClassId: ctx.identity.classId,
        questionClassId: result.value.classId,
      });
      respond(ack, { ok: false, code: "wrong_class", message: "That question is not in this class." });
      return;
    }

    ctx.engagement.record(ctx.identity.classId, ctx.identity.userId, "answer");
    ctx.io.of("/classes").to(ctx.room).emit("qa:answered", result.value);

    // The asker's own sockets, addressed by the room-wide event plus a marker.
    // Socket.io has no "emit to a userId", so the namespace is scanned — cheap
    // at a cohort's scale (tens of sockets) and it avoids maintaining a
    // userId -> socket index that has to be kept correct on every disconnect.
    for (const socket of await ctx.io.of("/classes").in(ctx.room).fetchSockets()) {
      const identity = socket.data.identity as { userId?: number } | undefined;
      if (identity?.userId === result.value.askerId) {
        socket.emit("qa:answered:mine", result.value);
      }
    }

    respond(ack, { ok: true, data: { question: result.value } });
  });
}

export async function handleQaUpvote(
  ctx: HandlerContext,
  payload: z.infer<typeof qaUpvoteSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "qa:upvote", ack, async () => {
    const result = await ctx.store.qa.upvote({
      questionId: payload.questionId,
      userId: ctx.identity.userId,
    });

    if (!result.ok) {
      respond(ack, { ok: false, code: "not_found", message: "That question no longer exists." });
      return;
    }
    if (result.value.classId !== ctx.identity.classId) {
      respond(ack, { ok: false, code: "wrong_class", message: "That question is not in this class." });
      return;
    }

    ctx.engagement.record(ctx.identity.classId, ctx.identity.userId, "upvote");
    ctx.io.of("/classes").to(ctx.room).emit("qa:upvoted", {
      questionId: result.value.id,
      upvotes: result.value.upvotes,
    });
    respond(ack, { ok: true, data: { upvotes: result.value.upvotes } });
  });
}

export async function handleQaPin(
  ctx: HandlerContext,
  payload: z.infer<typeof qaPinSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "qa:pin", ack, async () => {
    const result = await ctx.store.qa.setPinned({
      questionId: payload.questionId,
      pinned: payload.pinned,
    });
    if (!result.ok) {
      respond(ack, { ok: false, code: "not_found", message: "That question no longer exists." });
      return;
    }
    if (result.value.classId !== ctx.identity.classId) {
      respond(ack, { ok: false, code: "wrong_class", message: "That question is not in this class." });
      return;
    }

    ctx.io.of("/classes").to(ctx.room).emit("qa:pinned", result.value);
    respond(ack, { ok: true, data: { question: result.value } });
  });
}

export async function handleQaResolve(
  ctx: HandlerContext,
  payload: z.infer<typeof qaResolveSchema>,
  ack: unknown,
): Promise<void> {
  await guarded(ctx, "qa:resolve", ack, async () => {
    const result = await ctx.store.qa.setResolved({
      questionId: payload.questionId,
      resolved: payload.resolved,
    });
    if (!result.ok) {
      respond(ack, { ok: false, code: "not_found", message: "That question no longer exists." });
      return;
    }
    if (result.value.classId !== ctx.identity.classId) {
      respond(ack, { ok: false, code: "wrong_class", message: "That question is not in this class." });
      return;
    }

    ctx.io.of("/classes").to(ctx.room).emit("qa:resolved", result.value);
    respond(ack, { ok: true, data: { question: result.value } });
  });
}
