// =============================================================================
// Unit tests for the live-class access and lifecycle rules.
// -----------------------------------------------------------------------------
// These are the decisions several routes share, so they are tested once here
// rather than four times through four handlers. No database: `mustOwn`,
// `canStart`/`canEnd`/`canJoin`, `minutesBetween` and `participationScore` are
// all pure. `ownershipFilter` is exercised only for its BRANCH (predicate vs
// undefined), because asserting on a Drizzle SQL object's internals would test
// the ORM rather than the rule.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { AuthUser } from "@/lib/guard";
import {
  canEnd,
  canJoin,
  canStart,
  minutesBetween,
  mustOwn,
  ownershipFilter,
  participationScore,
  type ClassStatus,
} from "./access";

const ALL_STATUSES: ClassStatus[] = ["scheduled", "active", "ended", "cancelled"];

function user(role: AuthUser["role"], id = 7): AuthUser {
  return { id, email: "a@b.c", name: "A", role, cohortId: null };
}

describe("mustOwn — who is restricted to their own classes", () => {
  it("an instructor is", () => {
    expect(mustOwn("instructor")).toBe(true);
  });

  it("an admin is not — covering for an absent colleague must not need a role change", () => {
    expect(mustOwn("admin")).toBe(false);
  });

  it("a student is, though the role guard stops them first", () => {
    // Defence in depth: if a student ever reached one of these handlers, the
    // ownership clause would still scope them to nothing.
    expect(mustOwn("student")).toBe(true);
  });
});

describe("ownershipFilter", () => {
  it("returns a predicate for an instructor", () => {
    expect(ownershipFilter(user("instructor"))).toBeDefined();
  });

  it("returns undefined for an admin — Drizzle's 'no extra constraint' value", () => {
    expect(ownershipFilter(user("admin"))).toBeUndefined();
  });
});

describe("canStart — idempotence is the feature", () => {
  it("a scheduled class starts", () => {
    expect(canStart("scheduled")).toEqual({ kind: "ok" });
  });

  it("an active class reports 'already', not an error", () => {
    // A retrying browser must not get an error page over a class that IS running.
    expect(canStart("active").kind).toBe("already");
  });

  it.each<ClassStatus>(["ended", "cancelled"])("refuses a %s class", (status) => {
    const verdict = canStart(status);
    expect(verdict.kind).toBe("refused");
    if (verdict.kind === "refused") expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("classifies every status — no state falls through", () => {
    for (const status of ALL_STATUSES) {
      expect(["ok", "already", "refused"]).toContain(canStart(status).kind);
    }
  });
});

describe("canEnd", () => {
  it("an active class ends", () => {
    expect(canEnd("active")).toEqual({ kind: "ok" });
  });

  it("an ended class reports 'already'", () => {
    expect(canEnd("ended").kind).toBe("already");
  });

  it("a scheduled class is REFUSED, not ended", () => {
    // `live_classes_ends_after_starts` exempts nulls, so an ended_at on a class
    // with no started_at would pass the CHECK and leave an uninterpretable row.
    const verdict = canEnd("scheduled");
    expect(verdict.kind).toBe("refused");
    if (verdict.kind === "refused") expect(verdict.reason).toMatch(/cancel/i);
  });

  it("classifies every status", () => {
    for (const status of ALL_STATUSES) {
      expect(["ok", "already", "refused"]).toContain(canEnd(status).kind);
    }
  });
});

describe("canJoin", () => {
  it("a SCHEDULED class is joinable — students arrive before the instructor", () => {
    expect(canJoin("scheduled")).toEqual({ kind: "ok" });
  });

  it("an active class is joinable", () => {
    expect(canJoin("active")).toEqual({ kind: "ok" });
  });

  it.each<ClassStatus>(["ended", "cancelled"])("refuses a %s class", (status) => {
    expect(canJoin(status).kind).toBe("refused");
  });
});

describe("minutesBetween", () => {
  const t0 = new Date("2026-08-01T10:00:00.000Z");

  it("floors partial minutes", () => {
    // 59 seconds of presence is zero minutes. Rounding up would let a
    // join-then-immediately-leave count as attendance.
    expect(minutesBetween(t0, new Date("2026-08-01T10:00:59.000Z"))).toBe(0);
    expect(minutesBetween(t0, new Date("2026-08-01T10:01:59.000Z"))).toBe(1);
  });

  it("is exact on a whole minute", () => {
    expect(minutesBetween(t0, new Date("2026-08-01T10:45:00.000Z"))).toBe(45);
  });

  it("floors a backwards clock at zero rather than returning a negative", () => {
    // A negative would fail `class_attendance_time_present_non_negative` and
    // abort a leave the student cannot retry.
    expect(minutesBetween(t0, new Date("2026-08-01T09:00:00.000Z"))).toBe(0);
  });

  it("is zero for identical instants", () => {
    expect(minutesBetween(t0, t0)).toBe(0);
  });
});

describe("participationScore", () => {
  const base = { durationMinutes: 60, messagesSent: 0, questionsAsked: 0, timePresentMinutes: 0 };

  it("is 0 for a student who was never present and said nothing", () => {
    expect(participationScore(base)).toBe(0);
  });

  it("is 60 for full presence and silence — the intended floor for 'attended'", () => {
    expect(participationScore({ ...base, timePresentMinutes: 60 })).toBe(60);
  });

  it("is 100 for full presence plus saturated chat and questions", () => {
    expect(
      participationScore({
        ...base,
        timePresentMinutes: 60,
        messagesSent: 10,
        questionsAsked: 3,
      }),
    ).toBe(100);
  });

  it("SATURATES the chat term — flooding the transcript earns nothing extra", () => {
    const atSaturation = participationScore({ ...base, timePresentMinutes: 60, messagesSent: 10 });
    const wayPast = participationScore({ ...base, timePresentMinutes: 60, messagesSent: 500 });
    expect(wayPast).toBe(atSaturation);
  });

  it("caps presence at the class duration", () => {
    // A tab left open overnight must not out-score a student who attended.
    const exact = participationScore({ ...base, timePresentMinutes: 60 });
    const overrun = participationScore({ ...base, timePresentMinutes: 6000 });
    expect(overrun).toBe(exact);
  });

  it("never exceeds 100 or falls below 0 — the column is CHECKed 0..100", () => {
    const extreme = participationScore({
      durationMinutes: 60,
      timePresentMinutes: 100_000,
      messagesSent: 100_000,
      questionsAsked: 100_000,
    });
    expect(extreme).toBeLessThanOrEqual(100);
    expect(extreme).toBeGreaterThanOrEqual(0);

    const negative = participationScore({
      durationMinutes: 60,
      timePresentMinutes: -50,
      messagesSent: -10,
      questionsAsked: -1,
    });
    expect(negative).toBe(0);
  });

  it("survives a zero duration without writing NaN", () => {
    // Cannot happen (`live_classes_duration_positive`) but NaN in an integer
    // column would fail the whole leave transaction rather than degrade.
    const score = participationScore({ ...base, durationMinutes: 0, timePresentMinutes: 30 });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBe(0);
  });

  it("always returns an integer", () => {
    const score = participationScore({
      durationMinutes: 45,
      timePresentMinutes: 17,
      messagesSent: 3,
      questionsAsked: 1,
    });
    expect(Number.isInteger(score)).toBe(true);
  });
});
