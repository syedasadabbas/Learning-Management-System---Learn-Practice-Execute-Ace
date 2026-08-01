// =============================================================================
// RETRY POLICY TESTS.
// -----------------------------------------------------------------------------
// This file is where "bounded attempts, backoff in milliseconds, and a terminal
// dead-letter state" stops being a claim in a comment and becomes an assertion.
// Nothing here sleeps: `now` and `random` are parameters of every function under
// test, so a backoff is checked by reading the number it returns rather than by
// waiting for it — a timing-based version of these tests would be flaky on CI
// and would be deleted the first time it went red for no reason.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_MS,
  BACKOFF_CEILING_MS,
  BACKOFF_FACTOR,
  BACKOFF_JITTER_RATIO,
  DEFAULT_MAX_ATTEMPTS,
  LEASE_MS,
  MAX_ERROR_CHARS,
  backoffDelayMs,
  decideNextState,
  truncateError,
} from "./policy";

/** A `random` that returns exactly 0.5, i.e. the midpoint — zero jitter. */
const noJitter = () => 0.5;

describe("backoffDelayMs — the numbers, in milliseconds", () => {
  it("grows by BACKOFF_FACTOR each attempt, starting at BACKOFF_BASE_MS", () => {
    // Written as the concrete millisecond values a reader can check against the
    // documented "roughly 7.5 minutes over five attempts", not as a re-derivation
    // of the same formula the implementation uses — a test that recomputes the
    // implementation asserts nothing.
    expect(backoffDelayMs(1, noJitter)).toBe(30_000);
    expect(backoffDelayMs(2, noJitter)).toBe(60_000);
    expect(backoffDelayMs(3, noJitter)).toBe(120_000);
    expect(backoffDelayMs(4, noJitter)).toBe(240_000);
    expect(backoffDelayMs(5, noJitter)).toBe(480_000);
  });

  it("keeps the four delays a job actually experiences under 8 minutes total", () => {
    // DEFAULT_MAX_ATTEMPTS attempts means DEFAULT_MAX_ATTEMPTS - 1 waits.
    const waits = Array.from({ length: DEFAULT_MAX_ATTEMPTS - 1 }, (_, i) =>
      backoffDelayMs(i + 1, noJitter),
    );
    const totalMs = waits.reduce((a, b) => a + b, 0);
    expect(totalMs).toBe(450_000);
    expect(totalMs).toBeLessThan(480_000);
  });

  it("never exceeds BACKOFF_CEILING_MS, even at absurd attempt numbers", () => {
    // The ceiling exists for a future kind that raises maxAttempts. Attempt 40
    // would be astronomically large without the clamp, which in practice means
    // "scheduled after the heat death of the sun" — indistinguishable from lost.
    for (const attempt of [10, 20, 40, 1_000]) {
      expect(backoffDelayMs(attempt, () => 0.999)).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
    }
  });

  it("applies jitter symmetrically within ±BACKOFF_JITTER_RATIO", () => {
    const base = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, 2); // attempt 3
    const lowest = backoffDelayMs(3, () => 0);
    const highest = backoffDelayMs(3, () => 0.999_999);

    expect(lowest).toBe(Math.round(base * (1 - BACKOFF_JITTER_RATIO)));
    expect(highest).toBeGreaterThan(base);
    expect(highest).toBeLessThanOrEqual(Math.round(base * (1 + BACKOFF_JITTER_RATIO)));
    // The band is what breaks the retry convoy against a rate-limited relay.
    expect(highest - lowest).toBeGreaterThan(0);
  });

  it("is always a positive integer — a zero delay is an instant re-run", () => {
    for (const attempt of [1, 2, 3, 7]) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999_999]) {
        const delay = backoffDelayMs(attempt, () => r);
        expect(Number.isInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThan(0);
      }
    }
  });

  it("survives a hostile random source rather than trusting it", () => {
    // A stubbed generator returning 1, NaN or a negative number is a test bug in
    // somebody else's file; it must not produce a negative or NaN delay here.
    for (const r of [1, 1.5, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const delay = backoffDelayMs(2, () => r);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
    }
  });

  it("treats a nonsensical attempt count as the first retry", () => {
    expect(backoffDelayMs(0, noJitter)).toBe(30_000);
    expect(backoffDelayMs(-5, noJitter)).toBe(30_000);
    expect(backoffDelayMs(Number.NaN, noJitter)).toBe(30_000);
  });
});

