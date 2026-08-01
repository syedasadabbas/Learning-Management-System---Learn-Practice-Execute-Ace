// =============================================================================
// Tests for the retention POLICY arithmetic — the part of pruning where a mistake
// is unrecoverable, and the part that needs no database.
//
// `pruneActivity` itself issues DELETEs and is therefore exercised by the e2e specs
// under tests/e2e/activity/ (dry-run only) rather than here; vitest in this repo
// runs without a database by design (see vitest.config.ts). What IS tested here is
// every path by which a bad configuration could reach a DELETE.
// =============================================================================

import { describe, it, expect } from "vitest";

import {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  PRUNE_BATCH_ROWS,
  PRUNE_BUDGET_MS,
  RECOMMENDED_RETENTION_DAYS,
  retentionCutoff,
  retentionDays,
} from "./retention";

describe("retentionDays follows the spec by default", () => {
  it("is 90 days when unset, which is the number INTEGRATION_SUMMARY.md states", () => {
    expect(retentionDays({})).toBe(90);
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
  });

  it("is 90 days for an empty or whitespace value", () => {
    expect(retentionDays({ ACTIVITY_RETENTION_DAYS: "" })).toBe(90);
    expect(retentionDays({ ACTIVITY_RETENTION_DAYS: "   " })).toBe(90);
  });

  it("honours a valid override", () => {
    expect(retentionDays({ ACTIVITY_RETENTION_DAYS: "400" })).toBe(400);
    expect(retentionDays({ ACTIVITY_RETENTION_DAYS: String(RECOMMENDED_RETENTION_DAYS) })).toBe(
      RECOMMENDED_RETENTION_DAYS,
    );
  });
});

describe("a misconfiguration can never shorten retention below the floor", () => {
  // This is the assertion that matters. There is no undo for a prune, so a typo in
  // an environment variable must not be able to erase the trail.
  it.each(["1", "7", "29", String(MIN_RETENTION_DAYS - 1)])("clamps %s up to the floor", (raw) => {
    expect(retentionDays({ ACTIVITY_RETENTION_DAYS: raw })).toBe(MIN_RETENTION_DAYS);
  });

  it.each(["0", "-1", "-9999", "abc", "90 days", "1e3", "9.5", "NaN", "Infinity"])(
    "falls back to the DEFAULT for the malformed value %s, never to a smaller window",
    (raw) => {
      const days = retentionDays({ ACTIVITY_RETENTION_DAYS: raw });
      expect(days).toBeGreaterThanOrEqual(MIN_RETENTION_DAYS);
      // Failing towards KEEPING data is the only safe direction.
      expect(days).toBe(DEFAULT_RETENTION_DAYS);
    },
  );

  it("the floor is at least 30 days, so a month of history always survives", () => {
    expect(MIN_RETENTION_DAYS).toBeGreaterThanOrEqual(30);
  });
});

describe("retentionCutoff", () => {
  it("is exactly N days before the reference instant", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    expect(retentionCutoff(90, now).toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  it("uses whole days of 86_400_000 ms, in metric units", () => {
    const now = new Date("2026-07-31T12:34:56Z");
    const cutoff = retentionCutoff(1, now);
    expect(now.getTime() - cutoff.getTime()).toBe(86_400_000);
  });

  it("is always in the past for any positive window", () => {
    for (const days of [30, 90, 400, 3_650]) {
      expect(retentionCutoff(days).getTime()).toBeLessThan(Date.now());
    }
  });
});

describe("the prune is bounded so a serverless invocation cannot be killed mid-work", () => {
  it("deletes in batches rather than one statement", () => {
    expect(PRUNE_BATCH_ROWS).toBeGreaterThan(0);
    expect(PRUNE_BATCH_ROWS).toBeLessThanOrEqual(10_000);
  });

  it("stops itself well inside a function time limit", () => {
    // Ending by CHOOSING to stop, with a reported partial result, beats being
    // killed and rolling the work back forever.
    expect(PRUNE_BUDGET_MS).toBeLessThanOrEqual(30_000);
  });
});
