// =============================================================================
// Route-handler tests for POST /api/classes/:classId/realtime-token.
// Owner: the real-time stream.
// -----------------------------------------------------------------------------
// WHY THIS ROUTE GETS ITS OWN TEST FILE when most in this repo do not. What it
// returns is a CAPABILITY: a signed claim that admits the bearer to a live class
// room, which the socket service accepts without ever asking this app anything
// again. Every other live-classes route can be got wrong and produce a bad
// response; this one can be got wrong and produce a room key. The three
// questions worth mechanising are therefore "who is refused", "what role is
// claimed", and "is the token actually verifiable" — the last one against the
// REAL verifier, not a stub, because a mint/verify pair that agree only in a
// mock is precisely the bug that shows up as an unexplained handshake failure in
// production.
//
// The REAL apiGuard and the REAL featureGate run here, as in
// src/app/api/execute/route.test.ts, for the reason that file gives: mocking the
// guard tests the mock. Only `auth()`, the database and the feature FLAGS are
// faked, all three being things a unit test cannot otherwise vary.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, dbSelect, flags } = vi.hoisted(() => ({
  auth: vi.fn(),
  dbSelect: vi.fn(),
  // Mutable, because `features` is frozen at module load from process.env and a
  // test cannot re-import the module per case.
  flags: { liveClasses: true, presentations: true, learningEnhancements: true },
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/db", () => ({ db: { select: dbSelect } }));
vi.mock("@/lib/features", () => ({
  features: flags,
  publicFeatures: flags,
  liveClassesConfig: { jitsiDomain: "meet.jit.si", realtimeUrl: undefined },
  isRealtimeAvailable: () => false,
}));

import { verifyRealtimeToken } from "@/lib/live-classes/realtime-token";

import { resetMintAllowance } from "@/lib/live-classes/mint-limiter";

import { POST } from "./route";

const SECRET = "test-shared-secret-value";

/** The last `where` predicate handed to the query builder. */
let capturedWhere: unknown = null;

/**
 * Stand in for `db.select(...).from(...).where(...).limit(1)`.
 *
 * Deliberately records the predicate rather than only the result: "the class was
 * filtered by status IN (...) inside the statement" is the property that makes
 * this authorization rather than a post-fetch `if`, and a mock that only returns
 * rows cannot tell the two apart.
 */
function stubClassRow(rows: Array<{ id: number; owns: boolean }>): void {
  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: (predicate: unknown) => {
        capturedWhere = predicate;
        return { limit: () => Promise.resolve(rows) };
      },
    }),
  }));
}

/**
 * Every string reachable inside a Drizzle predicate.
 *
 * `JSON.stringify` cannot be used: a Drizzle `SQL` object holds column
 * references back to their table, and the table holds the columns — a cycle
 * that throws before any assertion runs. A guarded walk with a `seen` set is
 * what reads the bound parameter values out of it.
 */
function stringLiteralsIn(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  // A pgEnum COLUMN reference carries every member of the enum in
  // `enumValues`, including the two this query excludes. Walking into it would
  // make the negative assertions below pass or fail for a reason that has
  // nothing to do with the predicate, so column definitions are not descended
  // into — only the bound values are.
  if ("enumValues" in (value as Record<string, unknown>)) return [];
  return Object.values(value as Record<string, unknown>).flatMap((child) =>
    stringLiteralsIn(child, seen),
  );
}

function signedIn(role: "student" | "instructor" | "admin", id = 42): void {
  auth.mockResolvedValue({ user: { id: String(id), email: "u@x.test", name: "U", role } });
}

function ctx(classId: string | number) {
  return { params: Promise.resolve({ classId: String(classId) }) };
}

const request = new Request("http://localhost/api/classes/7/realtime-token", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  resetMintAllowance();
  capturedWhere = null;
  flags.liveClasses = true;
  process.env.REALTIME_SHARED_SECRET = SECRET;
  stubClassRow([{ id: 7, owns: false }]);
  signedIn("student");
});

