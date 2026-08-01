// =============================================================================
// THE SERVER — HTTP (health) + Socket.io (/classes), assembled and shut down.
// -----------------------------------------------------------------------------
// EXPORTED AS A FACTORY, not started at import. `createRealtimeServer` returns a
// handle with `listen()` and `close()`, which is what lets the integration test
// boot a real server on an ephemeral port and tear it down. A module that starts
// listening as a side effect of being imported cannot be tested without a
// subprocess.
//
// EVERY TIMER THIS PROCESS CREATES IS CREATED HERE, and every one is cleared in
// `close()`. There are exactly two — the typing sweep and the rate-limiter
// sweep — and nothing in the handlers, the presence registry or the engagement
// tracker creates any. That is the whole of the no-leaked-intervals criterion,
// and it is enforceable precisely because it is one file's responsibility.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Server as IOServer, type Socket } from "socket.io";

import { createHandshakeMiddleware } from "./auth/middleware";
import { CLIENT_EVENTS, assertEveryEventIsGoverned, mayEmit, type ClientEvent } from "./authz";
import type { RealtimeConfig } from "./config";
import { EngagementTracker } from "./engagement";
import {
  handleChatDelete,
  handleChatEdit,
  handleChatPin,
  handleChatReact,
  handleChatSend,
  handleChatTyping,
  loadHistory,
} from "./handlers/chat";
import { respond, roomFor, type HandlerContext } from "./handlers/context";
import {
  handleQaAnswer,
  handleQaAsk,
  handleQaPin,
  handleQaResolve,
  handleQaUpvote,
} from "./handlers/qa";
import { log } from "./log";
import { PresenceRegistry } from "./presence";
import { RateLimiter } from "./ratelimit";
import { validatePayload, type EventName } from "./schemas";
import type { Store } from "./store/types";
import type { SocketIdentity } from "./types";

/** How often lapsed typing indicators are cleared. Half the TTL: at most one TTL of lag. */
const TYPING_SWEEP_MS = 3_000;

/** How often full rate-limit buckets are discarded. Rare — they are tiny. */
const RATELIMIT_SWEEP_MS = 60_000;

/**
 * Grace period for in-flight work after SIGTERM before the socket server is
 * forced closed.
 *
 * Railway, Fly and Render all send SIGTERM and then SIGKILL after their own
 * grace window (10-30 s depending on the platform). 5 s is comfortably inside
 * the smallest of those and is far more than a chat INSERT needs.
 */
export const SHUTDOWN_GRACE_MS = 5_000;

export interface RealtimeServer {
  /** Resolves with the bound port. Pass 0 for an ephemeral one (tests do). */
  listen(port?: number): Promise<number>;
  /** Idempotent. Clears timers, drains engagement, closes sockets and the store. */
  close(): Promise<void>;
  /** For assertions and for /healthz. */
  stats(): {
    uptimeMs: number;
    connectedSockets: number;
    presence: { classes: number; sockets: number };
    rateLimiter: { sockets: number; users: number };
    engagement: { tracked: number; connected: number };
  };
}

