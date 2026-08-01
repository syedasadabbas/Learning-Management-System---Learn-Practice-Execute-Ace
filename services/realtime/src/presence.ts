// =============================================================================
// PRESENCE — who is in the room, counted by DISTINCT USER and not by socket.
// -----------------------------------------------------------------------------
// "14 people in this class" must not become 20 because six of them have the tab
// open twice. Socket.io's own `room.size` counts sockets, which is why this
// exists rather than a call to it.
//
// TYPING INDICATORS EXPIRE ON A SERVER-SIDE DEADLINE, not on a per-user timer.
// A `setTimeout` per typing user is a timer created on a code path a client
// controls — the cheapest possible way for a client to make this process
// allocate — and it leaks if the socket vanishes between the keystroke and the
// timeout. Instead each typing user carries an expiry timestamp and ONE sweep
// (owned by ./server.ts, cleared on shutdown) removes the stale ones. Timers
// created: one, for the whole process.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

/**
 * How long a typing indicator survives without a refresh.
 *
 * Long enough to cover the gap between keystrokes while somebody thinks mid
 * sentence, short enough that a closed laptop stops showing "Ana is typing…" to
 * the whole class for the rest of the hour.
 */
export const TYPING_TTL_MS = 6_000;

export interface PresenceSnapshot {
  classId: number;
  /** Distinct user ids currently connected. */
  userIds: number[];
  /** Distinct users, i.e. `userIds.length`. The number a UI should show. */
  users: number;
  /** Open sockets. Always >= users; the gap is duplicate tabs. */
  sockets: number;
}

interface ClassPresence {
  /** userId -> number of open sockets for that user. */
  sockets: Map<number, number>;
  /** userId -> epoch ms at which their typing indicator expires. */
  typing: Map<number, number>;
}

export class PresenceRegistry {
  private readonly classes = new Map<number, ClassPresence>();
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  private forClass(classId: number): ClassPresence {
    const existing = this.classes.get(classId);
    if (existing) return existing;
    const fresh: ClassPresence = { sockets: new Map(), typing: new Map() };
    this.classes.set(classId, fresh);
    return fresh;
  }

  /** Returns true when this is the user's FIRST socket, i.e. a real join. */
  join(classId: number, userId: number): boolean {
    const presence = this.forClass(classId);
    const count = (presence.sockets.get(userId) ?? 0) + 1;
    presence.sockets.set(userId, count);
    return count === 1;
  }

  /** Returns true when this was the user's LAST socket, i.e. a real leave. */
  leave(classId: number, userId: number): boolean {
    const presence = this.classes.get(classId);
    if (!presence) return false;

    const count = (presence.sockets.get(userId) ?? 0) - 1;
    if (count > 0) {
      presence.sockets.set(userId, count);
      return false;
    }

    presence.sockets.delete(userId);
    presence.typing.delete(userId);

    // Drop the whole class entry when the room empties. Without this the Map
    // holds one entry per class the process has ever served — the leak criterion.
    if (presence.sockets.size === 0) this.classes.delete(classId);
    return true;
  }

  setTyping(classId: number, userId: number, typing: boolean): void {
    const presence = this.forClass(classId);
    if (typing) presence.typing.set(userId, this.clock() + TYPING_TTL_MS);
    else presence.typing.delete(userId);
  }

  /** Currently-typing user ids, excluding any whose indicator has lapsed. */
  typingIn(classId: number): number[] {
    const presence = this.classes.get(classId);
    if (!presence) return [];
    const now = this.clock();
    return [...presence.typing.entries()]
      .filter(([, expiresAt]) => expiresAt > now)
      .map(([userId]) => userId);
  }

  /**
   * Remove lapsed typing indicators everywhere.
   *
   * Returns the classes that CHANGED, so the caller re-broadcasts only those
   * rooms. Broadcasting to every room on every sweep would put a message on
   * every socket in the process twice a second, for nothing.
   */
  sweepTyping(): number[] {
    const now = this.clock();
    const changed: number[] = [];
    for (const [classId, presence] of this.classes) {
      let removed = false;
      for (const [userId, expiresAt] of presence.typing) {
        if (expiresAt <= now) {
          presence.typing.delete(userId);
          removed = true;
        }
      }
      if (removed) changed.push(classId);
    }
    return changed;
  }

  snapshot(classId: number): PresenceSnapshot {
    const presence = this.classes.get(classId);
    if (!presence) return { classId, userIds: [], users: 0, sockets: 0 };

    const userIds = [...presence.sockets.keys()].sort((a, b) => a - b);
    const sockets = [...presence.sockets.values()].reduce((sum, n) => sum + n, 0);
    return { classId, userIds, users: userIds.length, sockets };
  }

  /** How many sockets this user holds in this class right now. */
  socketsFor(classId: number, userId: number): number {
    return this.classes.get(classId)?.sockets.get(userId) ?? 0;
  }

  /** Live size, for /healthz and the leak assertions. */
  sizes(): { classes: number; sockets: number } {
    let sockets = 0;
    for (const presence of this.classes.values()) {
      for (const count of presence.sockets.values()) sockets += count;
    }
    return { classes: this.classes.size, sockets };
  }
}
