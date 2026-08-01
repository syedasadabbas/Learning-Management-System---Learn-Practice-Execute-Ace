// =============================================================================
// HANDLER CONTEXT — what every event handler is given, and the ack contract.
// -----------------------------------------------------------------------------
// EVERY EVENT IS ACKNOWLEDGED, including the ones that fail. A socket event with
// no ack has exactly one failure mode from the client's point of view — nothing
// happens — and "nothing happens" covers rate limiting, a validation error, a
// permission refusal, a dropped connection and a server bug. That is
// undiagnosable from a browser, and it is the reason a chat UI ends up with a
// message stuck grey forever. So the handler always answers, and the answer
// names the reason.
//
// The ack is also what makes the optimistic-render pattern possible: the client
// paints the message immediately with its `clientRef`, and reconciles when the
// ack arrives carrying the authoritative row.
// =============================================================================

import type { Server, Socket } from "socket.io";

import type { EngagementTracker } from "../engagement";
import type { PresenceRegistry } from "../presence";
import type { Store } from "../store/types";
import type { SocketIdentity } from "../types";

/** Why an event did not do what the client asked. */
export type AckErrorCode =
  | "rate_limited"
  | "invalid_payload"
  | "forbidden"
  | "not_found"
  | "wrong_class"
  | "internal_error";

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; code: AckErrorCode; message: string; retryAfterMs?: number };

/** Socket.io hands callbacks through as unknown; this is the shape we require. */
export type AckFn = (response: Ack<unknown>) => void;

/**
 * Call an ack callback defensively.
 *
 * A client is free to emit WITHOUT a callback — every Socket.io client can — so
 * `ack(...)` would be a TypeError thrown inside the handler, taking down the
 * event for a client that simply did not want a reply. Checked, once, here.
 */
export function respond<T>(ack: unknown, response: Ack<T>): void {
  if (typeof ack === "function") (ack as AckFn)(response as Ack<unknown>);
}

export interface HandlerContext {
  io: Server;
  socket: Socket;
  identity: SocketIdentity;
  store: Store;
  presence: PresenceRegistry;
  engagement: EngagementTracker;
  /** The Socket.io room for this socket's class. Always `class:<id>`. */
  room: string;
}

/** The room name for a class. One function so the format cannot drift. */
export function roomFor(classId: number): string {
  return `class:${classId}`;
}
