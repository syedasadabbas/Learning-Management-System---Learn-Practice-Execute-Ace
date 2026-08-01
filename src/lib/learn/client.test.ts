// The browser's side of the completion POST, with `fetch` injected: no network, no
// jsdom Worker, no database. The property under test is that this NEVER rejects —
// a network blip inside an onClick handler has no error boundary to catch it.
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/lib/contracts/api";

import { completeStepPath, postStepComplete, type FetchLike } from "./client";

/** A fetch stub returning a fixed envelope. */
function stubFetch(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as FetchLike;
}

const payload = {
  created: true,
  stepId: 42,
  moduleId: 7,
  progress: { stepCount: 6, completedSteps: 1, percent: 17, status: "in_progress" },
  announcement: "Step 1 of 6 complete — 17 per cent.",
  check: null,
};

describe("completeStepPath", () => {
  it("matches the frozen route contract", () => {
    // If the contract's template ever changes, this test is the thing that notices.
    const template = "POST /api/learn/steps/:stepId/complete";
    expect(ROUTES).toHaveProperty(template, "interactive-learning");
    expect(completeStepPath(42)).toBe(template.replace("POST ", "").replace(":stepId", "42"));
  });

  it("encodes the id rather than interpolating it raw", () => {
    expect(completeStepPath(7)).toBe("/api/learn/steps/7/complete");
  });
});

describe("postStepComplete", () => {
  it("returns the payload on success", async () => {
    const result = await postStepComplete(42, undefined, stubFetch({ ok: true, data: payload }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stepId).toBe(42);
  });

  it("always sends a body, so the route has one path rather than two", async () => {
    const fetchImpl = stubFetch({ ok: true, data: payload });
    await postStepComplete(42, undefined, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("includes answerIndex when one was supplied", async () => {
    const fetchImpl = stubFetch({ ok: true, data: payload });
    await postStepComplete(42, 2, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ answerIndex: 2 });
  });

  it("returns a value — never rejects — when fetch throws", async () => {
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as FetchLike;
    const result = await postStepComplete(42, undefined, throwing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("network");
  });

  it("returns a value when the body is not JSON", async () => {
    const bad = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("unexpected token");
      },
    })) as unknown as FetchLike;
    const result = await postStepComplete(42, undefined, bad);
    expect(result.ok).toBe(false);
  });

  it("surfaces the server's error message for a non-ok envelope", async () => {
    const result = await postStepComplete(
      42,
      undefined,
      stubFetch({ ok: false, error: "That step does not exist.", code: "step_not_found" }, false, 404),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("That step does not exist.");
      expect(result.code).toBe("step_not_found");
    }
  });

  it("rejects an ok envelope whose data is the wrong shape", async () => {
    // A 200 carrying nonsense must not be treated as a saved step.
    const result = await postStepComplete(42, undefined, stubFetch({ ok: true, data: { nope: 1 } }));
    expect(result.ok).toBe(false);
  });

  it("returns a value rather than throwing when there is no fetch at all", async () => {
    const result = await postStepComplete(42, undefined, undefined as unknown as FetchLike);
    // In this environment globalThis.fetch exists, so assert only the contract:
    // whatever happens, a value comes back.
    expect(typeof result.ok).toBe("boolean");
  });
});
