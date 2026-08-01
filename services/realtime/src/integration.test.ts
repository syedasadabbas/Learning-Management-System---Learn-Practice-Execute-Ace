// =============================================================================
// INTEGRATION — a real server on an ephemeral port, real Socket.io clients.
// -----------------------------------------------------------------------------
// This is the only test file that boots the whole thing. Everything else here
// tests a structure in isolation, which is faster and sharper; this one exists
// to prove the pieces are actually wired together — a handshake that runs, a
// room that a message reaches, an authorization rule that is consulted on the
// live path rather than only in a unit test.
//
// ON THE LATENCY NUMBER. It is MEASURED and REPORTED, not asserted against a
// figure taken from the brief. Loopback on a developer's machine tells you
// approximately nothing about a student on hotel wifi talking to a container in
// Virginia; the only honest claim it supports is "the service itself adds
// approximately X, so essentially all of the observed latency is network and
// database". The assertion is a loose sanity bound — an order of magnitude
// wrong would mean something is genuinely broken (a synchronous sweep, an
// accidental await on every socket) and that is worth catching.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";

import { mintRealtimeTokenForTests } from "./auth/token";
import type { RealtimeConfig } from "./config";
import { createRealtimeServer, type RealtimeServer } from "./server";
import { createMemoryStore } from "./store/memory";
import type { RealtimeRole } from "./types";

const SECRET = "integration-secret-at-least-32-chars!!";
const CLASS_ID = 77;

const config: RealtimeConfig = {
  port: 0,
  sharedSecret: SECRET,
  // The client library sends no Origin header from Node, so the allowlist is
  // not exercised here. It is exercised by the browser, which is the only place
  // it can be. Recorded so nobody reads this as coverage of CORS.
  allowedOrigins: ["http://localhost:3000"],
  databaseUrl: null,
  maxSocketsPerUser: 4,
  engagementIdleTtlMs: 1_800_000,
};

let server: RealtimeServer;
let store: ReturnType<typeof createMemoryStore>;
let port: number;
const openClients: ClientSocket[] = [];

function tokenFor(userId: number, role: RealtimeRole, classId = CLASS_ID): string {
  return mintRealtimeTokenForTests({
    userId,
    role,
    classId,
    secret: SECRET,
    expiresAtMs: Date.now() + 120_000,
    nonce: `n-${userId}`,
  });
}

async function connect(userId: number, role: RealtimeRole, classId = CLASS_ID): Promise<ClientSocket> {
  const client = createClient(`http://127.0.0.1:${port}/classes`, {
    auth: { token: tokenFor(userId, role, classId) },
    transports: ["websocket"],
    reconnection: false,
  });
  openClients.push(client);

  // Wait for the SNAPSHOT, not merely for `connect`. The server emits
  // `class:snapshot` immediately on connection, so a test that connects and only
  // then attaches a listener has already missed it — a race that shows up as an
  // intermittent "no class:snapshot" and reads like a server fault. Settling the
  // helper on the snapshot means every test starts from a fully joined client.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out connecting")), 5_000);
    client.once("class:snapshot", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return client;
}

/** Emit and await the ack, with a timeout so a hang fails rather than stalls. */
function emit<T = unknown>(client: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5_000);
    client.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function once<T = unknown>(client: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), timeoutMs);
    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeEach(async () => {
  store = createMemoryStore();
  server = createRealtimeServer(config, store);
  port = await server.listen(0);
});

afterEach(async () => {
  for (const client of openClients.splice(0)) client.close();
  await server.close();
});

describe("handshake over a real socket", () => {
  it("accepts a valid token", async () => {
    const client = await connect(1, "student");
    expect(client.connected).toBe(true);
  });

  it("refuses a connection with no token, with a code the client can read", async () => {
    const client = createClient(`http://127.0.0.1:${port}/classes`, {
      transports: ["websocket"],
      reconnection: false,
    });
    openClients.push(client);

    const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => {
      client.once("connect_error", (err) => resolve(err as Error & { data?: { code?: string } }));
    });
    expect(error.data?.code).toBe("missing_token");
  });

  it("refuses an expired token", async () => {
    const stale = mintRealtimeTokenForTests({
      userId: 1,
      role: "student",
      classId: CLASS_ID,
      secret: SECRET,
      expiresAtMs: Date.now() - 1,
    });
    const client = createClient(`http://127.0.0.1:${port}/classes`, {
      auth: { token: stale },
      transports: ["websocket"],
      reconnection: false,
    });
    openClients.push(client);

    const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => {
      client.once("connect_error", (err) => resolve(err as Error & { data?: { code?: string } }));
    });
    expect(error.data?.code).toBe("expired");
  });

  it("sends a snapshot of history on connect", async () => {
    await store.chat.create({
      classId: CLASS_ID,
      authorId: 1,
      authorRole: "student",
      body: "said earlier",
    });

    const client = createClient(`http://127.0.0.1:${port}/classes`, {
      auth: { token: tokenFor(2, "student") },
      transports: ["websocket"],
      reconnection: false,
    });
    openClients.push(client);

    const snapshot = await once<{ messages: { body: string }[] }>(client, "class:snapshot");
    expect(snapshot.messages.map((m) => m.body)).toContain("said earlier");
  });
});