export function createRealtimeServer(config: RealtimeConfig, store: Store): RealtimeServer {
  // Boot-time guard: an event with no authorization rule must not start.
  assertEveryEventIsGoverned();

  const startedAtMs = Date.now();
  const presence = new PresenceRegistry();
  const engagement = new EngagementTracker();
  const limiter = new RateLimiter();

  let connectedSockets = 0;
  let closing = false;
  let closed = false;

  const http = createServer(handleHttp);

  const io = new IOServer(http, {
    // ALLOWLIST, never "*". See ./config.ts for why this socket in particular
    // cannot take the usual permissive-CORS shortcut.
    cors: {
      origin: config.allowedOrigins,
      credentials: true,
      methods: ["GET", "POST"],
    },
    // A message larger than the largest valid payload is refused by the
    // transport before it is parsed, let alone validated. ../schemas.ts caps a
    // Q&A answer at 4000 chars; 64 kB leaves room for framing and multi-byte
    // characters while making a megabyte frame impossible.
    maxHttpBufferSize: 64 * 1024,
    // Detect a dead peer in ~45 s. Long enough to survive a phone switching from
    // wifi to cellular mid-class (which takes seconds, not a minute), short
    // enough that presence does not show ghosts for the rest of the hour.
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  const classes = io.of("/classes");

  classes.use(
    createHandshakeMiddleware({
      sharedSecret: config.sharedSecret,
      maxSocketsPerUser: config.maxSocketsPerUser,
      currentSocketsFor: (classId, userId) => presence.socketsFor(classId, userId),
    }),
  );

  classes.on("connection", (socket) => {
    void onConnection(socket);
  });

  // -------------------------------------------------------------------------
  // Timers. BOTH are declared here and BOTH are cleared in close(). See header.
  // -------------------------------------------------------------------------
  const typingSweep = setInterval(() => {
    for (const classId of presence.sweepTyping()) {
      classes.to(roomFor(classId)).emit("chat:typing", {
        classId,
        userIds: presence.typingIn(classId),
      });
    }
  }, TYPING_SWEEP_MS);

  const limiterSweep = setInterval(() => {
    limiter.sweep();
  }, RATELIMIT_SWEEP_MS);

  // `unref` so a forgotten timer can never be the reason the process refuses to
  // exit. Belt and braces: close() clears them, this makes the failure of
  // close() to run non-fatal.
  typingSweep.unref();
  limiterSweep.unref();

  async function onConnection(socket: Socket): Promise<void> {
    const identity = socket.data.identity as SocketIdentity | undefined;
    if (!identity) {
      // Unreachable: the middleware either sets identity or rejects. Handled
      // rather than asserted because "unreachable" plus a socket is a
      // combination that has surprised people before, and the safe response is
      // to drop the socket, not to throw inside an event handler.
      log.error("connection with no identity reached the handler; disconnecting");
      socket.disconnect(true);
      return;
    }

    const room = roomFor(identity.classId);
    const ctx: HandlerContext = { io, socket, identity, store, presence, engagement, room };

    connectedSockets += 1;
    await socket.join(room);

    const firstSocket = presence.join(identity.classId, identity.userId);
    engagement.onConnect(identity.classId, identity.userId);

    if (firstSocket) {
      // Only a REAL join is announced. A second tab is not somebody arriving,
      // and announcing it would make the participant list flicker for everyone.
      socket.to(room).emit("presence:joined", {
        userId: identity.userId,
        role: identity.role,
        presence: presence.snapshot(identity.classId),
      });
    }

    try {
      await loadHistory(ctx);
    } catch (error) {
      // A history failure must NOT close the socket. The class continues live;
      // the client falls back to the REST history endpoint, which is the same
      // degradation path it uses when this service is absent entirely.
      log.error("failed to load class history", { classId: identity.classId, error });
      socket.emit("class:snapshot:error", { classId: identity.classId });
    }

    for (const event of CLIENT_EVENTS) {
      socket.on(event, (payload: unknown, ack: unknown) => {
        void dispatch(ctx, event, payload, ack);
      });
    }

    socket.on("disconnect", (reason) => {
      void onDisconnect(ctx, reason);
    });
  }

  /**
   * The single path every client event takes: RATE LIMIT, then AUTHORIZE, then
   * VALIDATE, then handle.
   *
   * THE ORDER IS DELIBERATE AND IT IS NOT THE OBVIOUS ONE.
   *   - Rate limiting FIRST, before validation, because parsing an attacker's
   *     payload is work and a flood of invalid payloads would otherwise be free.
   *   - Authorization BEFORE validation, because a student emitting `chat:pin`
   *     should be told it is forbidden regardless of whether their payload also
   *     happened to be malformed. Validating first would answer
   *     "invalid_payload" to an unauthorized caller, which is a worse message
   *     and leaks the schema.
   */
  async function dispatch(
    ctx: HandlerContext,
    event: ClientEvent,
    payload: unknown,
    ack: unknown,
  ): Promise<void> {
    const decision = limiter.consume(ctx.socket.id, ctx.identity.userId);
    if (!decision.allowed) {
      respond(ack, {
        ok: false,
        code: "rate_limited",
        message: "You are sending events too quickly.",
        retryAfterMs: decision.retryAfterMs,
      });
      return;
    }

    if (!mayEmit(event, ctx.identity)) {
      log.warn("rejected an event the role may not emit", {
        event,
        role: ctx.identity.role,
        userId: ctx.identity.userId,
        classId: ctx.identity.classId,
      });
      respond(ack, { ok: false, code: "forbidden", message: "You may not do that in this class." });
      return;
    }

    const parsed = validatePayload(event as EventName, payload);
    if (!parsed.ok) {
      respond(ack, { ok: false, code: "invalid_payload", message: parsed.error });
      return;
    }

    switch (event) {
      case "chat:send":
        await handleChatSend(ctx, parsed.data as never, ack);
        return;
      case "chat:edit":
        await handleChatEdit(ctx, parsed.data as never, ack);
        return;
      case "chat:delete":
        await handleChatDelete(ctx, parsed.data as never, ack);
        return;
      case "chat:pin":
        await handleChatPin(ctx, parsed.data as never, ack);
        return;
      case "chat:typing":
        await handleChatTyping(ctx, parsed.data as never, ack);
        return;
      case "chat:react":
        await handleChatReact(ctx, parsed.data as never, ack);
        return;
      case "qa:ask":
        await handleQaAsk(ctx, parsed.data as never, ack);
        return;
      case "qa:answer":
        await handleQaAnswer(ctx, parsed.data as never, ack);
        return;
      case "qa:upvote":
        await handleQaUpvote(ctx, parsed.data as never, ack);
        return;
      case "qa:pin":
        await handleQaPin(ctx, parsed.data as never, ack);
        return;
      case "qa:resolve":
        await handleQaResolve(ctx, parsed.data as never, ack);
        return;
      case "presence:join":
        respond(ack, { ok: true, data: presence.snapshot(ctx.identity.classId) });
        return;
      case "presence:leave":
        // An explicit leave closes the socket; the disconnect handler does the
        // rest. Duplicating the teardown here would give the service two code
        // paths for one thing, and only one of them would get fixed.
        respond(ack, { ok: true, data: { leaving: true } });
        ctx.socket.disconnect(true);
        return;
    }
  }

  /**
   * DISCONNECT TEARDOWN — the memory-leak acceptance criterion, in one place.
   *
   * Every per-socket allocation made anywhere in this file is released here:
   * the rate-limit bucket, the presence entry, the typing indicator, the room
   * membership (Socket.io does this itself, but leaving is explicit so a reader
   * does not have to know that), and the engagement counters, which are
   * FLUSHED before being dropped.
   */
  async function onDisconnect(ctx: HandlerContext, reason: string): Promise<void> {
    const { classId, userId } = ctx.identity;

    connectedSockets = Math.max(0, connectedSockets - 1);
    limiter.releaseSocket(ctx.socket.id);

    const wasLast = presence.leave(classId, userId);
    const record = engagement.onDisconnect(classId, userId);

    if (wasLast) {
      ctx.socket.to(ctx.room).emit("presence:left", {
        userId,
        presence: presence.snapshot(classId),
      });
    }

    if (record) {
      try {
        await store.engagement.flush(record);
      } catch (error) {
        // A failed engagement write must not be able to disturb anything. The
        // events it summarises are already persisted as chat and Q&A rows, so
        // the number is recomputable; see ./types.ts on why this is the one
        // thing here that is allowed to be lossy.
        log.error("failed to flush engagement on disconnect", { classId, userId, error });
      }
    }

    log.info("socket disconnected", { socketId: ctx.socket.id, userId, classId, reason });
  }

  // -------------------------------------------------------------------------
  // HTTP: health only. This service serves no application HTTP.
  // -------------------------------------------------------------------------
  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === "GET" && (req.url === "/healthz" || req.url === "/")) {
      const body = JSON.stringify({
        // "draining" rather than "ok" once SIGTERM has arrived, so a load
        // balancer stops sending new connections to a process that is leaving.
        status: closing ? "draining" : "ok",
        uptimeMs: Date.now() - startedAtMs,
        connectedSockets,
        store: store.kind,
        ...statsBody(),
      });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }

  function statsBody(): Record<string, unknown> {
    return {
      presence: presence.sizes(),
      rateLimiter: limiter.sizes(),
      engagement: engagement.sizes(),
    };
  }

  return {
    listen(port = config.port): Promise<number> {
      return new Promise((resolve, reject) => {
        http.once("error", reject);
        // 0.0.0.0 explicitly: Railway, Fly and Render all route to the container's
        // external interface, and Node's default of listening on :: alone has
        // caught deployments out on hosts without IPv6 routing.
        http.listen(port, "0.0.0.0", () => {
          http.removeListener("error", reject);
          const address = http.address() as AddressInfo | null;
          const bound = address ? address.port : port;
          log.info("realtime service listening", {
            port: bound,
            store: store.kind,
            allowedOrigins: config.allowedOrigins,
          });
          resolve(bound);
        });
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      closing = true;

      clearInterval(typingSweep);
      clearInterval(limiterSweep);

      // Flush what is still in memory BEFORE the sockets go away. Once the
      // sockets are closed the disconnect handlers race the process exit, and on
      // a platform that SIGKILLs after its grace window they lose.
      const pending = engagement.drainAll();
      for (const record of pending) {
        try {
          await store.engagement.flush(record);
        } catch (error) {
          log.error("failed to flush engagement during shutdown", { error });
        }
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        // io.close() closes the underlying HTTP server too. The timeout is the
        // backstop for a client that will not let go — without it, shutdown
        // waits on the slowest browser on the worst network in the cohort.
        const timer = setTimeout(finish, SHUTDOWN_GRACE_MS);
        timer.unref();
        io.close(() => {
          clearTimeout(timer);
          finish();
        });
      });

      await store.close();
      closed = true;
      log.info("realtime service closed");
    },

    stats() {
      return {
        uptimeMs: Date.now() - startedAtMs,
        connectedSockets,
        presence: presence.sizes(),
        rateLimiter: limiter.sizes(),
        engagement: engagement.sizes(),
      };
    },
  };
}

/** Re-exported so ./index.ts does not need to know the HTTP type. */
export type { HttpServer };
