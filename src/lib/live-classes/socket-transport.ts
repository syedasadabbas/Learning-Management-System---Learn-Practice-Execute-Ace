"use client";

// =============================================================================
// SOCKET TRANSPORT — the adapter that plugs `socket.io-client` into the seam
// `use-realtime.ts` was built around, plus the token fetcher that feeds it.
// Owner: the real-time stream.
// -----------------------------------------------------------------------------
// `use-realtime.ts`'s header describes this file before it existed: "when
// `socket.io-client` is added, the whole integration is one adapter passed as
// `transportFactory`, plus a token endpoint. Nothing in the panels changes."
// That is exactly what this is, and the two things it was waiting for now exist
// — the dependency (socket.io-client, same 4.x family as the service's
// socket.io, so the Engine.IO handshake negotiates) and the minting route
// (POST /api/classes/:classId/realtime-token).
//
// ## WHY THE IMPORT IS DYNAMIC, AND WHY THAT FORCES A QUEUE
//
// `socket.io-client` must never be evaluated on the server. It is not merely
// dead weight in a Node bundle: it reaches for browser globals, and a Next.js
// server component tree that transitively imports it pays for it on every
// render. A `"use client"` directive is NOT sufficient on its own — client
// modules are still executed during SSR to produce the initial HTML. So the
// import is a dynamic `import()` behind a `typeof window` check, taken only when
// a transport is actually being constructed, which by the hook's gate only
// happens in a browser with a configured service URL.
//
// The consequence is the awkward part of this file and it is worth stating
// plainly: `TransportFactory` is SYNCHRONOUS — the hook calls it and immediately
// registers sixteen listeners — while `import()` is not. The adapter therefore
// returns a facade at once and QUEUES every `on`/`off`/`emit` until the module
// and the socket exist. Making the factory async instead would have been the
// tidier shape and was rejected: it would change the hook's signature, and the
// hook's connect/backoff/dispose logic is already written and tested against the
// synchronous one. The seam is the contract; the adapter bends, not the seam.
//
// ## WHAT THIS FILE DELIBERATELY DOES NOT DO
//
// No reconnection. `socket.io-client` has its own reconnection engine and it is
// turned OFF (`reconnection: false`). Two reconnect policies racing is not twice
// the resilience, it is two: the hook's backoff would schedule a fresh connect
// while the socket was independently retrying, producing duplicate sockets that
// the service's per-user cap then rejects as `too_many_sockets`. More decisively,
// socket.io's own retry REPLAYS THE ORIGINAL HANDSHAKE AUTH, and the token in it
// has a 120-second life — every such retry after that window is guaranteed to
// fail `expired`. The hook re-mints before every attempt; socket.io cannot. So
// the hook owns reconnection entirely and this adapter only ever reports.
//
// No backoff, no attempt ceiling, no dispose timer here either, for the same
// reason: they exist in `use-realtime.ts` and are covered by its tests.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import type { RealtimeTransport, TransportOptions } from "./use-realtime";

/** Minimal structural view of the socket object we use. See the header on why
 * this is not `Socket` imported from socket.io-client: a type-only import would
 * be safe, but keeping the surface local documents exactly which four methods
 * this adapter depends on, and keeps the file readable without the library. */
interface MinimalSocket {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener?: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(): unknown;
}

/** One buffered call, replayed in order once the socket exists. */
type QueuedCall =
  | { kind: "on"; event: string; listener: (payload: unknown) => void }
  | { kind: "off"; event: string; listener?: (payload: unknown) => void }
  | { kind: "emit"; event: string; payload: unknown };

/**
 * Load the socket.io client factory, in a browser only.
 *
 * Extracted so tests can assert the guard's behaviour without a DOM, and so the
 * one `import()` expression in this repository that must not reach the server
 * bundle lives at a single, findable place.
 */
async function loadIo(): Promise<
  ((url: string, opts: Record<string, unknown>) => MinimalSocket) | null
> {
  if (typeof window === "undefined") return null;
  const mod = await import("socket.io-client");
  return (url, opts) => mod.io(url, opts) as unknown as MinimalSocket;
}

/**
 * Build a `RealtimeTransport` over socket.io-client.
 *
 * Returns immediately with a facade; the real socket attaches shortly after. If
 * the module fails to load (offline, chunk 404 after a deploy) the failure is
 * reported through `onConnectError`, NOT thrown — the hook's contract is that a
 * transport reports its failures through the callbacks it was handed, and a
 * throw from a factory called inside an effect would surface as an unhandled
 * rejection and leave the hook stuck in `connecting` forever.
 */
