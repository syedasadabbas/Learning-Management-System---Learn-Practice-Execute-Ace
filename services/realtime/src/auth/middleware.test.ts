import { describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io";
import type { ExtendedError } from "socket.io/dist/namespace";

import type { SocketIdentity } from "../types";

import { createHandshakeMiddleware, HandshakeError } from "./middleware";
import { mintRealtimeTokenForTests } from "./token";

const SECRET = "test-secret-at-least-32-characters-long!";
const NOW = 1_770_000_000_000;

/**
 * The narrow slice of a Socket the middleware touches.
 *
 * A real Socket cannot be constructed without a server; a hand-built stub of the
 * three fields that are read is both sufficient and far clearer about what the
 * middleware actually depends on.
 */
function stubSocket(auth: Record<string, unknown>, query: Record<string, unknown> = {}): Socket {
  return {
    id: "socket-under-test",
    handshake: { auth, query },
    data: {} as Record<string, unknown>,
  } as unknown as Socket;
}

function run(
  socket: Socket,
  options: { maxSocketsPerUser?: number; currentSockets?: number; now?: number } = {},
): { error: ExtendedError | undefined; socket: Socket } {
  const middleware = createHandshakeMiddleware({
    sharedSecret: SECRET,
    maxSocketsPerUser: options.maxSocketsPerUser ?? 4,
    currentSocketsFor: () => options.currentSockets ?? 0,
    now: () => options.now ?? NOW,
  });

  let captured: ExtendedError | undefined;
  middleware(socket, (err) => {
    captured = err;
  });
  return { error: captured, socket };
}

function token(overrides: Partial<Parameters<typeof mintRealtimeTokenForTests>[0]> = {}): string {
  return mintRealtimeTokenForTests({
    userId: 42,
    role: "student",
    classId: 7,
    secret: SECRET,
    expiresAtMs: NOW + 120_000,
    ...overrides,
  });
}

function codeOf(error: ExtendedError | undefined): string | undefined {
  return (error as HandshakeError | undefined)?.data?.code;
}

describe("handshake middleware", () => {
  it("accepts a valid token and attaches the claims to socket.data", () => {
    const { error, socket } = run(stubSocket({ token: token() }));

    expect(error).toBeUndefined();
    expect(socket.data.identity as SocketIdentity).toEqual({
      userId: 42,
      role: "student",
      classId: 7,
      tokenExpiresAtMs: NOW + 120_000,
    });
  });

  it("takes identity ONLY from the token, ignoring anything else in the handshake", () => {
    // The core property. A client that also sends userId and role in the auth
    // object must gain nothing from it.
    const { socket } = run(
      stubSocket({ token: token({ userId: 42, role: "student" }), userId: 1, role: "admin" }),
    );

    const identity = socket.data.identity as SocketIdentity;
    expect(identity.userId).toBe(42);
    expect(identity.role).toBe("student");
  });

  it("rejects a missing token", () => {
    expect(codeOf(run(stubSocket({})).error)).toBe("missing_token");
    expect(codeOf(run(stubSocket({ token: "" })).error)).toBe("missing_token");
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = mintRealtimeTokenForTests({
      userId: 42,
      role: "instructor",
      classId: 7,
      secret: "some-other-secret-that-is-long-enough!!",
      expiresAtMs: NOW + 120_000,
    });
    expect(codeOf(run(stubSocket({ token: foreign })).error)).toBe("bad_signature");
  });

  it("rejects an expired token with a code the client can act on", () => {
    // `expired` tells the client to mint a fresh token and retry; the other
    // codes tell it to stop. That distinction is why the code is on the error.
    const stale = token({ expiresAtMs: NOW - 1 });
    expect(codeOf(run(stubSocket({ token: stale })).error)).toBe("expired");
  });

  it("rejects a malformed token", () => {
    expect(codeOf(run(stubSocket({ token: "not-a-token" })).error)).toBe("malformed");
    expect(codeOf(run(stubSocket({ token: "a.b.c" })).error)).toBe("malformed");
  });

  it("rejects a role escalation attempted by editing the payload", () => {
    const valid = token({ role: "student" });
    const [encoded, signature] = valid.split(".");
    const claims = JSON.parse(
      Buffer.from(encoded as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.r = "instructor";
    const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;

    expect(codeOf(run(stubSocket({ token: forged })).error)).toBe("bad_signature");
  });

  it("accepts the token from the query string as a documented fallback", () => {
    const { error, socket } = run(stubSocket({}, { token: token() }));
    expect(error).toBeUndefined();
    expect((socket.data.identity as SocketIdentity).userId).toBe(42);
  });

  it("refuses a connection beyond the per-user socket cap", () => {
    // A resource control, not a security one: a client with a reconnect bug
    // otherwise opens sockets until the process runs out of descriptors.
    const { error } = run(stubSocket({ token: token() }), {
      maxSocketsPerUser: 2,
      currentSockets: 2,
    });
    expect(codeOf(error)).toBe("too_many_sockets");
  });

  it("allows the connection at one below the cap", () => {
    const { error } = run(stubSocket({ token: token() }), {
      maxSocketsPerUser: 2,
      currentSockets: 1,
    });
    expect(error).toBeUndefined();
  });

  it("asks the socket-count callback about the token's class and user, not the payload's", () => {
    const currentSocketsFor = vi.fn().mockReturnValue(0);
    const middleware = createHandshakeMiddleware({
      sharedSecret: SECRET,
      maxSocketsPerUser: 4,
      currentSocketsFor,
      now: () => NOW,
    });

    middleware(stubSocket({ token: token({ userId: 42, classId: 7 }), classId: 999 }), () => {});
    expect(currentSocketsFor).toHaveBeenCalledWith(7, 42);
  });
});
