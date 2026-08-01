import { describe, expect, it } from "vitest";

import { BUCKET_CAPACITY, RateLimiter, REFILL_PER_SECOND } from "./ratelimit";

/** A controllable clock, so no test in this file sleeps. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe("RateLimiter", () => {
  it("allows a burst up to the bucket capacity and refuses the next one", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let i = 0; i < BUCKET_CAPACITY; i += 1) {
      expect(limiter.consume("socket-a", 1).allowed).toBe(true);
    }
    const refused = limiter.consume("socket-a", 1);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills at exactly the configured rate", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let i = 0; i < BUCKET_CAPACITY; i += 1) limiter.consume("socket-a", 1);
    expect(limiter.consume("socket-a", 1).allowed).toBe(false);

    // One second buys exactly REFILL_PER_SECOND tokens back.
    clock.advance(1_000);
    for (let i = 0; i < REFILL_PER_SECOND; i += 1) {
      expect(limiter.consume("socket-a", 1).allowed).toBe(true);
    }
    expect(limiter.consume("socket-a", 1).allowed).toBe(false);
  });

  it("does NOT give a user with two tabs double budget", () => {
    // The property the two-key design exists for. Per-socket limiting alone is
    // bypassed by opening a second tab, which is one keystroke of effort.
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    let allowed = 0;
    for (let i = 0; i < BUCKET_CAPACITY * 2; i += 1) {
      const socketId = i % 2 === 0 ? "tab-1" : "tab-2";
      if (limiter.consume(socketId, 7).allowed) allowed += 1;
    }

    expect(allowed).toBe(BUCKET_CAPACITY);
  });

  it("reports which bucket refused, so a chatty tab is distinguishable from a chatty user", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let i = 0; i < BUCKET_CAPACITY; i += 1) limiter.consume("tab-1", 7);
    expect(limiter.consume("tab-1", 7).limitedBy).toBe("socket");
    // A second tab still has a full socket bucket, so the USER bucket is what
    // refuses it.
    expect(limiter.consume("tab-2", 7).limitedBy).toBe("user");
  });

  it("does not charge the socket bucket when the user bucket refuses", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let i = 0; i < BUCKET_CAPACITY; i += 1) limiter.consume("tab-1", 7);
    // Drain nothing from tab-2's own bucket while the user is over budget.
    for (let i = 0; i < 20; i += 1) limiter.consume("tab-2", 7);

    // After a full refill, tab-2 must have its whole capacity available. If the
    // refusals had charged it, it would start short.
    clock.advance(10_000);
    let allowed = 0;
    for (let i = 0; i < BUCKET_CAPACITY; i += 1) {
      if (limiter.consume("tab-2", 7).allowed) allowed += 1;
    }
    expect(allowed).toBe(BUCKET_CAPACITY);
  });

  it("keeps separate budgets for separate users", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let i = 0; i < BUCKET_CAPACITY; i += 1) limiter.consume("a", 1);
    expect(limiter.consume("a", 1).allowed).toBe(false);
    expect(limiter.consume("b", 2).allowed).toBe(true);
  });

  it("does not hand back a fresh bucket to a client that cycles its socket", () => {
    // If releaseSocket dropped the USER bucket too, reconnecting would reset the
    // limit and the limiter would be advisory.
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let i = 0; i < BUCKET_CAPACITY; i += 1) limiter.consume("old", 5);
    limiter.releaseSocket("old");
    expect(limiter.consume("new", 5).allowed).toBe(false);
  });

  it("releases socket buckets on disconnect and sweeps idle user buckets", () => {
    // The leak criterion for this structure: nothing grows without bound.
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    for (let user = 1; user <= 50; user += 1) limiter.consume(`s-${user}`, user);
    expect(limiter.sizes()).toEqual({ sockets: 50, users: 50 });

    for (let user = 1; user <= 50; user += 1) limiter.releaseSocket(`s-${user}`);
    expect(limiter.sizes().sockets).toBe(0);

    // Not yet refilled, so nothing is discarded — a bucket mid-refill still
    // carries information.
    expect(limiter.sweep()).toBe(0);

    clock.advance(60_000);
    expect(limiter.sweep()).toBe(50);
    expect(limiter.sizes()).toEqual({ sockets: 0, users: 0 });
  });

  it("never accumulates beyond capacity however long a user is idle", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ clock: clock.now });

    limiter.consume("a", 1);
    clock.advance(3_600_000);

    let allowed = 0;
    for (let i = 0; i < 100; i += 1) {
      if (limiter.consume("a", 1).allowed) allowed += 1;
    }
    expect(allowed).toBe(BUCKET_CAPACITY);
  });
});
