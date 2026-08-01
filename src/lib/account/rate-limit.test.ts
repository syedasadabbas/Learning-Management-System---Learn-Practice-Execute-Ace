// =============================================================================
// RATE-LIMITER TESTS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The clock is injected, so no test sleeps for a 15-minute window.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  clientIp,
  createRateLimiter,
  RESET_EMAIL_RULE,
  RESET_IP_RULE,
} from "./rate-limit";

const T0 = 1_700_000_000_000;
const RULE = { limit: 3, windowMs: 60_000 };

describe("createRateLimiter", () => {
  it("allows exactly `limit` attempts inside a window", () => {
    const limiter = createRateLimiter();
    expect(limiter.check("k", RULE, T0).allowed).toBe(true);
    expect(limiter.check("k", RULE, T0 + 1).allowed).toBe(true);
    expect(limiter.check("k", RULE, T0 + 2).allowed).toBe(true);
    expect(limiter.check("k", RULE, T0 + 3).allowed).toBe(false);
  });

  it("counts down `remaining`", () => {
    const limiter = createRateLimiter();
    expect(limiter.check("k", RULE, T0).remaining).toBe(2);
    expect(limiter.check("k", RULE, T0).remaining).toBe(1);
    expect(limiter.check("k", RULE, T0).remaining).toBe(0);
    expect(limiter.check("k", RULE, T0).remaining).toBe(0);
  });

  it("keys are independent", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RULE.limit; i += 1) limiter.check("a", RULE, T0);
    expect(limiter.check("a", RULE, T0).allowed).toBe(false);
    expect(limiter.check("b", RULE, T0).allowed).toBe(true);
  });

  it("opens a fresh window once the old one has passed", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RULE.limit + 1; i += 1) limiter.check("k", RULE, T0);
    expect(limiter.check("k", RULE, T0 + RULE.windowMs).allowed).toBe(true);
  });

  it("does NOT reset the window when a refused attempt arrives", () => {
    // Hammering must not extend a caller's quota by restarting the counter.
    const limiter = createRateLimiter();
    for (let i = 0; i < 20; i += 1) limiter.check("k", RULE, T0 + i);
    // Still inside the original window, so still refused...
    expect(limiter.check("k", RULE, T0 + RULE.windowMs - 1).allowed).toBe(false);
    // ...and the window ends when it always would have, not later.
    expect(limiter.check("k", RULE, T0 + RULE.windowMs).allowed).toBe(true);
  });

  it("reports when the window ends", () => {
    const limiter = createRateLimiter();
    expect(limiter.check("k", RULE, T0).resetAtMs).toBe(T0 + RULE.windowMs);
  });

  it("sweeps expired keys so the map cannot grow without bound", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 600; i += 1) limiter.check(`k${i}`, RULE, T0);
    const before = limiter.size();
    // One call past the window triggers the lazy sweep.
    limiter.check("trigger", RULE, T0 + RULE.windowMs + 1);
    expect(limiter.size()).toBeLessThan(before);
  });
});

describe("the shipped rules", () => {
  it("are expressed in milliseconds and are 15-minute windows", () => {
    expect(RESET_EMAIL_RULE.windowMs).toBe(900_000);
    expect(RESET_IP_RULE.windowMs).toBe(900_000);
  });

  it("limit an email more tightly than an IP, because a cohort shares a NAT", () => {
    expect(RESET_EMAIL_RULE.limit).toBeLessThan(RESET_IP_RULE.limit);
  });
});

describe("clientIp", () => {
  it("takes the leftmost x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" });
    expect(clientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("returns a stable placeholder when no header is present", () => {
    // "unknown" is a real key: every header-less caller shares one bucket, which
    // is the safe direction (it limits more, not less).
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