export function createSocketTransport(options: TransportOptions): RealtimeTransport {
  let socket: MinimalSocket | null = null;
  let disposed = false;
  const queue: QueuedCall[] = [];

  const apply = (call: QueuedCall): void => {
    if (socket === null) {
      queue.push(call);
      return;
    }
    if (call.kind === "on") socket.on(call.event, (payload) => call.listener(payload));
    else if (call.kind === "off") socket.off(call.event, call.listener);
    else socket.emit(call.event, call.payload);
  };

  void (async () => {
    let io: Awaited<ReturnType<typeof loadIo>>;
    try {
      io = await loadIo();
    } catch {
      options.onConnectError("the live-updates client could not be loaded");
      return;
    }
    // Null means server-side. Silent rather than an error: the hook's gate means
    // this cannot legitimately happen, and reporting a connect error during SSR
    // would put a "reconnecting" badge into the initial HTML.
    if (io === null) return;
    // Disposed while the chunk was in flight — unmount during a slow load is the
    // common case on a page that redirects. Never construct the socket.
    if (disposed) return;

    // The URL is base + namespace, which is how socket.io-client addresses a
    // namespace; the service registers `/classes` (see use-realtime's
    // REALTIME_NAMESPACE, echoed by the minting route).
    const target = `${options.url.replace(/\/+$/, "")}${options.namespace}`;

    const created = io(target, {
      // THE TOKEN GOES IN `auth`, NOT THE QUERY STRING. The service's handshake
      // middleware accepts a `?token=` fallback for proxies that mangle the auth
      // payload, and its header is explicit that `auth` is what the client uses:
      // a URL is logged by every proxy, CDN and browser history on the path.
      auth: { token: options.token },
      // See the header. The hook re-mints a token per attempt; socket.io would
      // replay this expired one.
      reconnection: false,
      // Websocket first, with polling still available as a fallback for networks
      // that block the upgrade. Not websocket-only: a corporate proxy that
      // refuses the upgrade would otherwise mean no live class at all rather
      // than a slower one.
      transports: ["websocket", "polling"],
      withCredentials: false,
    });

    socket = created;

    created.on("connect", () => options.onConnect());
    created.on("disconnect", (reason: unknown) =>
      options.onDisconnect(typeof reason === "string" ? reason : "the connection dropped"),
    );
    created.on("connect_error", (error: unknown) => {
      // The service sends a machine-readable `data.code` (expired,
      // bad_signature, too_many_sockets ...) precisely so a client can tell a
      // retryable failure from a misconfiguration. The hook currently treats all
      // of them as retryable and its backoff bounds the damage, so the code is
      // surfaced in the message for support triage rather than branched on here.
      const code =
        typeof error === "object" && error !== null && "data" in error
          ? (error as { data?: { code?: unknown } }).data?.code
          : undefined;
      const message = error instanceof Error ? error.message : "the server refused the connection";
      options.onConnectError(typeof code === "string" ? `${message} (${code})` : message);
    });

    for (const call of queue.splice(0)) apply(call);

    // Disposed between the guard above and here (the `await` boundary is the
    // window). Tear down rather than leak a socket nobody holds a reference to.
    if (disposed) {
      socket = null;
      created.disconnect();
    }
  })();

  return {
    on: (event, listener) => apply({ kind: "on", event, listener }),
    off: (event, listener) => apply({ kind: "off", event, listener }),
    emit: (event, payload) => apply({ kind: "emit", event, payload }),
    disconnect: () => {
      disposed = true;
      // Anything still queued is for a socket that will never exist. Dropping it
      // is deliberate: replaying an emit onto a socket created after disposal is
      // how a torn-down panel sends a message.
      queue.length = 0;
      const live = socket;
      socket = null;
      live?.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// The token fetcher
// ---------------------------------------------------------------------------

/** Path of the minting route. One copy; the ROUTES map is the other. */
export function realtimeTokenPath(classId: number): string {
  return `/api/classes/${classId}/realtime-token`;
}

/**
 * Ask the app for a fresh handshake token.
 *
 * NULL VERSUS THROW IS A REAL DISTINCTION HERE and the hook acts on both, so it
 * is worth being precise: this returns null for "the server answered, and the
 * answer is no" (404 because the class is over or the flag is off, 503 because
 * the deployment has no shared secret, 429 because we asked too fast) and
 * THROWS for "we could not ask" (network down, JSON garbage). The hook retries
 * either way with the same backoff — the difference is in the message the
 * student sees, and "this class is not accepting live connections" is a better
 * thing to read during a deploy than "could not obtain a connection token".
 *
 * `fetchImpl` is injectable in the house style (see LiveClassRoom's own prop) so
 * a test never touches the network.
 */
export async function fetchRealtimeToken(
  classId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchImpl(realtimeTokenPath(classId), {
    method: "POST",
    // Same-origin: the token route is the Next app's, not the socket service's.
    // The session cookie is what identifies the caller and the whole point of
    // the token is that the socket service cannot read it.
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });

  if (!response.ok) return null;

  const body: unknown = await response.json();
  // The frozen envelope is `{ ok: true, data: {...} }`. Narrowed structurally
  // rather than cast: this value crosses a process boundary, and a cast here
  // would turn a changed envelope into `undefined` passed to the handshake.
  if (typeof body !== "object" || body === null || !("data" in body)) return null;
  const data = (body as { data?: { token?: unknown } }).data;
  return typeof data?.token === "string" ? data.token : null;
}

/** Bound to the default `fetch`, for use as the hook's `fetchToken`. Module-level
 * so its identity is stable across renders — an inline arrow here would re-run
 * the hook's connect effect on every parent render and churn sockets. */
export const defaultFetchRealtimeToken = (classId: number): Promise<string | null> =>
  fetchRealtimeToken(classId);
