// =============================================================================
// Tests for the socket.io adapter and the token fetcher.
// Owner: the real-time stream.
// -----------------------------------------------------------------------------
// WHAT IS WORTH TESTING HERE, given `use-realtime.test.tsx` already covers the
// connected path against a fake transport: this file is the MAPPING between the
// hook's four-method interface and a real socket, and every defect it can carry
// is silent. An `emit` that queues forever, a listener attached after the
// snapshot has already arrived, a socket constructed after unmount — none of
// them throws, and all of them present as "chat just does not update".
//
// The library is mocked rather than run: a genuine socket.io-client would need a
// server, and what is being asserted is the adapter's behaviour at the seam, not
// Socket.io's. The one real end-to-end message is not this file's job.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const { io, socket } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const sock = {
    handlers,
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      handlers.set(event, listener);
    }),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    // Parameters are declared even though the body ignores them: they are what
    // gives `io.mock.calls` a useful tuple type instead of `[]`.
    io: vi.fn((_url: string, _opts: Record<string, unknown>) => sock),
    socket: sock,
  };
});

vi.mock("socket.io-client", () => ({ io }));

import {
  createSocketTransport,
  fetchRealtimeToken,
  realtimeTokenPath,
} from "./socket-transport";
import type { TransportOptions } from "./use-realtime";

/** Let the adapter's internal `await import(...)` settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function options(overrides: Partial<TransportOptions> = {}): TransportOptions {
  return {
    url: "https://realtime.example.test",
    namespace: "/classes",
    token: "a-token",
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onConnectError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  socket.handlers.clear();
});

describe("createSocketTransport — the handshake", () => {
  it("connects to base + namespace with the token in `auth`, never in the URL", async () => {
    const opts = options();
    createSocketTransport(opts);
    await settle();

    expect(io).toHaveBeenCalledTimes(1);
    const [target, config] = io.mock.calls[0];
    expect(target).toBe("https://realtime.example.test/classes");
    expect(target).not.toContain("a-token");
    expect(config.auth).toEqual({ token: "a-token" });
  });

  it("tolerates a trailing slash on the configured service URL", async () => {
    createSocketTransport(options({ url: "https://realtime.example.test/" }));
    await settle();
    expect(io.mock.calls[0][0]).toBe("https://realtime.example.test/classes");
  });

  it("disables socket.io's own reconnection, because the token expires in 120 s", async () => {
    createSocketTransport(options());
    await settle();
    // A socket.io retry replays THIS token. After 120 s every such retry is
    // guaranteed to fail `expired`; re-minting is the hook's job.
    expect(io.mock.calls[0][1].reconnection).toBe(false);
  });
});

describe("createSocketTransport — mapping hook calls to socket events", () => {
  it("replays listeners registered BEFORE the module finished loading", async () => {
    const transport = createSocketTransport(options());
    const onSnapshot = vi.fn();
    // The hook registers all sixteen server events synchronously, immediately
    // after the factory returns and long before the dynamic import resolves.
    transport.on("class:snapshot", onSnapshot);
    expect(socket.on).not.toHaveBeenCalledWith("class:snapshot", expect.anything());

    await settle();
    socket.handlers.get("class:snapshot")?.({ classId: 1 });
    expect(onSnapshot).toHaveBeenCalledWith({ classId: 1 });
  });

  it("forwards an emit straight through once connected", async () => {
    const transport = createSocketTransport(options());
    await settle();
    transport.emit("chat:send", { body: "hello" });
    expect(socket.emit).toHaveBeenCalledWith("chat:send", { body: "hello" });
  });

  it("queues an emit made before the socket exists, then flushes it in order", async () => {
    const transport = createSocketTransport(options());
    transport.emit("chat:send", { body: "first" });
    transport.emit("chat:send", { body: "second" });
    expect(socket.emit).not.toHaveBeenCalled();

    await settle();
    expect(socket.emit.mock.calls.map((call) => call[1])).toEqual([
      { body: "first" },
      { body: "second" },
    ]);
  });

  it("reports connect, disconnect and connect_error through the hook's callbacks", async () => {
    const opts = options();
    createSocketTransport(opts);
    await settle();

    socket.handlers.get("connect")?.(undefined);
    expect(opts.onConnect).toHaveBeenCalledTimes(1);

    socket.handlers.get("disconnect")?.("transport close");
    expect(opts.onDisconnect).toHaveBeenCalledWith("transport close");

    const refusal = Object.assign(new Error("Unauthorized"), { data: { code: "expired" } });
    socket.handlers.get("connect_error")?.(refusal);
    // The service's machine-readable code is surfaced for support triage.
    expect(opts.onConnectError).toHaveBeenCalledWith("Unauthorized (expired)");
  });
});

describe("createSocketTransport — disposal", () => {
  it("disconnects the underlying socket", async () => {
    const transport = createSocketTransport(options());
    await settle();
    transport.disconnect();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("never leaks a socket when disposed while the chunk is still loading", async () => {
    const transport = createSocketTransport(options());
    transport.disconnect();
    await settle();
    // Either the socket was never constructed, or it was constructed at the
    // await boundary and torn down. Both are acceptable; a live socket nobody
    // holds a reference to is not.
    if (io.mock.calls.length > 0) expect(socket.disconnect).toHaveBeenCalled();
  });

  it("drops queued emits on disposal rather than sending them from a dead panel", async () => {
    const transport = createSocketTransport(options());
    transport.emit("chat:send", { body: "unmounted mid-type" });
    transport.disconnect();
    await settle();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe("fetchRealtimeToken", () => {
  const okBody = { ok: true, data: { token: "minted.token", expiresInMs: 120_000 } };

  it("POSTs same-origin to the minting route and returns the token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const token = await fetchRealtimeToken(7, fetchImpl as unknown as typeof fetch);

    expect(token).toBe("minted.token");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(realtimeTokenPath(7));
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
  });

  it("returns null — not a throw — for every refusal the server can answer with", async () => {
    for (const status of [404, 429, 503]) {
      const fetchImpl = vi.fn(async () => new Response("{}", { status }));
      await expect(fetchRealtimeToken(7, fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    }
  });

  it("returns null rather than undefined when the envelope changes shape", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} })));
    // A cast here would hand `undefined` to the handshake, which fails as
    // `missing_token` with no clue that the envelope was the cause.
    await expect(fetchRealtimeToken(7, fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });
});
