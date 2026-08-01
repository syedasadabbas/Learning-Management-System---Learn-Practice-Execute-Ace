// =============================================================================
// E2E — POST /api/execute. Owner: code-execution stream.
// -----------------------------------------------------------------------------
// WHAT THIS SPEC IS FOR: the authorization boundary and the envelope. The unit
// tests (src/lib/execution/*.test.ts) already cover every failure mapping with
// `fetch` injected, so nothing here re-tests the mapping — it tests the things
// only a real server can show: that the route is reachable, guarded, and that a
// failed run is still a well-formed ApiResult rather than a 500.
//
// NETWORK-TOLERANT ON PURPOSE. The free public Piston instance is a third party
// this suite does not control: it may be down, or rate-limiting, when CI runs.
// Asserting "stdout === 2" would make an unrelated outage look like our bug. The
// assertion is therefore the property that actually matters — the response is a
// RunResult, and any failure carries one of the four discriminated reasons — with
// the exact-output check applied only when the backend really ran the program.
//
// `page.request` (not the bare `request` fixture) so the session cookie set by
// loginAs is sent; the route is signed-in-only and would otherwise 401.
// =============================================================================

import { expect, test, type APIResponse } from "@playwright/test";

import { loginAs } from "../fixtures";

const FAILURE_REASONS = ["timeout", "unsupported_language", "backend_unavailable", "rate_limited"];

/** Assert the body is the frozen ApiResult envelope and return it. */
async function envelope(response: APIResponse): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  expect(typeof body.ok).toBe("boolean");
  return body;
}

test.describe("POST /api/execute", () => {
  test("refuses an anonymous caller — it is not an open code-execution proxy", async ({
    request,
  }) => {
    const response = await request.post("/api/execute", {
      data: { language: "python", source: "print(1)" },
    });
    // 401 from the in-handler apiGuard("student"). Left public this endpoint
    // would be a free, keyless remote-code-execution proxy on the internet.
    expect(response.status()).toBe(401);
    const body = await envelope(response);
    expect(body.ok).toBe(false);
  });

  test("rejects an unlisted language with 400 unsupported_language, not a run", async ({
    page,
  }) => {
    await loginAs(page, "student");
    const response = await page.request.post("/api/execute", {
      data: { language: "bash", source: "echo hi" },
    });
    expect(response.status()).toBe(400);
    const body = await envelope(response);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("unsupported_language");
  });

  test("rejects a malformed body with 400 rather than throwing", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.post("/api/execute", {
      headers: { "content-type": "application/json" },
      data: "{ not json",
    });
    expect(response.status()).toBe(400);
    const body = await envelope(response);
    expect(body.ok).toBe(false);
  });

  test("rejects a timeout outside the honourable range", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.post("/api/execute", {
      // 60 s cannot be honoured: the platform's own function budget is 10 s.
      data: { language: "python", source: "print(1)", timeoutMs: 60_000 },
    });
    expect(response.status()).toBe(400);
  });

  test("runs a program and answers with a RunResult in the frozen envelope", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.post("/api/execute", {
      data: { language: "python", source: "print(6 * 7)", timeoutMs: 5_000 },
    });

    // 200 for a run that happened (whatever the program did); 429 when the shared
    // instance is rate-limiting. Never a 5xx — a failed run is a value.
    expect([200, 429]).toContain(response.status());
    const body = await envelope(response);
    expect(body.ok).toBe(true);

    const result = body.data as Record<string, unknown>;
    expect(typeof result.runtimeMs).toBe("number");
    expect(typeof result.stdout).toBe("string");
    expect(result.backend).toBe("piston");

    if (result.ok === true) {
      expect(result.exitCode).toBe(0);
      expect(String(result.stdout)).toContain("42");
      expect(result.language).toBe("python");
    } else {
      // The third party was unavailable or busy. That must be a discriminated
      // reason a grader can defer on — never an unmarked crash.
      expect(FAILURE_REASONS).toContain(result.reason);
      expect(typeof result.message).toBe("string");
    }
  });

  // LAST, deliberately: it spends the process-wide burst budget, so anything
  // running after it in the same server process would see spurious 429s.
  test("rate-limits a student hammering Run, with a Retry-After header", async ({ page }) => {
    await loginAs(page, "student");

    // The per-user burst rule is 6 runs per 10 000 ms and the cohort rule is
    // 3 per 1 000 ms, so a tight sequence of 10 must be refused at some point.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const response = await page.request.post("/api/execute", {
        // Deliberately tiny: this test is about the limiter, not about Piston.
        data: { language: "javascript", source: "0", timeoutMs: 500 },
      });
      statuses.push(response.status());
      if (response.status() === 429) {
        expect(response.headers()["retry-after"]).toBeTruthy();
        const body = await envelope(response);
        // Two shapes are legitimate here: our own limiter refuses with
        // { ok: false, code: "rate_limited" }, while Piston's own 429 comes back
        // as a full RunResult with reason "rate_limited". Both must be
        // recognisable as "not scored" rather than "wrong".
        if (body.ok === false) {
          expect(body.code).toBe("rate_limited");
        } else {
          expect((body.data as Record<string, unknown>).reason).toBe("rate_limited");
        }
        break;
      }
    }
    expect(statuses).toContain(429);
  });
});
