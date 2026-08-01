import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_FULL_MS,
  EngagementTracker,
  lowEngagement,
  LOW_ENGAGEMENT_SCORE,
  SCORE_CAP,
  scoreOf,
  WEIGHTS,
} from "./engagement";
import type { EngagementCounters } from "./types";

function counters(overrides: Partial<EngagementCounters> = {}): EngagementCounters {
  return {
    userId: 1,
    classId: 10,
    messagesSent: 0,
    questionsAsked: 0,
    answersGiven: 0,
    upvotesCast: 0,
    reactionsAdded: 0,
    connectedMs: 0,
    ...overrides,
  };
}

function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe("scoreOf", () => {
  it("scores an empty record zero", () => {
    expect(scoreOf(counters())).toBe(0);
  });

  it("awards the full attendance term for a whole class and nothing more for staying longer", () => {
    // The saturating term. A student who attends and says nothing scores 30 —
    // silence in a lecture is not disengagement.
    expect(scoreOf(counters({ connectedMs: ATTENDANCE_FULL_MS }))).toBe(WEIGHTS.attendance);
    expect(scoreOf(counters({ connectedMs: ATTENDANCE_FULL_MS * 4 }))).toBe(WEIGHTS.attendance);
  });

  it("prorates attendance below the full class length", () => {
    expect(scoreOf(counters({ connectedMs: ATTENDANCE_FULL_MS / 2 }))).toBe(
      WEIGHTS.attendance / 2,
    );
  });

  it("values a question at twice a message", () => {
    expect(scoreOf(counters({ questionsAsked: 1 }))).toBe(2 * scoreOf(counters({ messagesSent: 1 })));
  });

  it("caps at 100 however much is typed", () => {
    // Without the cap the metric rewards volume without limit, and the top of
    // any ranking is whoever typed most.
    expect(scoreOf(counters({ messagesSent: 10_000 }))).toBe(SCORE_CAP);
  });

  it("is reachable in full by ordinary participation, not only by flooding", () => {
    // The calibration check. 15 messages plus a question across a whole class is
    // 98 — engaged but not saturated — and a couple more reaches the cap. If a
    // weight is ever changed, this is the test that says whether the metric is
    // still achievable by a person rather than only by a bot.
    expect(
      scoreOf(counters({ connectedMs: ATTENDANCE_FULL_MS, messagesSent: 15, questionsAsked: 1 })),
    ).toBe(98);
    expect(
      scoreOf(counters({ connectedMs: ATTENDANCE_FULL_MS, messagesSent: 18, questionsAsked: 1 })),
    ).toBe(SCORE_CAP);
  });
});

describe("EngagementTracker connected time", () => {
  it("counts the time between connect and disconnect", () => {
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    tracker.onConnect(10, 1);
    clock.advance(600_000);
    const record = tracker.onDisconnect(10, 1);

    expect(record?.connectedMs).toBe(600_000);
  });

  it("does NOT double-count a user with two tabs", () => {
    // Two tabs for thirty minutes is thirty minutes. Anything else lets a
    // student double their attendance term by opening a second tab.
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    tracker.onConnect(10, 1);
    clock.advance(60_000);
    tracker.onConnect(10, 1);
    clock.advance(60_000);

    // First tab closes: the user is still connected, so nothing is flushed.
    expect(tracker.onDisconnect(10, 1)).toBeNull();
    clock.advance(60_000);

    const record = tracker.onDisconnect(10, 1);
    expect(record?.connectedMs).toBe(180_000);
  });

  it("accumulates actions and derives the score at flush time", () => {
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    tracker.onConnect(10, 1);
    tracker.record(10, 1, "message");
    tracker.record(10, 1, "message");
    tracker.record(10, 1, "question");
    tracker.record(10, 1, "reaction");
    tracker.record(10, 1, "upvote");
    clock.advance(ATTENDANCE_FULL_MS);

    const record = tracker.onDisconnect(10, 1);
    expect(record).toMatchObject({
      messagesSent: 2,
      questionsAsked: 1,
      reactionsAdded: 1,
      upvotesCast: 1,
      connectedMs: ATTENDANCE_FULL_MS,
    });
    expect(record?.score).toBe(
      2 * WEIGHTS.message + WEIGHTS.question + WEIGHTS.reaction + WEIGHTS.upvote + WEIGHTS.attendance,
    );
  });
});

describe("EngagementTracker leaks", () => {
  it("holds nothing after every user disconnects", () => {
    // The memory-leak acceptance criterion for this structure.
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    for (let user = 1; user <= 100; user += 1) tracker.onConnect(10, user);
    clock.advance(1_000);
    expect(tracker.sizes()).toEqual({ tracked: 100, connected: 100 });

    for (let user = 1; user <= 100; user += 1) tracker.onDisconnect(10, user);
    expect(tracker.sizes()).toEqual({ tracked: 0, connected: 0 });
  });

  it("does not retain a class after drainAll when nobody is connected", () => {
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    tracker.onConnect(10, 1);
    clock.advance(1_000);
    tracker.onDisconnect(10, 1);
    expect(tracker.drainAll()).toEqual([]);
    expect(tracker.sizes().tracked).toBe(0);
  });
});

describe("drainClass", () => {
  it("flushes a still-connected user without double counting their time later", () => {
    // Class ends while people are still connected. Their time is counted up to
    // now and the clock restarts, so the eventual disconnect adds only the
    // remainder.
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    tracker.onConnect(10, 1);
    tracker.record(10, 1, "message");
    clock.advance(300_000);

    const drained = tracker.drainClass(10);
    expect(drained).toHaveLength(1);
    expect(drained[0]?.connectedMs).toBe(300_000);
    expect(drained[0]?.messagesSent).toBe(1);

    clock.advance(60_000);
    const afterwards = tracker.onDisconnect(10, 1);
    expect(afterwards?.connectedMs).toBe(60_000);
    expect(afterwards?.messagesSent).toBe(0);
  });

  it("leaves other classes alone", () => {
    const clock = fakeClock();
    const tracker = new EngagementTracker(clock.now);

    tracker.onConnect(10, 1);
    tracker.onConnect(11, 2);
    clock.advance(1_000);

    expect(tracker.drainClass(10).map((r) => r.classId)).toEqual([10]);
    // BOTH entries remain tracked: class 11 was untouched, and class 10's user
    // is still connected so their entry is kept and zeroed rather than dropped.
    // Dropping it would restart their attendance clock from nothing.
    expect(tracker.sizes().tracked).toBe(2);
    expect(tracker.drainClass(11).map((r) => r.classId)).toEqual([11]);
  });
});

describe("lowEngagement", () => {
  it("does not flag a student who merely attended quietly", () => {
    // The threshold sits below the 30 that full attendance alone earns, so this
    // cannot fire for silence. It fires for absence.
    const attended = { ...counters({ connectedMs: ATTENDANCE_FULL_MS }), score: WEIGHTS.attendance };
    expect(lowEngagement([attended])).toEqual([]);
  });

  it("flags a student who was barely connected", () => {
    const barely = { ...counters({ connectedMs: 120_000 }), score: scoreOf(counters({ connectedMs: 120_000 })) };
    expect(barely.score).toBeLessThan(LOW_ENGAGEMENT_SCORE);
    expect(lowEngagement([barely])).toHaveLength(1);
  });

  it("honours an explicit threshold", () => {
    const record = { ...counters(), score: 40 };
    expect(lowEngagement([record], 50)).toHaveLength(1);
    expect(lowEngagement([record], 30)).toHaveLength(0);
  });
});