describe("broadcast", () => {
  it("delivers a message from one client to another in the same class, and reports the latency", async () => {
    const alice = await connect(1, "student");
    const bob = await connect(2, "student");

    // Warm the path once so the measurement is not dominated by the first
    // WebSocket frame, the first JSON parse and V8's first pass through the
    // handler — none of which represent steady-state behaviour.
    const warmup = once(bob, "chat:message");
    await emit(alice, "chat:send", { body: "warmup" });
    await warmup;

    const samples: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      // PACED AT 4/s, under the limiter's 5/s refill. Firing 20 messages as fast
      // as the loop allows exhausts the token bucket, the server correctly
      // answers `rate_limited`, no broadcast happens, and the test times out
      // looking like a delivery failure. The limiter is the subject of its own
      // test; here it must simply be stayed out of the way of.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const received = once<{ body: string }>(bob, "chat:message");
      const sentAt = process.hrtime.bigint();
      const ack = await emit<{ ok: boolean }>(alice, "chat:send", { body: `sample ${i}` });
      expect(ack.ok).toBe(true);
      const message = await received;
      const elapsedMs = Number(process.hrtime.bigint() - sentAt) / 1_000_000;
      expect(message.body).toBe(`sample ${i}`);
      samples.push(elapsedMs);
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;

    // Reported, not asserted. See the file header for why a "<500 ms" assertion
    // from a loopback measurement would be theatre.
    process.stdout.write(
      JSON.stringify({
        measurement: "chat:send -> peer chat:message",
        transport: "websocket over loopback",
        store: "in-memory",
        samples: samples.length,
        medianMs: Number(median.toFixed(3)),
        p95Ms: Number(p95.toFixed(3)),
        minMs: Number((samples[0] ?? 0).toFixed(3)),
        maxMs: Number((samples[samples.length - 1] ?? 0).toFixed(3)),
      }) + "\n",
    );

    // A loose sanity bound: an order of magnitude past this means something is
    // structurally wrong, not that the network was slow.
    expect(median).toBeLessThan(100);
  });

  it("does not deliver a message across classes", async () => {
    const inClass = await connect(1, "student", CLASS_ID);
    const elsewhere = await connect(2, "student", CLASS_ID + 1);

    let leaked = false;
    elsewhere.on("chat:message", () => {
      leaked = true;
    });

    await emit(inClass, "chat:send", { body: "private to 77" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(leaked).toBe(false);
  });
});

describe("authorization on the live path", () => {
  it("refuses chat:pin from a student", async () => {
    // The rule is unit-tested in authz.test.ts; this asserts it is actually
    // consulted by the dispatcher rather than only existing in a table.
    const alice = await connect(1, "student");
    const message = await store.chat.create({
      classId: CLASS_ID,
      authorId: 1,
      authorRole: "student",
      body: "pin me",
    });

    const response = await emit<{ ok: boolean; code?: string }>(alice, "chat:pin", {
      messageId: message.id,
      pinned: true,
    });
    expect(response).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("permits chat:pin from an instructor", async () => {
    const teacher = await connect(9, "instructor");
    const message = await store.chat.create({
      classId: CLASS_ID,
      authorId: 1,
      authorRole: "student",
      body: "pin me",
    });

    const response = await emit<{ ok: boolean }>(teacher, "chat:pin", {
      messageId: message.id,
      pinned: true,
    });
    expect(response.ok).toBe(true);
  });

  it("refuses qa:answer from a student and accepts it from an instructor", async () => {
    const student = await connect(1, "student");
    const teacher = await connect(9, "instructor");
    const asked = await emit<{ ok: true; data: { question: { id: number } } }>(student, "qa:ask", {
      body: "why does this work?",
    });

    const refused = await emit<{ ok: boolean; code?: string }>(student, "qa:answer", {
      questionId: asked.data.question.id,
      body: "I reckon",
    });
    expect(refused).toMatchObject({ ok: false, code: "forbidden" });

    const accepted = await emit<{ ok: boolean }>(teacher, "qa:answer", {
      questionId: asked.data.question.id,
      body: "because of the event loop",
    });
    expect(accepted.ok).toBe(true);
  });

  it("tells the asker specifically when their question is answered", async () => {
    const student = await connect(1, "student");
    const other = await connect(2, "student");
    const teacher = await connect(9, "instructor");

    const asked = await emit<{ ok: true; data: { question: { id: number } } }>(student, "qa:ask", {
      body: "why?",
    });

    let otherGotPersonal = false;
    other.on("qa:answered:mine", () => {
      otherGotPersonal = true;
    });

    const mine = once(student, "qa:answered:mine");
    await emit(teacher, "qa:answer", { questionId: asked.data.question.id, body: "because" });
    await mine;

    expect(otherGotPersonal).toBe(false);
  });
});

describe("validation on the live path", () => {
  it("refuses an oversize message with invalid_payload", async () => {
    const alice = await connect(1, "student");
    const response = await emit<{ ok: boolean; code?: string }>(alice, "chat:send", {
      body: "x".repeat(2_001),
    });
    expect(response).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("ignores a client-supplied author id — the persisted row uses the token's", async () => {
    const alice = await connect(1, "student");
    // The extra field makes the payload fail .strict(), which is the desired
    // outcome: the field is refused rather than quietly dropped.
    const response = await emit<{ ok: boolean; code?: string }>(alice, "chat:send", {
      body: "hi",
      authorId: 999,
    });
    expect(response).toMatchObject({ ok: false, code: "invalid_payload" });

    await emit(alice, "chat:send", { body: "hi" });
    const history = await store.chat.history(CLASS_ID, 10);
    expect(history.at(-1)?.authorId).toBe(1);
  });
});

describe("rate limiting on the live path", () => {
  it("refuses a flood and says how long to wait", async () => {
    const alice = await connect(1, "student");

    const responses: { ok: boolean; code?: string; retryAfterMs?: number }[] = [];
    for (let i = 0; i < 20; i += 1) {
      responses.push(await emit(alice, "chat:send", { body: `flood ${i}` }));
    }

    const refused = responses.filter((r) => !r.ok);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0]?.code).toBe("rate_limited");
    expect(refused[0]?.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("presence and teardown", () => {
  it("announces a join and a leave, counting distinct users", async () => {
    const alice = await connect(1, "student");

    const joined = once<{ userId: number; presence: { users: number } }>(alice, "presence:joined");
    const bob = await connect(2, "student");
    const event = await joined;

    expect(event.userId).toBe(2);
    expect(event.presence.users).toBe(2);

    const left = once<{ userId: number }>(alice, "presence:left");
    bob.close();
    expect((await left).userId).toBe(2);
  });

  it("releases every per-socket allocation on disconnect", async () => {
    // The memory-leak acceptance criterion, asserted end to end rather than
    // structure by structure.
    const clients = await Promise.all([
      connect(1, "student"),
      connect(2, "student"),
      connect(3, "instructor"),
    ]);
    for (const client of clients) await emit(client, "chat:send", { body: "hello" });

    expect(server.stats().connectedSockets).toBe(3);

    for (const client of clients) client.close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const stats = server.stats();
    expect(stats.connectedSockets).toBe(0);
    expect(stats.presence).toEqual({ classes: 0, sockets: 0 });
    expect(stats.rateLimiter.sockets).toBe(0);
    expect(stats.engagement).toEqual({ tracked: 0, connected: 0 });
  });

  it("flushes engagement on disconnect", async () => {
    const alice = await connect(1, "student");
    await emit(alice, "chat:send", { body: "one" });
    await emit(alice, "qa:ask", { body: "a question" });

    alice.close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const flushed = store.flushedEngagement();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ userId: 1, classId: CLASS_ID, messagesSent: 1, questionsAsked: 1 });
  });

  it("enforces the per-user socket cap", async () => {
    await connect(1, "student");
    await connect(1, "student");
    await connect(1, "student");
    await connect(1, "student");

    const fifth = createClient(`http://127.0.0.1:${port}/classes`, {
      auth: { token: tokenFor(1, "student") },
      transports: ["websocket"],
      reconnection: false,
    });
    openClients.push(fifth);

    const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => {
      fifth.once("connect_error", (err) => resolve(err as Error & { data?: { code?: string } }));
    });
    expect(error.data?.code).toBe("too_many_sockets");
  });
});

describe("/healthz", () => {
  it("reports 200 with uptime and the connected-socket count", async () => {
    await connect(1, "student");

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      uptimeMs: number;
      connectedSockets: number;
      store: string;
    };
    expect(body.status).toBe("ok");
    expect(body.connectedSockets).toBe(1);
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.store).toBe("memory");
  });

  it("404s anything else, because this service serves no application HTTP", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/admin`);
    expect(response.status).toBe(404);
  });
});

describe("shutdown", () => {
  it("closes cleanly, twice, without throwing", async () => {
    // The platform sends a second SIGTERM when it does not see us exit fast
    // enough; a double close must not turn a clean exit into a crash.
    await connect(1, "student");
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("flushes still-connected users' engagement before the sockets go away", async () => {
    const alice = await connect(1, "student");
    await emit(alice, "chat:send", { body: "mid-class" });

    await server.close();
    const flushed = store.flushedEngagement();
    expect(flushed.some((r) => r.userId === 1 && r.messagesSent === 1)).toBe(true);
  });
});
