// =============================================================================
// INVARIANT I2 — expiry is server-authoritative.
// -----------------------------------------------------------------------------
// The named hard case for this stream is "expiry evaluated with a client clock
// skewed hours into the past", and the reason it is a named case is that the naive
// implementation passes every other test: `deadlineAtMs - Date.now()` is correct
// on a machine whose clock is right, and silently grants free time on one whose
// clock is wrong.
//
// The property proved below is that NOTHING in this module reads a clock. Every
// decision takes `now` as an argument, so a skewed client value cannot enter one
// — there is no parameter to put it in. That is what makes I2 structural rather
// than careful.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  computeDeadlineAt,
  countdownSeed,
  effectiveTimeLimitMinutes,
  elapsedMs,
  GRAND_QUIZ_DEFAULT_MINUTES,
  isExpired,
  MS_PER_MINUTE,
  remainingMs,
} from "./timing";

const STARTED_AT = new Date("2026-07-30T09:00:00.000Z");

describe("effectiveTimeLimitMinutes", () => {
  it("uses the stored limit when it is set", () => {
    expect(effectiveTimeLimitMinutes(90)).toBe(90);
  });

  it("falls back to 120 for null, zero and negative — never to 'untimed'", () => {
    // The dangerous alternative would be treating these as no limit, which hands
    // one student an unlimited exam because of an authoring gap.
    expect(effectiveTimeLimitMinutes(null)).toBe(GRAND_QUIZ_DEFAULT_MINUTES);
    expect(effectiveTimeLimitMinutes(undefined)).toBe(GRAND_QUIZ_DEFAULT_MINUTES);
    expect(effectiveTimeLimitMinutes(0)).toBe(GRAND_QUIZ_DEFAULT_MINUTES);
    expect(effectiveTimeLimitMinutes(-30)).toBe(GRAND_QUIZ_DEFAULT_MINUTES);
    expect(effectiveTimeLimitMinutes(Number.NaN)).toBe(GRAND_QUIZ_DEFAULT_MINUTES);
  });
});

describe("computeDeadlineAt (I2 — computed once, on the server)", () => {
  it("is startedAt + timeLimitMinutes", () => {
    const deadline = computeDeadlineAt(STARTED_AT, 120);
    expect(deadline.getTime() - STARTED_AT.getTime()).toBe(120 * MS_PER_MINUTE);
    expect(deadline.toISOString()).toBe("2026-07-30T11:00:00.000Z");
  });

  it("is deterministic — the same inputs always give the same deadline", () => {
    // Which is what makes "stored once and never updated" a safe design: recomputing
    // it from the same started_at would produce the same value, so a stray write
    // could not be hidden by a plausible-looking result.
    expect(computeDeadlineAt(STARTED_AT, 120).getTime()).toBe(
      computeDeadlineAt(STARTED_AT, 120).getTime(),
    );
  });
});

describe("isExpired (I2)", () => {
  const deadline = new Date("2026-07-30T11:00:00.000Z");

  it("is false one millisecond before the deadline", () => {
    expect(isExpired(deadline, new Date(deadline.getTime() - 1))).toBe(false);
  });

  it("is true at the exact deadline millisecond", () => {
    expect(isExpired(deadline, deadline)).toBe(true);
  });

  it("is true after the deadline", () => {
    expect(isExpired(deadline, new Date(deadline.getTime() + 1))).toBe(true);
  });

  it("is never expired when there is no deadline", () => {
    // Refusing an attempt because a nullable column is null would take marks from
    // a student for a data problem they did not cause.
    expect(isExpired(null, new Date())).toBe(false);
    expect(isExpired(undefined, new Date())).toBe(false);
  });

  // -------------------------------------------------------------------------
  // THE NAMED HARD CASE: a client clock skewed hours into the past.
  // -------------------------------------------------------------------------
  it("HARD CASE: a client clock hours in the past cannot un-expire an attempt", () => {
    const serverNow = new Date("2026-07-30T13:00:00.000Z"); // two hours past deadline
    const clientNow = new Date("2026-07-30T09:05:00.000Z"); // device clock, 4 h slow

    // The server's own instant is the only one the decision ever sees.
    expect(isExpired(deadline, serverNow)).toBe(true);

    // And for completeness: the skewed instant would indeed have said "not
    // expired". This assertion is the point of the test — it documents exactly
    // the wrong answer the production path is structurally unable to reach,
    // because `isExpired` is only ever called with a server-side `new Date()`
    // (see saveExamAnswer / submitExam / buildView in ./service.ts) and no
    // request schema in ./validation.ts carries a timing field.
    expect(isExpired(deadline, clientNow)).toBe(false);
  });

  it("HARD CASE: a client clock hours in the FUTURE cannot expire it early either", () => {
    // The mirror-image cheat: skewing forward to claim the exam is over and get a
    // score before finishing. Same defence, same reason.
    const serverNow = new Date("2026-07-30T09:30:00.000Z"); // 30 min in
    expect(isExpired(deadline, serverNow)).toBe(false);
  });
});

describe("remainingMs", () => {
  const deadline = new Date("2026-07-30T11:00:00.000Z");

  it("is the gap in milliseconds", () => {
    expect(remainingMs(deadline, new Date("2026-07-30T10:00:00.000Z"))).toBe(60 * MS_PER_MINUTE);
  });

  it("floors at zero rather than going negative", () => {
    expect(remainingMs(deadline, new Date("2026-07-30T12:00:00.000Z"))).toBe(0);
  });

  it("is null when untimed, never Infinity", () => {
    expect(remainingMs(null, new Date())).toBeNull();
  });
});

describe("elapsedMs", () => {
  it("floors at zero, so a clock adjustment cannot produce a negative duration", () => {
    expect(elapsedMs(STARTED_AT, new Date(STARTED_AT.getTime() - 5_000))).toBe(0);
  });

  it("is the gap in milliseconds", () => {
    expect(elapsedMs(STARTED_AT, new Date(STARTED_AT.getTime() + 90 * MS_PER_MINUTE))).toBe(
      90 * MS_PER_MINUTE,
    );
  });
});

describe("countdownSeed (presentation only)", () => {
  it("carries the server's clock so the browser can correct its own skew", () => {
    const deadline = new Date("2026-07-30T11:00:00.000Z");
    const serverNow = new Date("2026-07-30T10:30:00.000Z");
    const seed = countdownSeed(deadline, serverNow);

    expect(seed).toEqual({
      deadlineAtMs: deadline.getTime(),
      serverNowMs: serverNow.getTime(),
      remainingMs: 30 * MS_PER_MINUTE,
      expired: false,
    });
  });

  it("reports an already-expired attempt as expired, with zero remaining", () => {
    const deadline = new Date("2026-07-30T11:00:00.000Z");
    const seed = countdownSeed(deadline, new Date("2026-07-30T11:00:01.000Z"));
    expect(seed.expired).toBe(true);
    expect(seed.remainingMs).toBe(0);
  });

  it("has no field a client could use to report a time back", () => {
    // The seed is one-directional by shape: there is no `clientNow`, no
    // `remainingReported`, nothing the browser is invited to fill in.
    const seed = countdownSeed(new Date(), new Date());
    expect(Object.keys(seed).sort()).toEqual([
      "deadlineAtMs",
      "expired",
      "remainingMs",
      "serverNowMs",
    ]);
  });
});
