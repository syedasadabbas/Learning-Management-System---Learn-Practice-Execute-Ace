// =============================================================================
// HANDSHAKE MIDDLEWARE — the only place a socket acquires an identity.
// -----------------------------------------------------------------------------
// Runs before `connection` fires. A socket that reaches a handler HAS a verified
// identity, unconditionally, which is what lets every handler read
// `socket.data.identity` without a null check and without wondering whether it
// came from the client.
//
// THE TOKEN IS READ FROM `handshake.auth`, NOT FROM THE QUERY STRING.
// `io(url, { auth: { token } })` sends it in the Engine.IO handshake body;
// `?token=` puts it in a URL, and URLs are logged by every proxy, CDN and
// browser history in the path. Query is accepted as a documented FALLBACK
// because some corporate proxies mangle the auth payload on the initial polling
// request, and a class that cannot connect is worse than a token in a log it can
// only be replayed from for 120 seconds — but `auth` is what the client uses.
//
// ERRORS CARRY A MACHINE-READABLE `data.code`. Socket.io surfaces `err.data` to
// the client's `connect_error` handler, and the client's response genuinely
// differs by reason: `expired` means mint a new token and retry immediately,
// `bad_signature` means stop retrying because the deployment is misconfigured.
// A single opaque "unauthorized" makes a client that retries forever the only
// safe client to write.
// =============================================================================

import type { Socket } from "socket.io";
import type { ExtendedError } from "socket.io/dist/namespace";

import { log } from "../log";
import type { SocketIdentity } from "../types";

import { verifyRealtimeToken, type RealtimeTokenFailure } from "./token";

/** Client-visible failure codes. The token failures plus the two policy ones. */
export type HandshakeFailure = RealtimeTokenFailure | "missing_token" | "too_many_sockets";

const MESSAGES: Record<HandshakeFailure, string> = {
  missing_token: "No handshake token was presented.",
  malformed: "The handshake token is not a well-formed token.",
  invalid_claims: "The handshake token does not carry the expected claims.",
  bad_signature: "The handshake token's signature did not verify.",
  expired: "The handshake token has expired. Request a new one and reconnect.",
  too_many_sockets: "Too many simultaneous connections for this account.",
};

export class HandshakeError extends Error implements ExtendedError {
  public readonly data: { code: HandshakeFailure };

  constructor(code: HandshakeFailure) {
    super(MESSAGES[code]);
    this.name = "HandshakeError";
    this.data = { code };
  }
}

function tokenFrom(socket: Socket): unknown {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  if (auth && typeof auth.token === "string") return auth.token;
  // Documented fallback — see the header.
  const query = socket.handshake.query as Record<string, unknown> | undefined;
  return query?.token;
}

export interface HandshakeDeps {
  sharedSecret: string;
  maxSocketsPerUser: number;
  /** How many sockets this user already holds in this class. */
  currentSocketsFor: (classId: number, userId: number) => number;
  now?: () => number;
}

/**
 * Build the Socket.io middleware.
 *
 * A factory rather than a module-level function so the tests can drive it with a
 * fixed clock and a stub socket count, and so nothing here reads `process.env`
 * at call time.
 */
export function createHandshakeMiddleware(deps: HandshakeDeps) {
  const now = deps.now ?? Date.now;

  return function handshake(socket: Socket, next: (err?: ExtendedError) => void): void {
    const token = tokenFrom(socket);

    if (token === undefined || token === null || token === "") {
      reject(socket, next, "missing_token");
      return;
    }

    const verified = verifyRealtimeToken(token, deps.sharedSecret, now());
    if (!verified.ok) {
      reject(socket, next, verified.reason);
      return;
    }

    const { claims } = verified;

    // CONNECTION CAP, per user per class. Not a security control — the token
    // already bounds who may connect — but a resource one: a client with a
    // reconnect bug can otherwise open sockets until the process runs out of
    // file descriptors and the whole class drops. Checked here rather than after
    // `connection` so the socket is refused before it costs a room membership.
    if (deps.currentSocketsFor(claims.classId, claims.userId) >= deps.maxSocketsPerUser) {
      reject(socket, next, "too_many_sockets", { userId: claims.userId, classId: claims.classId });
      return;
    }

    const identity: SocketIdentity = {
      userId: claims.userId,
      role: claims.role,
      classId: claims.classId,
      tokenExpiresAtMs: claims.expiresAtMs,
    };

    // `socket.data` is the only channel between middleware and handlers, and
    // this is the ONLY write to `identity` anywhere in the service. Everything
    // downstream reads it and nothing re-derives it.
    socket.data.identity = identity;

    log.info("handshake accepted", {
      socketId: socket.id,
      userId: identity.userId,
      role: identity.role,
      classId: identity.classId,
    });

    next();
  };
}

function reject(
  socket: Socket,
  next: (err?: ExtendedError) => void,
  code: HandshakeFailure,
  fields: Record<string, unknown> = {},
): void {
  // The REASON is logged, never the token. A rejected token in a log is still a
  // valid token for the rest of its window if the rejection was, say, a socket
  // cap rather than a signature failure.
  log.warn("handshake rejected", { socketId: socket.id, code, ...fields });
  next(new HandshakeError(code));
}
