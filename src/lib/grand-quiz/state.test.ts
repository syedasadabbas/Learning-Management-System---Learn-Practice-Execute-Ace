// =============================================================================
// INVARIANT I3 (the pure half) — submission is terminal for writing.
// -----------------------------------------------------------------------------
// The transactional half of I3 needs a database and is covered by the row-lock
// path in ./queries.ts plus the concurrency tests in ./service.test.ts. This file
// pins down the DECISION: once an attempt is submitted or graded, no answer may be
// written, and the reason given must be the accurate one.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  ATTEMPT_STATUSES,
  autosaveDecision,
  isProvisionalStatus,
  isTerminal,
  statusForFinalized,
  TERMINAL_STATUSES,
} from "./state";

const NOW = new Date("2026-07-30T10:00:00.000Z");
const FUTURE = new Date("2026-07-30T11:00:00.000Z");
const PAST = new Date("2026-07-30T09:00:00.000Z");

describe("isTerminal (I3)", () => {
  it("only `in_progress` is writable", () => {
    expect(isTerminal("in_progress")).toBe(false);
    expect(isTerminal("submitted")).toBe(true);
    expect(isTerminal("graded")).toBe(true);
  });

  it("FAILS CLOSED on an unrecognised status", () => {
    // A status this code does not understand is not a licence to keep writing
    // answers into the attempt. The safe default is "closed".
    expect(isTerminal("archived")).toBe(true);
    expect(isTerminal("")).toBe(true);
    expect(isTerminal("IN_PROGRESS")).toBe(true);
  });

  it("agrees with TERMINAL_STATUSES for every enum value", () => {
    for (const status of ATTEMPT_STATUSES) {
      expect(isTerminal(status)).toBe(TERMINAL_STATUSES.includes(status));
    }
  });
});

describe("statusForFinalized (I6's persistence)", () => {
  it("is `graded` when everything auto-graded", () => {
    expect(statusForFinalized(0)).toBe("graded");
  });

  it("is `submitted` while anything is deferred", () => {
    expect(statusForFinalized(1)).toBe("submitted");
    expect(statusForFinalized(8)).toBe("submitted");
  });

  it("`submitted` is the status that reads as provisional", () => {
    expect(isProvisionalStatus(statusForFinalized(1))).toBe(true);
    expect(isProvisionalStatus(statusForFinalized(0))).toBe(false);
  });
});

describe("autosaveDecision (I3 — the autosave refusal)", () => {
  it("accepts a write to an open attempt with time left", () => {
    expect(autosaveDecision({ status: "in_progress", deadlineAt: FUTURE, now: NOW })).toEqual({
      accept: true,
    });
  });

  it("REFUSES a write after submit — an answer written then is a mark after the exam closed", () => {
    const decision = autosaveDecision({ status: "submitted", deadlineAt: FUTURE, now: NOW });
    expect(decision.accept).toBe(false);
    expect(decision.accept === false && decision.code).toBe("attempt_terminal");
  });

  it("REFUSES a write to a graded attempt", () => {
    const decision = autosaveDecision({ status: "graded", deadlineAt: FUTURE, now: NOW });
    expect(decision.accept === false && decision.code).toBe("attempt_terminal");
  });

  it("REFUSES a write after the stored deadline", () => {
    const decision = autosaveDecision({ status: "in_progress", deadlineAt: PAST, now: NOW });
    expect(decision.accept === false && decision.code).toBe("attempt_expired");
  });

  it("reports TERMINAL rather than EXPIRED when both are true", () => {
    // They are different facts and the student is owed the accurate one: "you
    // already submitted" is actionable, "you ran out of time" would be a lie.
    const decision = autosaveDecision({ status: "submitted", deadlineAt: PAST, now: NOW });
    expect(decision.accept === false && decision.code).toBe("attempt_terminal");
  });

  it("accepts when there is no deadline at all — a null column is not a refusal", () => {
    expect(
      autosaveDecision({ status: "in_progress", deadlineAt: null, now: NOW }).accept,
    ).toBe(true);
  });

  it("HARD CASE: a device clock hours in the past cannot re-open a closed window", () => {
    // `now` is always the SERVER's instant at the call site (see ./service.ts).
    // Passing a client-skewed value is not a code path that exists — the request
    // schemas in ./validation.ts carry no timing field — but the arithmetic is
    // pinned here so a future signature change that admitted one would fail.
    const serverNow = new Date("2026-07-30T13:00:00.000Z");
    const deadline = new Date("2026-07-30T11:00:00.000Z");
    const decision = autosaveDecision({ status: "in_progress", deadlineAt: deadline, now: serverNow });
    expect(decision.accept === false && decision.code).toBe("attempt_expired");
  });

  it("every refusal carries prose a student can act on", () => {
    for (const status of ["submitted", "graded"] as const) {
      const decision = autosaveDecision({ status, deadlineAt: FUTURE, now: NOW });
      expect(decision.accept === false && decision.error.length).toBeGreaterThan(20);
    }
    const expiredDecision = autosaveDecision({
      status: "in_progress",
      deadlineAt: PAST,
      now: NOW,
    });
    expect(expiredDecision.accept === false && expiredDecision.error).toMatch(/time/i);
  });
});
