// =============================================================================
// The limiter exists so one student cannot exhaust the shared free Piston
// instance for the cohort. Time is injected everywhere — a test that slept for a
// 10 s window is a test nobody runs.
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";

import {
  checkRunAllowance,
  DEFAULT_POLICY,
  GLOBAL_KEY,
  globalLimiter,
  resetRunAllowance,
  SlidingWindowLimiter,
} from "./rate-limit";

const T0 = 1_800_000_000_000; // fixed epoch; no Date.now() anywhere below

describe("SlidingWindowLimiter", () => {
  it("allows exactly the burst limit then refuses", () => {
    const limiter = new SlidingWindowLimiter(DEFAULT_POLICY);
    for (let i = 0; i < DEFAULT_POLICY.burst.limit; i++) {
      expect(limiter.consume("u1", T0 + i).allowed).toBe(true);
    }
    const refused = limiter.consume("u1", T0 + DEFAULT_POLICY.burst.limit);
    expect(refused.allowed).toBe(false);
  });

  it("reports how long to wait, in milliseconds", () => {
    const limiter = new SlidingWindowLimiter(DEFAULT_POLICY);
    for (let i = 0; i < DEFAULT_POLICY.burst.limit; i++) limiter.consume("u1", T0);
    const refused = limiter.consume("u1", T0 + 1_000);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    // Oldest hit was at T0, window is 10 000 ms, 1 000 ms have passed.
    expect(refused.retryAfterMs).toBe(DEFAULT_POLICY.burst.windowMs - 1_000);
    expect(refused.message).toContain("ms");
  });

  it("slides: capacity returns as the window moves, not on a fixed boundary", () => {
    const limiter = new SlidingWindowLimiter(DEFAULT_POLICY);
    for (let i = 0; i < DEFAULT_POLICY.burst.limit; i++) limiter.consume("u1", T0);
    expect(limiter.consume("u1", T0 + 9_999).allowed).toBe(false);
    expect(limiter.consume("u1", T0 + 10_001).allowed).toBe(true);
  });

  it("does not let one student's refusals affect another", () => {
    const limiter = new SlidingWindowLimiter(DEFAULT_POLICY);
    for (let i = 0; i < DEFAULT_POLICY.burst.limit + 5; i++) limiter.consume("noisy", T0);
    expect(limiter.consume("quiet", T0).allowed).toBe(true);
  });

  it("enforces the sustained window over a long session", () => {
    const limiter = new SlidingWindowLimiter(DEFAULT_POLICY);
    // Space runs 3 s apart: never trips the burst rule, eventually trips the
    // sustained one. This is the "a script grinding through the hour" case.
    let now = T0;
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      if (limiter.consume("u1", now).allowed) allowed++;
      now += 3_000;
    }
    expect(allowed).toBeLessThan(100);
    expect(allowed).toBeGreaterThanOrEqual(DEFAULT_POLICY.burst.limit);
  });

  it("prunes state for a refused caller so a hammering client cannot grow memory", () => {
    const limiter = new SlidingWindowLimiter(DEFAULT_POLICY);
    for (let i = 0; i < 500; i++) limiter.consume("u1", T0);
    expect(limiter.size("u1")).toBeLessThanOrEqual(DEFAULT_POLICY.sustained.limit);
  });
});

describe("checkRunAllowance", () => {
  beforeEach(resetRunAllowance);

  it("passes a first run", () => {
    expect(checkRunAllowance("user:1", T0).allowed).toBe(true);
  });

  it("does not charge the cohort budget for a run the user's own limit refused", () => {
    // One user hammers 50 times in the same millisecond. Their own burst rule
    // refuses most of those, and a refused run must not spend the cohort's
    // budget — otherwise one student could exhaust the shared Piston allowance
    // purely by being rejected. The cohort bucket must therefore hold only the
    // runs that were actually ALLOWED, never 50.
    for (let i = 0; i < 50; i++) checkRunAllowance("user:1", T0);
    expect(globalLimiter.size(GLOBAL_KEY)).toBeLessThanOrEqual(
      DEFAULT_POLICY.burst.limit,
    );
  });

  it("frees the cohort budget again once its window slides", () => {
    for (let i = 0; i < 50; i++) checkRunAllowance("user:1", T0);
    // Global burst window is 1 000 ms; a different student one second later must
    // not inherit the earlier burst's refusal.
    expect(checkRunAllowance("user:2", T0 + 1_001).allowed).toBe(true);
  });

  it("refuses with scope 'global' once the process-wide burst is spent", () => {
    // Distinct users so no per-user rule fires: this is the cohort protection.
    const first = checkRunAllowance("user:a", T0);
    const second = checkRunAllowance("user:b", T0);
    const third = checkRunAllowance("user:c", T0);
    const fourth = checkRunAllowance("user:d", T0);
    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    expect(fourth.allowed).toBe(false);
    if (fourth.allowed) return;
    expect(fourth.scope).toBe("global");
    expect(fourth.message).toContain("shared");
  });

  it("uses a global key no user id can collide with", () => {
    // The route builds every per-user key as `user:${id}`, so no id can produce
    // the cohort sentinel and spend or inspect that bucket.
    expect(GLOBAL_KEY).not.toMatch(/^user:/);
    expect(`user:${GLOBAL_KEY}`).not.toBe(GLOBAL_KEY);
  });
});
