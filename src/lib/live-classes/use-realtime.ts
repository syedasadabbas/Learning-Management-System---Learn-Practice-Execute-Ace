"use client";

// =============================================================================
// useRealtime — the client half of the live-class text layer, and the reason a
// live class still works when that layer is absent.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
//
// ## READ THIS FIRST: IN THIS REPOSITORY, THE DEGRADED PATH IS THE ONLY PATH.
//
// That is not a design choice, it is the current state of the tree, and it is
// stated here rather than discovered later because two things are missing and
// NEITHER is within this stream's blast radius to add:
//
//   1. `socket.io-client` IS NOT A DEPENDENCY. `package.json` lists reveal.js,
//      framer-motion, sandpack and thirty others; there is no socket client.
//      This stream may not edit `package.json`. Writing `import("socket.io-client")`
//      anyway would not fail gracefully — webpack resolves dynamic imports
//      statically, so `next build` would fail outright, which is a worse failure
//      than the one it was trying to avoid.
//
//   2. NOTHING MINTS A HANDSHAKE TOKEN. `src/lib/live-classes/realtime-token.ts`
//      exists and is tested, the Socket.io service in `services/realtime` verifies
//      it correctly, and `services/realtime/src/auth/middleware.ts` reads it from
//      `handshake.auth.token`. But no route in the frozen `ROUTES` map returns
//      one, and there is no handler anywhere under `src/app/api/**` that calls
//      `mintRealtimeToken`. The browser therefore has no way to obtain the
//      credential the service requires. This stream may not add API routes.
//
// So this hook is built as the SEAM those two pieces will plug into, and it
// takes the degraded path unconditionally today. That is a genuinely correct
// outcome rather than a stub, because the feature's own configuration module
// already says so: `liveClassesConfig.realtimeUrl`'s doc comment reads
// "Undefined is a SUPPORTED state, not a misconfiguration ... A live class must
// not fail because a $0 hobby dyno slept." The class runs on Jitsi for video and
// HTTP for attendance; only the live text layer degrades, into REST polling.
//
// ## WHAT "DEGRADED" MUST MEAN, PRECISELY
//
// When `isRealtimeAvailable()` is false the hook must:
//   - construct NO transport (assertable: the injected factory is never called),
//   - request NO token,
//   - schedule NO retry, no backoff, no timer of any kind,
//   - report `mode: "unavailable"` so the panels render from REST history and
//     disable the composer rather than offering a send that silently vanishes.
// A retry loop against `undefined` is the specific bug the config module warns
// about, and it is the reason `isRealtimeAvailable()` checks the URL and not
// just the flag.
//
// ## THE TRANSPORT SEAM
//
// `RealtimeTransport` is the minimum surface of a Socket.io client this hook
// uses. When `socket.io-client` is added, the whole integration is one adapter
// (~20 lines) passed as `transportFactory`, plus a token endpoint. Nothing in
// the panels changes. The interface is deliberately NOT `Socket` from
// socket.io-client: typing against a package that is not installed does not
// compile, and typing against a structural subset is what makes this hook
// testable with a fake.
//
// ## TOKEN REFRESH
//
// `REALTIME_TOKEN_TTL_MS` is 120 s and the token is single-use, for the upgrade
// only. A reconnect after that window needs a FRESH token — reusing the held one
// gets `expired` from the middleware, which is exactly the failure that turns a
// transient disconnect into a permanent one. So `fetchToken` is called before
// EVERY connect attempt, including every reconnect, and the previous token is
// never cached. The cost is one HTTP round trip per reconnect, which is the
// correct price.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import * as React from "react";

import { isRealtimeAvailable, liveClassesConfig } from "@/lib/features";

// ---------------------------------------------------------------------------
// Wire shapes — mirrors of services/realtime/src/types.ts
// ---------------------------------------------------------------------------
//
// DUPLICATED, NOT IMPORTED, for the reason that file gives for duplicating them
// from the app: `services/realtime` is a separate npm package with its own
// install and its own deploy target, and `@/` does not resolve into it. The
// duplication is the seam; a test asserts nothing here, so the discipline is
// that this block and that file are edited together.

export type RealtimeRole = "student" | "instructor" | "admin";

export interface RealtimeChatMessage {
  id: number;
  classId: number;
  authorId: number;
  authorName: string | null;
  authorRole: RealtimeRole;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinned: boolean;
  reactions: Record<string, number[]>;
}

export interface RealtimeQaQuestion {
  id: number;
  classId: number;
  askerId: number;
  askerName: string | null;
  body: string;
  createdAt: string;
  answerBody: string | null;
  answeredById: number | null;
  answeredAt: string | null;
  upvotes: number;
  pinned: boolean;
  resolvedAt: string | null;
}

/** Payload of the `class:snapshot` event the service sends on connect. */
export interface ClassSnapshot {
  classId: number;
  messages: RealtimeChatMessage[];
  questions: RealtimeQaQuestion[];
  presence: unknown;
}

