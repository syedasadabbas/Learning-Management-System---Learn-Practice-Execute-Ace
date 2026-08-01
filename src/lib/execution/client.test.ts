// =============================================================================
// Client-side server-run tests. `fetch` is injected — no network, no route.
// These cover the API-layer failures the runner itself never sees: an expired
// session, a 429 from our own limiter, and a proxy returning HTML.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import { EXECUTE_ENDPOINT, runOnServer } from "./client";
import { MAX_RUN_TIMEOUT_MS } from "./timeouts";
import { shouldDeferToInstructor } from "./types";

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

const REQUEST = { language: "javascript", source: "console.log(1)" };

const OK_RESULT = {
  ok: true as const,
  stdout: "1\n",
  stderr: "",
  exitCode: 0,
  runtimeMs: 42,
  backend: "piston" as const,
  truncated: { stdout: false, stderr: false },
  language: "javascript" as const,
};

describe("runOnServer", () => {
  it("returns the server's RunResult verbatim, already truncated", async () => {
    const result = await runOnServer(REQUEST, {
      fetchImpl: respond({ ok: true, data: OK_RESULT }),
    });
    expect(result).toEqual(OK_RESULT);
  });

  it("posts to the route this stream owns, with a clamped timeout", async () => {
    const spy = respond({ ok: true, data: OK_RESULT });
    await runOnServer({ ...REQUEST, timeoutMs: 10 ** 6 }, { fetchImpl: spy });
    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(EXECUTE_ENDPOINT);
    expect(JSON.parse(String(init.body)).timeoutMs).toBe(MAX_RUN_TIMEOUT_MS);
  });

  it("maps 429 to rate_limited so a grader defers instead of scoring zero", async () => {
    const result = await runOnServer(REQUEST, {
      fetchImpl: respond({ ok: false, error: "Too many runs", code: "rate_limited" }, 429),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
    expect(shouldDeferToInstructor(result)).toBe(true);
  });

  it("maps an expired session (401/403) to backend_unavailable, never to a wrong answer", async () => {
    for (const status of [401, 403]) {
      const result = await runOnServer(REQUEST, {
        fetchImpl: respond({ ok: false, error: "Not signed in." }, status),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("backend_unavailable");
      expect(shouldDeferToInstructor(result)).toBe(true);
    }
  });

  it("maps the route's unsupported_language code onto the same reason", async () => {
    const result = await runOnServer({ language: "bash", source: "ls" }, {
      fetchImpl: respond({ ok: false, error: "not runnable", code: "unsupported_language" }, 400),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_language");
    expect(shouldDeferToInstructor(result)).toBe(false);
  });

  it("maps any other 4xx to backend_unavailable — a malformed request is our bug", async () => {
    const result = await runOnServer(REQUEST, {
      fetchImpl: respond({ ok: false, error: "Invalid request.", code: "invalid_body" }, 400),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
  });

  it("maps a network failure to a value, not a rejection", async () => {
    const result = await runOnServer(REQUEST, {
      fetchImpl: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
    expect(result.message).toContain("Failed to fetch");
  });

  it("survives an HTML error page from a proxy", async () => {
    const result = await runOnServer(REQUEST, {
      fetchImpl: vi.fn(async () => new Response("<html>502</html>", { status: 200 })) as
        unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
  });

  it("survives a 200 whose body is not the frozen envelope", async () => {
    const result = await runOnServer(REQUEST, { fetchImpl: respond({ surprise: true }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
  });
});
