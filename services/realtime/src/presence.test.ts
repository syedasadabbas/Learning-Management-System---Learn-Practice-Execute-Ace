import { describe, expect, it } from "vitest";

import { PresenceRegistry, TYPING_TTL_MS } from "./presence";

function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe("PresenceRegistry", () => {
  it("counts distinct users, not sockets", () => {
    // "14 people in this class" must not become 20 because six have two tabs.
    const presence = new PresenceRegistry();
    presence.join(10, 1);
    presence.join(10, 1);
    presence.join(10, 2);

    expect(presence.snapshot(10)).toEqual({ classId: 10, userIds: [1, 2], users: 2, sockets: 3 });
  });

  it("reports the first join and the last leave, and nothing in between", () => {
    // The join/leave announcements hang off these booleans; a second tab must
    // not make the participant list flicker for everybody.
    const presence = new PresenceRegistry();
    expect(presence.join(10, 1)).toBe(true);
    expect(presence.join(10, 1)).toBe(false);
    expect(presence.leave(10, 1)).toBe(false);
    expect(presence.leave(10, 1)).toBe(true);
  });

  it("forgets a class entirely once the room empties", () => {
    // The leak criterion: one entry per class ever served would grow forever.
    const presence = new PresenceRegistry();
    for (let classId = 1; classId <= 50; classId += 1) presence.join(classId, 1);
    expect(presence.sizes().classes).toBe(50);

    for (let classId = 1; classId <= 50; classId += 1) presence.leave(classId, 1);
    expect(presence.sizes()).toEqual({ classes: 0, sockets: 0 });
  });

  it("tolerates a leave for a user who never joined", () => {
    const presence = new PresenceRegistry();
    expect(presence.leave(10, 99)).toBe(false);
  });

  it("reports how many sockets one user holds, which the handshake cap depends on", () => {
    const presence = new PresenceRegistry();
    presence.join(10, 1);
    presence.join(10, 1);
    expect(presence.socketsFor(10, 1)).toBe(2);
    expect(presence.socketsFor(10, 2)).toBe(0);
    expect(presence.socketsFor(11, 1)).toBe(0);
  });
});

describe("typing indicators", () => {
  it("lapse after the TTL without any per-user timer", () => {
    const clock = fakeClock();
    const presence = new PresenceRegistry(clock.now);
    presence.join(10, 1);
    presence.setTyping(10, 1, true);

    expect(presence.typingIn(10)).toEqual([1]);
    clock.advance(TYPING_TTL_MS + 1);
    expect(presence.typingIn(10)).toEqual([]);
  });

  it("can be cleared explicitly before the TTL", () => {
    const clock = fakeClock();
    const presence = new PresenceRegistry(clock.now);
    presence.setTyping(10, 1, true);
    presence.setTyping(10, 1, false);
    expect(presence.typingIn(10)).toEqual([]);
  });

  it("sweeps only the classes that changed, so the sweep does not broadcast to every room", () => {
    const clock = fakeClock();
    const presence = new PresenceRegistry(clock.now);
    presence.join(10, 1);
    presence.join(11, 2);
    presence.setTyping(10, 1, true);
    clock.advance(TYPING_TTL_MS - 1);
    presence.setTyping(11, 2, true);

    clock.advance(2);
    expect(presence.sweepTyping()).toEqual([10]);
    // Already swept; a second sweep finds nothing to say.
    expect(presence.sweepTyping()).toEqual([]);
  });

  it("drops a typing indicator when the user leaves, without waiting for the TTL", () => {
    const clock = fakeClock();
    const presence = new PresenceRegistry(clock.now);
    presence.join(10, 1);
    presence.join(10, 2);
    presence.setTyping(10, 1, true);
    presence.leave(10, 1);

    expect(presence.typingIn(10)).toEqual([]);
  });
});
