// =============================================================================
// UNIT TESTS — the grading-availability probe. Owner: coding-problems stream.
// `fetch` is injected in every case; no test touches the network.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isServerGradingAvailable,
  PROBE_FAILURE_TTL_MS,
  PROBE_TTL_MS,
  resetGradingAvailability,
} from "./availability";

function ok(status = 200): typeof fetch {
  return vi.fn(async () => new Response("[]", { status })) as unknown as typeof fetch;
}
function boom(): typeof fetch {
  return vi.fn(async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetGradingAvailability();
});

describe("isServerGradingAvailable", () => {
  it("reports available on a 200", async () => {
    expect(await isServerGradingAvailable({ fetchImpl: ok(), now: () => 0 })).toBe(true);
  });

  it("treats 429 as AVAILABLE — the instance is up, just busy", async () => {
    // Degrading to reference-solution-only because of a rate limit would hand out
    // answer keys during a busy minute.
    expect(await isServerGradingAvailable({ fetchImpl: ok(429), now: () => 0 })).toBe(true);
  });

  it("reports unavailable on a 5xx", async () => {
    expect(await isServerGradingAvailable({ fetchImpl: ok(503), now: () => 0 })).toBe(false);
  });

  it("reports unavailable — never throws — when the network is down", async () => {
    expect(await isServerGradingAvailable({ fetchImpl: boom(), now: () => 0 })).toBe(false);
  });

  it("reports unavailable when the runtime has no fetch", async () => {
    expect(
      await isServerGradingAvailable({ fetchImpl: undefined as unknown as typeof fetch, now: () => 0 }),
    ).toBe(false);
  });

  it("caches a positive result for the full TTL", async () => {
    const spy = ok();
    await isServerGradingAvailable({ fetchImpl: spy, now: () => 0 });
    await isServerGradingAvailable({ fetchImpl: spy, now: () => PROBE_TTL_MS - 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-probes once the positive TTL expires", async () => {
    const spy = ok();
    await isServerGradingAvailable({ fetchImpl: spy, now: () => 0 });
    await isServerGradingAvailable({ fetchImpl: spy, now: () => PROBE_TTL_MS });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("caches a negative result for a SHORTER time, so recovery is noticed", async () => {
    expect(PROBE_FAILURE_TTL_MS).toBeLessThan(PROBE_TTL_MS);
    const down = boom();
    await isServerGradingAvailable({ fetchImpl: down, now: () => 0 });
    await isServerGradingAvailable({ fetchImpl: down, now: () => PROBE_FAILURE_TTL_MS - 1 });
    expect(down).toHaveBeenCalledTimes(1);

    const up = ok();
    expect(
      await isServerGradingAvailable({ fetchImpl: up, now: () => PROBE_FAILURE_TTL_MS }),
    ).toBe(true);
  });

  it("probes the /runtimes endpoint of the configured instance", async () => {
    const spy = ok();
    await isServerGradingAvailable({
      fetchImpl: spy,
      now: () => 0,
      baseUrl: "https://piston.internal/api/v2/piston/",
    });
    expect(spy).toHaveBeenCalledWith(
      "https://piston.internal/api/v2/piston/runtimes",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