describe("decideNextState — bounded attempts and a terminal dead-letter", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");

  it("marks a success terminal and clears the error", () => {
    const next = decideNextState({ attempts: 1, maxAttempts: 5 }, { status: "succeeded" }, now);
    expect(next.status).toBe("succeeded");
    expect(next.completedAt).toEqual(now);
    expect(next.lastError).toBeNull();
    expect(next.delayMs).toBe(0);
    expect(next.terminalReason).toBe("succeeded");
  });

  it("dead-letters a PERMANENT failure on the first attempt, without retrying", () => {
    // The whole reason JobOutcome is a value rather than an exception: only the
    // handler can tell "the relay is down" from "this submission was deleted".
    const next = decideNextState(
      { attempts: 1, maxAttempts: 5 },
      { status: "dead", error: "Submission 7 no longer exists." },
      now,
    );
    expect(next.status).toBe("dead");
    expect(next.terminalReason).toBe("permanent");
    expect(next.completedAt).toEqual(now);
    expect(next.lastError).toContain("no longer exists");
    // Explicitly NOT the exhausted wording — an operator must be able to tell
    // "retry this after fixing SMTP" from "do not bother".
    expect(next.lastError).not.toContain("gave up after");
  });

  it("re-queues a transient failure with the backoff written into run_after", () => {
    const next = decideNextState(
      { attempts: 2, maxAttempts: 5 },
      { status: "retry", error: "relay refused" },
      now,
      noJitter,
    );
    expect(next.status).toBe("queued");
    expect(next.completedAt).toBeNull();
    expect(next.delayMs).toBe(60_000);
    expect(next.runAfter.getTime()).toBe(now.getTime() + 60_000);
  });

  it("dead-letters on the LAST allowed attempt, not one after it", () => {
    // The off-by-one that decides whether a job gets four retries or five.
    // `attempts` is already incremented by the claim, so attempts === maxAttempts
    // means "this run was the last one permitted".
    const lastAllowed = decideNextState(
      { attempts: 5, maxAttempts: 5 },
      { status: "retry", error: "relay refused" },
      now,
    );
    expect(lastAllowed.status).toBe("dead");
    expect(lastAllowed.terminalReason).toBe("attempts_exhausted");
    expect(lastAllowed.lastError).toContain("gave up after 5 attempts");

    const oneBefore = decideNextState(
      { attempts: 4, maxAttempts: 5 },
      { status: "retry", error: "relay refused" },
      now,
    );
    expect(oneBefore.status).toBe("queued");
  });

  it("reaches a terminal state even when maxAttempts is 0 or negative", () => {
    // A `max_attempts` of 0 in a hand-written row must not mean "retry forever
    // with a comparison that never trips".
    for (const maxAttempts of [0, -1]) {
      const next = decideNextState(
        { attempts: 1, maxAttempts },
        { status: "retry", error: "boom" },
        now,
      );
      expect(next.status).toBe("dead");
      expect(next.terminalReason).toBe("attempts_exhausted");
    }
  });

  it("uses the singular in the give-up message for a one-attempt job", () => {
    const next = decideNextState(
      { attempts: 1, maxAttempts: 1 },
      { status: "retry", error: "boom" },
      now,
    );
    expect(next.lastError).toContain("gave up after 1 attempt");
    expect(next.lastError).not.toContain("1 attempts");
  });

  it("EVERY outcome reaches queued, succeeded or dead — nothing stalls", () => {
    // The property that makes "a job that fails forever becomes visible" true:
    // there is no fourth branch and no path that leaves the row `running`.
    const outcomes = [
      { status: "succeeded" as const },
      { status: "retry" as const, error: "x" },
      { status: "dead" as const, error: "x" },
    ];
    for (const outcome of outcomes) {
      for (const attempts of [1, 3, 5, 9]) {
        const next = decideNextState({ attempts, maxAttempts: 5 }, outcome, now);
        expect(["queued", "succeeded", "dead"]).toContain(next.status);
        // A terminal state always stamps completedAt; a retry never does.
        expect(next.completedAt === null).toBe(next.status === "queued");
      }
    }
  });
});

describe("truncateError", () => {
  it("caps the stored error at roughly 1 kB", () => {
    const long = "x".repeat(MAX_ERROR_CHARS * 3);
    const out = truncateError(long);
    expect(out.length).toBe(MAX_ERROR_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves a short message untouched and never stores an empty string", () => {
    expect(truncateError("  relay refused  ")).toBe("relay refused");
    expect(truncateError("")).toBe("Unknown error.");
  });
});

describe("the constants themselves", () => {
  it("gives the lease enough room for the slowest legitimate handler", () => {
    // An SMTP send is bounded by three 10_000 ms timeouts (SMTP_TIMEOUT_MS in
    // src/lib/mail/smtp.ts). A lease shorter than that is a DOUBLE SEND: a second
    // worker reclaims the job while the first is still talking to the relay.
    const worstCaseHandlerMs = 30_000;
    expect(LEASE_MS).toBeGreaterThan(worstCaseHandlerMs * 2);
  });

  it("keeps every duration in milliseconds — no seconds hiding in this module", () => {
    // House rule 5. A value like `30` here would mean somebody wrote seconds.
    for (const ms of [BACKOFF_BASE_MS, BACKOFF_CEILING_MS, LEASE_MS]) {
      expect(ms).toBeGreaterThanOrEqual(1_000);
      expect(Number.isInteger(ms)).toBe(true);
    }
  });
});