/**
 * Every event name the CLIENT may emit.
 *
 * Copied verbatim from `EVENT_SCHEMAS` in services/realtime/src/schemas.ts. A
 * name that is not in that map is silently ignored by the server — there is no
 * error, the message just never arrives — which is the most expensive kind of
 * typo, so the union makes it a compile error instead.
 */
export const CLIENT_EVENTS = [
  "chat:send",
  "chat:edit",
  "chat:delete",
  "chat:pin",
  "chat:typing",
  "chat:react",
  "qa:ask",
  "qa:answer",
  "qa:upvote",
  "qa:pin",
  "qa:resolve",
  "presence:join",
  "presence:leave",
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/**
 * Every event name the SERVER emits, from the `.emit(...)` call sites in
 * services/realtime/src/handlers/*.ts and server.ts.
 */
export const SERVER_EVENTS = [
  "class:snapshot",
  "class:snapshot:error",
  "chat:message",
  "chat:edited",
  "chat:deleted",
  "chat:pinned",
  "chat:typing",
  "chat:reacted",
  "qa:asked",
  "qa:answered",
  "qa:answered:mine",
  "qa:upvoted",
  "qa:pinned",
  "qa:resolved",
  "presence:joined",
  "presence:left",
] as const;

export type ServerEvent = (typeof SERVER_EVENTS)[number];

// ---------------------------------------------------------------------------
// The transport seam
// ---------------------------------------------------------------------------

/** The subset of a Socket.io client this hook uses. See the module header. */
export interface RealtimeTransport {
  on(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener?: (payload: unknown) => void): void;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  disconnect(): void;
}

export interface TransportOptions {
  /** Base URL of the service, e.g. `https://realtime.example.com`. */
  url: string;
  /** The `/classes` namespace path the server registers. */
  namespace: string;
  /** Handshake credential. Goes in `handshake.auth.token`. */
  token: string;
  /** Called by the adapter once the socket is up. */
  onConnect: () => void;
  /** Called with the server's reason string on any disconnect. */
  onDisconnect: (reason: string) => void;
  /** Called when the handshake itself is refused (bad token, too many sockets). */
  onConnectError: (message: string) => void;
}

export type TransportFactory = (options: TransportOptions) => RealtimeTransport;

/** The namespace `services/realtime/src/server.ts` registers. */
export const REALTIME_NAMESPACE = "/classes";

// ---------------------------------------------------------------------------
// Reconnection policy
// ---------------------------------------------------------------------------

/** First retry delay. */
export const BACKOFF_BASE_MS = 1_000;
/** Ceiling, so a long outage does not become a 20-minute wait after recovery. */
export const BACKOFF_MAX_MS = 30_000;
/** Give up after this many consecutive failures and stay in REST mode. */
export const MAX_RECONNECT_ATTEMPTS = 6;

/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration: a class ends and eighty browsers reconnect. Without
 * it they all retry at t+1s, t+2s, t+4s in lockstep and the service is
 * thundering-herded by its own clients at the exact moment it is recovering.
 * Full jitter (uniform over [0, delay]) is the variant that spreads them best.
 *
 * @param attempt 1-based consecutive failure count
 * @param random  injectable for tests; defaults to Math.random
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const capped = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
  return Math.round(random() * capped);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * How the text layer is currently operating. Rendered by the panels as a status
 * badge, because "is my message going anywhere?" is a question a student in a
 * class will ask, and a silent read-only chat is indistinguishable from a
 * broken one.
 */
export type RealtimeMode =
  /** No service configured, or the feature is off. Panels poll REST. */
  | "unavailable"
  /** A connection is being established or re-established. */
  | "connecting"
  /** Connected. */
  | "live"
  /** Was live, lost the socket, will retry. Panels poll REST meanwhile. */
  | "reconnecting"
  /** Retries exhausted or the handshake was refused permanently. REST only. */
  | "failed";

export interface UseRealtimeOptions {
  classId: number;
  /**
   * Obtain a FRESH handshake token. Called before every connect and every
   * reconnect — never cached, see the header.
   *
   * Omit it and the hook stays `unavailable`. That is the current state of this
   * repository: no route mints one.
   */
  fetchToken?: (classId: number) => Promise<string | null>;
  /** Build the transport. Omit and the hook stays `unavailable`. */
  transportFactory?: TransportFactory;
  /** Server-event handlers, keyed by event name. Stable identity not required. */
  handlers?: Partial<Record<ServerEvent, (payload: unknown) => void>>;
  /**
   * Override the availability decision. Tests use it in BOTH directions; product
   * code never passes it and gets `isRealtimeAvailable()`.
   */
  available?: boolean;
  /**
   * Base URL of the socket service.
   *
   * Defaults to `liveClassesConfig.realtimeUrl`. Injectable because that value
   * comes from a `NEXT_PUBLIC_*` variable which Next.js INLINES AT BUILD TIME —
   * it cannot be set from a test, so a hook that read it directly would have an
   * untestable connected path, and an untested connected path is one nobody
   * notices is broken until a class is running.
   */
  serviceUrl?: string;
}

export interface UseRealtimeResult {
  mode: RealtimeMode;
  /** True only in `live`. The composer's `disabled` should be its negation. */
  connected: boolean;
  /**
   * Send an event. Returns false when there is no live socket, so an optimistic
   * UI knows immediately to roll back rather than waiting for an ack that will
   * never come.
   */
  send: (event: ClientEvent, payload: unknown) => boolean;
  /** Human-readable reason for `failed`/`reconnecting`, for the status line. */
  detail: string | null;
  /** Consecutive failed attempts. Zero while live. */
  attempts: number;
}

export function useRealtime(options: UseRealtimeOptions): UseRealtimeResult {
  const { classId, fetchToken, transportFactory, handlers, available, serviceUrl } = options;

  const url = serviceUrl ?? liveClassesConfig.realtimeUrl;

  // THE GATE. Three independent conditions, all required, evaluated before any
  // effect body runs:
  //   - the feature flag is on AND a service URL is configured
  //     (`isRealtimeAvailable()` — its own doc explains why the URL check is not
  //     redundant with the flag),
  //   - a transport factory was supplied (no socket library in this repo),
  //   - a token source was supplied (no minting route in this repo).
  // `available` overrides only downwards in tests; it can force the degraded
  // branch, never force a connection.
  const gated =
    (available ?? isRealtimeAvailable()) &&
    url !== undefined &&
    transportFactory !== undefined &&
    fetchToken !== undefined;

  const [mode, setMode] = React.useState<RealtimeMode>(gated ? "connecting" : "unavailable");
  const [detail, setDetail] = React.useState<string | null>(null);
  const [attempts, setAttempts] = React.useState(0);

  const transportRef = React.useRef<RealtimeTransport | null>(null);
  // Handlers live in a ref so a parent re-rendering with a fresh object literal
  // does not tear down and rebuild the socket on every keystroke.
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    if (!gated) {
      // Explicitly NOT a no-op with a comment: the state is set so a hook that
      // was live and then had its configuration removed reports the truth.
      setMode("unavailable");
      setDetail(null);
      setAttempts(0);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const detach = () => {
      const transport = transportRef.current;
      if (!transport) return;
      for (const event of SERVER_EVENTS) transport.off(event);
      transport.disconnect();
      transportRef.current = null;
    };

    const scheduleRetry = (reason: string) => {
      if (cancelled) return;
      attempt += 1;
      setAttempts(attempt);

      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        // Stop. A client that retries forever against a service that is not
        // coming back is a battery drain and a log flood, and the panels are
        // already usable over REST — there is nothing to gain by continuing.
        setMode("failed");
        setDetail(
          `Live updates are unavailable (${reason}). Messages will refresh periodically instead.`,
        );
        return;
      }

      setMode("reconnecting");
      setDetail(reason);
      retryTimer = setTimeout(() => {
        void connect();
      }, backoffDelayMs(attempt));
    };

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      detach();
      setMode((current) => (current === "reconnecting" ? current : "connecting"));

      // A FRESH token every time. The 120 s TTL means the one held from the
      // first connect is worthless by the second reconnect, and reusing it
      // yields `expired` from the handshake middleware — a permanent-looking
      // failure with a transient cause.
      let token: string | null;
      try {
        token = await fetchToken(classId);
      } catch {
        scheduleRetry("could not obtain a connection token");
        return;
      }
      if (cancelled) return;
      if (token === null) {
        scheduleRetry("this class is not accepting live connections");
        return;
      }

      const transport = transportFactory({
        url,
        namespace: REALTIME_NAMESPACE,
        token,
        onConnect: () => {
          if (cancelled) return;
          attempt = 0;
          setAttempts(0);
          setMode("live");
          setDetail(null);
        },
        onDisconnect: (reason) => {
          if (cancelled) return;
          scheduleRetry(reason || "the connection dropped");
        },
        onConnectError: (message) => {
          if (cancelled) return;
          scheduleRetry(message || "the server refused the connection");
        },
      });

      // Registered through the ref, so the listener identity is stable for the
      // socket's lifetime while the handler it calls can change freely.
      for (const event of SERVER_EVENTS) {
        transport.on(event, (payload: unknown) => {
          handlersRef.current?.[event]?.(payload);
        });
      }

      transportRef.current = transport;
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      detach();
    };
  }, [classId, fetchToken, gated, transportFactory, url]);

  // `send` must be stable (the composer passes it to a memoised handler) but
  // must also see the CURRENT mode. A ref, not a dependency: rebuilding the
  // callback on every mode change would re-render every consumer of it.
  const modeRef = React.useRef(mode);
  modeRef.current = mode;

  const send = React.useCallback<UseRealtimeResult["send"]>((event, payload) => {
    const transport = transportRef.current;
    // Both conditions. A transport that exists but is mid-reconnect will accept
    // an emit and drop it on the floor; returning true there is what makes an
    // optimistic message sit in the transcript forever instead of rolling back.
    if (transport === null || modeRef.current !== "live") return false;
    transport.emit(event, payload);
    return true;
  }, []);

  return {
    mode,
    connected: mode === "live",
    send,
    detail,
    attempts,
  };
}