describe("POST /api/classes/:classId/realtime-token — who is refused", () => {
  it("404s with the flag off, and never reaches the session or the database", async () => {
    flags.liveClasses = false;
    const response = await POST(request, ctx(7));
    expect(response.status).toBe(404);
    // The ordering assertion, not decoration: auth running first would answer
    // 401 to an anonymous prober and thereby confirm the route exists.
    expect(auth).not.toHaveBeenCalled();
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("401s an anonymous caller and mints nothing", async () => {
    auth.mockResolvedValue(null);
    const response = await POST(request, ctx(7));
    expect(response.status).toBe(401);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("404s — not 403 — for a class that does not exist or cannot be entered", async () => {
    stubClassRow([]);
    const response = await POST(request, ctx(999));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    // Nothing in the answer distinguishes "no such class" from "that class has
    // ended", which is the whole point of using 404 for both.
    expect(JSON.stringify(body)).not.toMatch(/ended|cancelled|permission|forbidden/i);
  });

  it("filters on joinable status INSIDE the statement, not after the fetch", async () => {
    await POST(request, ctx(7));
    const literals = stringLiteralsIn(capturedWhere);
    expect(literals).toContain("scheduled");
    expect(literals).toContain("active");
    // An ended or cancelled class is excluded by the query, so the handler never
    // holds one and cannot forget to check it.
    expect(literals).not.toContain("ended");
    expect(literals).not.toContain("cancelled");
  });

  it("400s a non-numeric classId before querying anything", async () => {
    const response = await POST(request, ctx("not-a-number"));
    expect(response.status).toBe(400);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("503s when no shared secret is configured, and never mints an unsigned token", async () => {
    delete process.env.REALTIME_SHARED_SECRET;
    const response = await POST(request, ctx(7));
    expect(response.status).toBe(503);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("429s a caller that mints faster than any real client reconnects", async () => {
    // The burst window is 10 per 30 s; a genuine client's ceiling is six.
    for (let i = 0; i < 10; i += 1) {
      expect((await POST(request, ctx(7))).status).toBe(200);
    }
    const refused = await POST(request, ctx(7));
    expect(refused.status).toBe(429);
  });

  it("meters per user, so one student's storm does not lock out the class", async () => {
    for (let i = 0; i < 10; i += 1) await POST(request, ctx(7));
    signedIn("student", 43);
    expect((await POST(request, ctx(7))).status).toBe(200);
  });
});

describe("POST /api/classes/:classId/realtime-token — the claim that is minted", () => {
  it("mints a token the REAL verifier accepts, carrying this user and this class", async () => {
    signedIn("student", 42);
    const response = await POST(request, ctx(7));
    expect(response.status).toBe(200);

    const { data } = await response.json();
    const verified = verifyRealtimeToken(data.token, SECRET);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims).toMatchObject({ userId: 42, classId: 7, role: "student" });
  });

  it("reports an absolute expiry roughly 120 s out, so a client refreshes before it lapses", async () => {
    const before = Date.now();
    const { data } = await (await POST(request, ctx(7))).json();
    expect(data.expiresInMs).toBe(120_000);
    expect(data.expiresAtMs).toBeGreaterThanOrEqual(before + 120_000);
    expect(data.expiresAtMs).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it("does not honour a token minted for a DIFFERENT class", async () => {
    const { data } = await (await POST(request, ctx(7))).json();
    const verified = verifyRealtimeToken(data.token, SECRET);
    expect(verified.ok && verified.claims.classId).toBe(7);
    // The service pins a socket to `claims.classId`, so a token for class 7
    // simply is not a token for class 8. Asserted rather than assumed because it
    // is the property that keeps one room key from opening every room.
    expect(verified.ok && verified.claims.classId === 8).toBe(false);
  });

  it("claims `instructor` only in a class this instructor owns", async () => {
    signedIn("instructor", 9);
    stubClassRow([{ id: 7, owns: true }]);
    const owned = await (await POST(request, ctx(7))).json();
    expect(owned.data.role).toBe("instructor");

    resetMintAllowance();
    stubClassRow([{ id: 7, owns: false }]);
    const visiting = await (await POST(request, ctx(7))).json();
    // A colleague's class. Moderation on the socket service is granted by this
    // claim alone, so an unowned class must not produce it.
    expect(visiting.data.role).toBe("student");
  });

  it("claims `admin` regardless of ownership — the documented cover-for-a-colleague rule", async () => {
    signedIn("admin", 1);
    stubClassRow([{ id: 7, owns: false }]);
    const { data } = await (await POST(request, ctx(7))).json();
    expect(data.role).toBe("admin");
  });

  it("mints a DIFFERENT token each time, so one is never a cacheable identifier", async () => {
    const first = await (await POST(request, ctx(7))).json();
    const second = await (await POST(request, ctx(7))).json();
    expect(first.data.token).not.toBe(second.data.token);
  });
});
