// =============================================================================
// Piston backend tests. `fetch` is injected in every case — NO NETWORK. The unit
// under test is the mapping from an HTTP outcome to a `RunResult`, and the
// property that no input reaches a `throw`.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runOnPiston, DEFAULT_PISTON_URL, pistonBaseUrl } from "./piston";
import { resetRunAllowance } from "./rate-limit";
import { MAX_RUN_TIMEOUT_MS, MIN_RUN_TIMEOUT_MS } from "./timeouts";
import { MAX_STREAM_CHARS } from "./truncate";
import { shouldDeferToInstructor } from "./types";

const T0 = 1_800_000_000_000;
const now = () => T0;

/** A fetch stand-in that answers with one JSON body and status. */
function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

const HELLO = { language: "python", source: "print('hi')" };

beforeEach(resetRunAllowance);

describe("runOnPiston — success mapping", () => {
  it("returns stdout, the exit code and a runtime in ms", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: jsonFetch({ run: { stdout: "hi\n", stderr: "", code: 0, signal: null } }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toBe("hi\n");
    expect(result.exitCode).toBe(0);
    expect(result.language).toBe("python");
    expect(result.backend).toBe("piston");
    expect(result.runtimeMs).toBeGreaterThanOrEqual(0);
  });

  it("treats a non-zero exit as a RESULT, not a failure — it is gradeable", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: jsonFetch({
        run: { stdout: "", stderr: "Traceback…\nNameError", code: 1, signal: null },
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("NameError");
    // A wrong answer is scored, never deferred.
    expect(shouldDeferToInstructor(result)).toBe(false);
  });

  it("reports a compile failure with the compiler's own stderr", async () => {
    const result = await runOnPiston(
      { language: "c++", source: "int main(){" },
      {
        fetchImpl: jsonFetch({
          compile: { stdout: "", stderr: "error: expected '}'", code: 1 },
          run: { stdout: "", stderr: "", code: 0, signal: null },
        }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected '}'");
  });

  it("sends the allow-listed runtime name and filename, never the caller's string", async () => {
    const spy = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    await runOnPiston({ language: "C++", source: "int main(){}" }, { fetchImpl: spy });
    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.language).toBe("c++");
    expect(body.files[0].name).toBe("main.cpp");
    expect(body.version).toBe("*");
  });

  it("clamps the run budget it asks Piston for", async () => {
    const spy = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    await runOnPiston({ ...HELLO, timeoutMs: 10 ** 9 }, { fetchImpl: spy });
    const first = JSON.parse(
      String((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
    );
    expect(first.run_timeout).toBe(MAX_RUN_TIMEOUT_MS);

    const spy2 = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    await runOnPiston({ ...HELLO, timeoutMs: 1 }, { fetchImpl: spy2 });
    const second = JSON.parse(
      String((spy2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
    );
    expect(second.run_timeout).toBe(MIN_RUN_TIMEOUT_MS);
  });
});

describe("runOnPiston — failure branches", () => {
  it("maps an unlisted language to unsupported_language WITHOUT calling fetch", async () => {
    const spy = jsonFetch({});
    const result = await runOnPiston({ language: "bash", source: "rm -rf /" }, {
      fetchImpl: spy,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_language");
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    // Not an infrastructure problem: a bad language is a content bug and scores
    // normally rather than going to an instructor.
    expect(shouldDeferToInstructor(result)).toBe(false);
  });

  it("maps HTTP 429 to rate_limited, and that DEFERS rather than scoring zero", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: jsonFetch({ message: "Requests limited to 5 per second" }, 429),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
    // The property the grand-quiz stream depends on: a busy shared instance must
    // never be indistinguishable from a wrong answer.
    expect(shouldDeferToInstructor(result)).toBe(true);
  });

  it("maps 5xx to backend_unavailable, which also defers", async () => {
    const result = await runOnPiston(HELLO, { fetchImpl: jsonFetch({}, 503) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
    expect(result.message).toContain("503");
    expect(shouldDeferToInstructor(result)).toBe(true);
  });

  it("maps a 400 from Piston to backend_unavailable, not to a student error", async () => {
    // A 400 means our request was wrong (unknown runtime, malformed body). The
    // student's code is not implicated, so it must not be scored zero.
    const result = await runOnPiston(HELLO, { fetchImpl: jsonFetch({ message: "bad" }, 400) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
  });

  it("maps an aborted fetch to timeout", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const result = await runOnPiston(HELLO, {
      fetchImpl: vi.fn(async () => {
        throw timeoutError;
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
    // A student's own infinite loop is their result; it is not deferred.
    expect(shouldDeferToInstructor(result)).toBe(false);
  });

  it("maps a DNS/TLS failure to backend_unavailable", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
  });

  it("maps a SIGKILLed program with a null exit code to timeout, keeping partial output", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: jsonFetch({
        run: { stdout: "x\nx\n", stderr: "", code: null, signal: "SIGKILL" },
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
    // The output before the kill is exactly what the student needs to see.
    expect(result.stdout).toBe("x\nx\n");
  });

  it("maps a 200 with no run stage to backend_unavailable and surfaces the message", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: jsonFetch({ message: "runtime is not installed" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
    expect(result.message).toContain("runtime is not installed");
  });

  it("maps an unreadable body to backend_unavailable instead of throwing", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })) as
        unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
  });

  it("refuses an oversized program rather than running a fragment of it", async () => {
    const spy = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    const result = await runOnPiston(
      { language: "python", source: "#".repeat(200_000) },
      { fetchImpl: spy },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_language");
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe("runOnPiston — truncation and rate limiting", () => {
  it("truncates a flood before returning it", async () => {
    const result = await runOnPiston(HELLO, {
      fetchImpl: jsonFetch({
        run: { stdout: "x".repeat(2_000_000), stderr: "", code: 0, signal: null },
      }),
    });
    expect(result.stdout.length).toBeLessThan(MAX_STREAM_CHARS + 500);
    expect(result.truncated.stdout).toBe(true);
  });

  it("applies the per-user limiter when a userKey is supplied", async () => {
    const fetchImpl = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    const reasons: string[] = [];
    for (let i = 0; i < 12; i++) {
      const result = await runOnPiston(HELLO, { fetchImpl, userKey: "user:7", now });
      if (!result.ok) reasons.push(result.reason);
    }
    expect(reasons).toContain("rate_limited");
  });

  it("does not limit an internal caller that supplies no userKey", async () => {
    // grand-quiz grading its own batch is already serialised; charging it to a
    // shared bucket would let one exam starve another.
    const fetchImpl = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    for (let i = 0; i < 20; i++) {
      const result = await runOnPiston(HELLO, { fetchImpl, now });
      expect(result.ok).toBe(true);
    }
  });

  it("honours skipRateLimit, so the route's charge is not double-counted", async () => {
    const fetchImpl = jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } });
    for (let i = 0; i < 20; i++) {
      const result = await runOnPiston(HELLO, {
        fetchImpl,
        userKey: "user:8",
        skipRateLimit: true,
        now,
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe("runOnPiston — never throws", () => {
  it("returns a value for every hostile input shape", async () => {
    const hostile = [
      { language: "python", source: "" },
      { language: "", source: "print(1)" },
      { language: "python", source: "print(1)", timeoutMs: Number.NaN },
      { language: "python", source: "print(1)", timeoutMs: -5 },
      { language: undefined as unknown as string, source: undefined as unknown as string },
    ];
    for (const request of hostile) {
      const result = await runOnPiston(request, {
        fetchImpl: jsonFetch({ run: { stdout: "", stderr: "", code: 0, signal: null } }),
      });
      // The only assertion that matters here: we got a RunResult, not a rejection.
      expect(typeof result.ok).toBe("boolean");
      expect(typeof result.runtimeMs).toBe("number");
    }
  });
});

describe("pistonBaseUrl", () => {
  it("defaults to the free public instance and strips a trailing slash", () => {
    // http allowed in the pattern because a developer may point PISTON_URL at a
    // local self-hosted instance; the default constant is https.
    expect(pistonBaseUrl()).toMatch(/^https?:\/\//);
    expect(DEFAULT_PISTON_URL).toMatch(/^https:\/\//);
    expect(pistonBaseUrl("http://localhost:2000/api/v2/piston/")).toBe(
      "http://localhost:2000/api/v2/piston",
    );
    expect(DEFAULT_PISTON_URL.endsWith("/")).toBe(false);
  });
});
