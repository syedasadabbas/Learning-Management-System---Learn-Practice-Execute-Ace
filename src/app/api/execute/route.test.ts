// =============================================================================
// Route-handler tests for POST /api/execute. Owner: code-execution stream.
// -----------------------------------------------------------------------------
// These exist because the route is NOT in the frozen ROUTE_AUTH map (see the
// route file), so nothing else in the repo asserts its authorization level. The
// REAL `apiGuard`/`getSessionUser` run here — only `auth()` is faked — because
// mocking the guard would test the mock, and "is this endpoint anonymous?" is the
// single most consequential question about it: an open one is a free, keyless
// remote-code-execution proxy.
//
// Piston is mocked so no test touches the network; its own mapping is covered in
// src/lib/execution/piston.test.ts.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: `vi.mock` factories are lifted above the imports, so a plain
// `const auth = vi.fn()` above them is still uninitialised when they run.
const { auth, runOnPiston } = vi.hoisted(() => ({
  auth: vi.fn(),
  runOnPiston: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/execution/piston", () => ({ runOnPiston }));

import { POST } from "./route";
import { resetRunAllowance } from "@/lib/execution/rate-limit";

const OK_RUN = {
  ok: true,
  stdout: "42\n",
  stderr: "",
  exitCode: 0,
  runtimeMs: 31,
  backend: "piston",
  truncated: { stdout: false, stderr: false },
  language: "python",
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function signedIn(role: "student" | "instructor" | "admin", id = 42) {
  auth.mockResolvedValue({ user: { id: String(id), email: "s@x.test", name: "S", role } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRunAllowance();
  runOnPiston.mockResolvedValue(OK_RUN);
});

describe("POST /api/execute — authorization", () => {
  it("401s an anonymous caller and never reaches the runner", async () => {
    auth.mockResolvedValue(null);
    const response = await POST(post({ language: "python", source: "print(1)" }));
    expect(response.status).toBe(401);
    expect(runOnPiston).not.toHaveBeenCalled();
  });

  it("accepts a signed-in student", async () => {
    signedIn("student");
    const response = await POST(post({ language: "python", source: "print(6*7)" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: OK_RUN });
  });

  it("accepts staff too — ROLES_SATISFYING.student includes instructor and admin", async () => {
    for (const role of ["instructor", "admin"] as const) {
      resetRunAllowance();
      signedIn(role);
      const response = await POST(post({ language: "python", source: "print(1)" }));
      expect(response.status).toBe(200);
    }
  });
});

describe("POST /api/execute — validation", () => {
  beforeEach(() => signedIn("student"));

  it("400s a non-JSON body", async () => {
    const response = await POST(post("{ not json"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_json");
  });

  it("400s an unlisted language with code unsupported_language, without spending a run", async () => {
    const response = await POST(post({ language: "bash", source: "rm -rf /" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("unsupported_language");
    expect(runOnPiston).not.toHaveBeenCalled();
  });

  it("400s a timeout the platform cannot honour", async () => {
    const response = await POST(post({ language: "python", source: "print(1)", timeoutMs: 60_000 }));
    expect(response.status).toBe(400);
  });

  it("400s a program past the source cap rather than running a fragment", async () => {
    const response = await POST(post({ language: "python", source: "#".repeat(200_000) }));
    expect(response.status).toBe(400);
    expect(runOnPiston).not.toHaveBeenCalled();
  });
});

describe("POST /api/execute — rate limiting", () => {
  beforeEach(() => signedIn("student", 7));

  it("charges the limiter once per request, not twice", async () => {
    // The route charges the allowance itself, so the runner must be told to skip
    // its own charge — otherwise every student's effective budget is halved.
    await POST(post({ language: "python", source: "print(1)" }));
    const options = runOnPiston.mock.calls[0][1];
    expect(options.skipRateLimit).toBe(true);
    expect(options.userKey).toBe("user:7");
  });

  it("keys the limiter on the SESSION id, never on anything in the body", async () => {
    await POST(post({ language: "python", source: "print(1)", userKey: "user:1" }));
    expect(runOnPiston.mock.calls[0][1].userKey).toBe("user:7");
  });

  it("429s with a Retry-After header once the burst budget is spent", async () => {
    let limited: Response | null = null;
    for (let i = 0; i < 12; i++) {
      const response = await POST(post({ language: "python", source: "print(1)" }));
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited).not.toBeNull();
    if (!limited) return;
    // Seconds in the header (that is the unit HTTP defines), ms in the app.
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await limited.json()).code).toBe("rate_limited");
  });
});

describe("POST /api/execute — result mapping", () => {
  beforeEach(() => signedIn("student", 9));

  it("returns 200 for a failed run: a timeout is an answer, not a server outage", async () => {
    runOnPiston.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "did not finish",
      stdout: "x\n",
      stderr: "",
      exitCode: null,
      runtimeMs: 5_000,
      backend: "piston",
      truncated: { stdout: false, stderr: false },
      language: "python",
    });
    const response = await POST(post({ language: "python", source: "while True: pass" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reason).toBe("timeout");
  });

  it("returns 200 for backend_unavailable, so a grader can defer rather than see a 5xx", async () => {
    runOnPiston.mockResolvedValue({
      ok: false,
      reason: "backend_unavailable",
      message: "unreachable",
      stdout: "",
      stderr: "",
      exitCode: null,
      runtimeMs: 12,
      backend: "piston",
      truncated: { stdout: false, stderr: false },
      language: "python",
    });
    const response = await POST(post({ language: "python", source: "print(1)" }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.reason).toBe("backend_unavailable");
  });

  it("surfaces Piston's own 429 as HTTP 429 while keeping the full RunResult", async () => {
    runOnPiston.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      message: "busy",
      stdout: "",
      stderr: "",
      exitCode: null,
      runtimeMs: 9,
      backend: "piston",
      truncated: { stdout: false, stderr: false },
      language: "python",
    });
    const response = await POST(post({ language: "python", source: "print(1)" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    const body = await response.json();
    // The body still carries the reason, which is what lets grand-quiz defer the
    // item instead of scoring it zero.
    expect(body.ok).toBe(true);
    expect(body.data.reason).toBe("rate_limited");
  });
});
