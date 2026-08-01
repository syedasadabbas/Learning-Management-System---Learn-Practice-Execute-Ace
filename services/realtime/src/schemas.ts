// =============================================================================
// PAYLOAD VALIDATION — zod, at the edge, before anything reaches the database.
// -----------------------------------------------------------------------------
// WHAT IS DELIBERATELY ABSENT FROM EVERY SCHEMA HERE: `userId`, `role`, and
// `authorId`. They are not optional, not ignored — they are NOT DECLARED, so
// zod's default object behaviour strips them. A client that sends
// `{ body: "hi", userId: 1 }` has its userId silently discarded and the handler
// reads identity from the token claims only. This is the same rule authz.ts
// enforces for roles, applied to the data layer.
//
// LENGTH LIMITS ARE A DATABASE CONCERN AS MUCH AS AN ABUSE ONE. A 2 MB "message"
// costs one INSERT of 2 MB, is replayed to every participant on history load,
// and is served back through the REST fallback forever. The limit is checked
// before the write, not after, so an oversize payload costs a rejection and not
// a round trip to Postgres.
//
// TRIMMING HAPPENS BEFORE THE MIN CHECK (`.trim()` then `.min(1)`), which is what
// makes a message of twelve spaces a validation failure rather than a blank line
// in everybody's transcript.
//
// All sizes are characters unless stated (house rule: metric units for physical
// quantities; a character count is a count).
// =============================================================================

import { z } from "zod";

/**
 * Maximum characters in a chat message.
 *
 * 2000 is roughly a long paragraph. Chosen because the failure it prevents is a
 * pasted stack trace or a pasted file, and both are better served by a link;
 * conversely a limit near 280 would break the legitimate case of an instructor
 * pasting a code snippet into the chat during a class, which is a thing that
 * happens in every session of a web-development course.
 */
export const CHAT_BODY_MAX_CHARS = 2_000;

/** Q&A questions are a single question. Longer than a chat line, still bounded. */
export const QA_BODY_MAX_CHARS = 1_000;

/** An answer may need to be more thorough than the question. */
export const QA_ANSWER_MAX_CHARS = 4_000;

/**
 * Reaction emoji length cap in UTF-16 code units.
 *
 * Not 1: a single user-perceived emoji is frequently several code units — a
 * flag is two, a skin-toned person is four, a family can be eleven. 16 admits
 * every real emoji and refuses a sentence smuggled in as a "reaction", which
 * would otherwise be an unlimited-length field with no moderation path.
 */
export const REACTION_MAX_UNITS = 16;

/** Database ids. Positive integers; anything else is a client bug or a probe. */
const id = z.number().int().positive();

const chatBody = z.string().trim().min(1).max(CHAT_BODY_MAX_CHARS);

export const chatSendSchema = z
  .object({
    body: chatBody,
    /**
     * Client-generated correlation id, echoed back on the ack.
     *
     * Lets the UI render a message optimistically and then reconcile it with the
     * server's authoritative row (which carries the real id and the SERVER's
     * timestamp). It is a UI token, never trusted as an identifier — hence
     * bounded and never written as a key.
     */
    clientRef: z.string().max(64).optional(),
  })
  .strict();

export const chatEditSchema = z.object({ messageId: id, body: chatBody }).strict();

export const chatDeleteSchema = z.object({ messageId: id }).strict();

export const chatPinSchema = z.object({ messageId: id, pinned: z.boolean() }).strict();

/**
 * Typing indicators carry NO body and are NOT persisted.
 *
 * `typing: false` is explicit rather than implied by a timeout because a client
 * that navigates away should be able to clear its own indicator immediately;
 * the server also expires them (./presence.ts) for the client that cannot.
 */
export const chatTypingSchema = z.object({ typing: z.boolean() }).strict();

export const chatReactSchema = z
  .object({
    messageId: id,
    emoji: z.string().trim().min(1).max(REACTION_MAX_UNITS),
    /** Toggle direction, explicit so a double-tap is not a race with the server. */
    add: z.boolean(),
  })
  .strict();

export const qaAskSchema = z
  .object({
    body: z.string().trim().min(1).max(QA_BODY_MAX_CHARS),
    clientRef: z.string().max(64).optional(),
  })
  .strict();

export const qaAnswerSchema = z
  .object({ questionId: id, body: z.string().trim().min(1).max(QA_ANSWER_MAX_CHARS) })
  .strict();

/**
 * Upvote carries no direction field: one user, one vote, and the store enforces
 * distinctness. A `count` or `delta` from the client would be a
 * client-controlled tally, which is the same mistake as a client-controlled role.
 */
export const qaUpvoteSchema = z.object({ questionId: id }).strict();

export const qaPinSchema = z.object({ questionId: id, pinned: z.boolean() }).strict();

export const qaResolveSchema = z.object({ questionId: id, resolved: z.boolean() }).strict();

/**
 * `presence:join` and `presence:leave` take NOTHING.
 *
 * The class is fixed by the token and the user is fixed by the token. There is
 * genuinely no parameter a client could supply that the server should believe,
 * and an empty strict object says so in a way a reader cannot misread.
 */
export const presenceSchema = z.object({}).strict();

/**
 * Everything a validated payload can be, keyed by event name. Consumed by
 * ./server.ts so the registration loop is typed rather than stringly.
 */
export const EVENT_SCHEMAS = {
  "chat:send": chatSendSchema,
  "chat:edit": chatEditSchema,
  "chat:delete": chatDeleteSchema,
  "chat:pin": chatPinSchema,
  "chat:typing": chatTypingSchema,
  "chat:react": chatReactSchema,
  "qa:ask": qaAskSchema,
  "qa:answer": qaAnswerSchema,
  "qa:upvote": qaUpvoteSchema,
  "qa:pin": qaPinSchema,
  "qa:resolve": qaResolveSchema,
  "presence:join": presenceSchema,
  "presence:leave": presenceSchema,
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export type PayloadOf<E extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[E]>;

/**
 * Validate a payload for an event.
 *
 * Returns a VALUE, never throws, and the error string is a short summary rather
 * than zod's full issue tree — the tree names internal field paths and, for a
 * `.strict()` failure, echoes the unexpected key back to the sender, which is a
 * small reflection primitive and free to avoid.
 */
export function validatePayload<E extends EventName>(
  event: E,
  payload: unknown,
): { ok: true; data: PayloadOf<E> } | { ok: false; error: string } {
  const parsed = EVENT_SCHEMAS[event].safeParse(payload);
  if (parsed.success) return { ok: true, data: parsed.data as PayloadOf<E> };

  const first = parsed.error.issues[0];
  const where = first && first.path.length > 0 ? first.path.join(".") : "payload";
  return { ok: false, error: `Invalid ${event} payload: ${where} is not acceptable.` };
}
