// =============================================================================
// ENGAGEMENT TRACKING — counters in memory, flushed on disconnect and class end.
// -----------------------------------------------------------------------------
// THE SCORING FORMULA, stated once and in full:
//
//     score = min(100,
//                 round( 4 * messagesSent
//                      + 8 * questionsAsked
//                      + 8 * answersGiven
//                      + 2 * upvotesCast
//                      + 1 * reactionsAdded
//                      + 30 * min(1, connectedMinutes / 45) ))
//
// WHY THESE WEIGHTS.
//   * ATTENDANCE IS WORTH 30 AND IS THE ONLY SATURATING TERM. A student who
//     attends the whole class and says nothing scores 30. That is deliberate:
//     silence in a lecture is not disengagement, and a formula that scores it
//     zero is measuring extroversion. 45 minutes is the nominal class length, so
//     the term is "did you stay", not "how long can you idle" — it caps.
//   * A QUESTION IS WORTH TWICE A MESSAGE (8 vs 4). Asking in front of a cohort
//     costs something and is the behaviour the course wants more of.
//   * ANSWERING IS WORTH THE SAME AS ASKING. Instructors accumulate this too;
//     see the note on comparability below.
//   * A REACTION IS WORTH 1, the floor, because it is one tap. It is counted at
//     all only so that a quiet class with heavy reaction use is not recorded as
//     an empty room.
//   * THE CAP IS 100 AND IT IS LOAD-BEARING. Without it the metric rewards
//     volume without limit and the top of any ranking is whoever typed most,
//     which is a straightforwardly bad thing to optimise a classroom for. With
//     it, ~10 messages plus a question plus full attendance reaches 100 and
//     everything past that is the same number.
//
// WHAT THIS SCORE IS NOT. It is not a grade, it does not feed the leaderboard,
// and it is not comparable between a student and an instructor (an instructor
// answering fifteen questions saturates it by definition). It is an attendance-
// and-participation signal for one class, for the instructor's own reading.
//
// THE LOW-ENGAGEMENT ALERT — WHAT WAS ASKED FOR, AND WHAT WAS BUILT.
// The brief says "notify instructor of low engagement". Built as a SUMMARY at
// class end, not a live alert, and it is OFF BY DEFAULT:
//   * threshold: LOW_ENGAGEMENT_SCORE (default 15) — below the 30 that mere
//     full attendance earns, so it cannot fire for a student who simply attended
//     quietly. It fires for a student who was barely CONNECTED. That is the
//     distinction worth flagging and the only one this data supports.
//   * it requires ENGAGEMENT_ALERTS_ENABLED=true. A punitive automatic message
//     about a student's participation, derived from a proxy metric, is a product
//     and pastoral decision — not one a real-time service should make on its own
//     because a brief used the word "notify".
//   * it names students in a per-class digest to the instructor. It never
//     contacts the student, and nothing here writes a penalty.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import type { EngagementCounters, EngagementRecord } from "./types";

/** Points per countable action. See the header for the argument behind each. */
export const WEIGHTS = {
  message: 4,
  question: 8,
  answer: 8,
  upvote: 2,
  reaction: 1,
  /** Full value of the attendance term, awarded at ATTENDANCE_FULL_MS connected. */
  attendance: 30,
} as const;

/** Connected time at which the attendance term saturates: 45 minutes. */
export const ATTENDANCE_FULL_MS = 2_700_000;

export const SCORE_CAP = 100;

/** Below this, a student is reported in the end-of-class digest. See the header. */
export const LOW_ENGAGEMENT_SCORE = 15;

export function scoreOf(counters: EngagementCounters): number {
  const attendanceRatio = Math.min(1, counters.connectedMs / ATTENDANCE_FULL_MS);

  const raw =
    WEIGHTS.message * counters.messagesSent +
    WEIGHTS.question * counters.questionsAsked +
    WEIGHTS.answer * counters.answersGiven +
    WEIGHTS.upvote * counters.upvotesCast +
    WEIGHTS.reaction * counters.reactionsAdded +
    WEIGHTS.attendance * attendanceRatio;

  return Math.min(SCORE_CAP, Math.round(raw));
}

/** The countable actions. Names match the counter fields they increment. */
export type EngagementAction = "message" | "question" | "answer" | "upvote" | "reaction";

function emptyCounters(userId: number, classId: number): EngagementCounters {
  return {
    userId,
    classId,
    messagesSent: 0,
    questionsAsked: 0,
    answersGiven: 0,
    upvotesCast: 0,
    reactionsAdded: 0,
    connectedMs: 0,
  };
}

function key(classId: number, userId: number): string {
  return `${classId}:${userId}`;
}

/**
 * Accumulates counters for every user in every live class this process is
 * serving.
 *
 * NO TIMERS. Connected time is computed from a stored `connectedSince`
 * timestamp when the user disconnects, not ticked by an interval. An interval
 * per connected user is the exact leak the disconnect path exists to prevent,
 * and it would also be wrong: an interval that fires after the socket closed
 * keeps accruing time for somebody who left.
 *
 * MULTI-SOCKET AWARE. A user with two tabs is CONNECTED ONCE for the purposes of
 * time. Clock time only advances while at least one socket is open, so two tabs
 * for thirty minutes is thirty minutes, not sixty. Anything else lets a student
 * double their attendance term by opening a second tab.
 */
export class EngagementTracker {
  private readonly counters = new Map<string, EngagementCounters>();
  /** class:user -> when their FIRST currently-open socket connected. */
  private readonly connectedSince = new Map<string, number>();
  /** class:user -> how many sockets they currently hold. */
  private readonly openSockets = new Map<string, number>();
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  private countersFor(classId: number, userId: number): EngagementCounters {
    const k = key(classId, userId);
    const existing = this.counters.get(k);
    if (existing) return existing;
    const fresh = emptyCounters(userId, classId);
    this.counters.set(k, fresh);
    return fresh;
  }

  /** Call once per socket connect. */
  onConnect(classId: number, userId: number): void {
    const k = key(classId, userId);
    const open = (this.openSockets.get(k) ?? 0) + 1;
    this.openSockets.set(k, open);
    // Only the FIRST socket starts the clock. See the multi-socket note above.
    if (open === 1) this.connectedSince.set(k, this.clock());
    this.countersFor(classId, userId);
  }

  /**
   * Call once per socket disconnect. Returns the record to flush, or null when
   * the user still holds another socket — in which case the clock keeps running
   * and there is nothing to write yet.
   */
  onDisconnect(classId: number, userId: number): EngagementRecord | null {
    const k = key(classId, userId);
    const open = Math.max(0, (this.openSockets.get(k) ?? 0) - 1);

    if (open > 0) {
      this.openSockets.set(k, open);
      return null;
    }

    this.openSockets.delete(k);
    const since = this.connectedSince.get(k);
    this.connectedSince.delete(k);

    const counters = this.countersFor(classId, userId);
    if (since !== undefined) counters.connectedMs += Math.max(0, this.clock() - since);

    // The entry is REMOVED, not zeroed. This is the leak boundary: a process
    // that served a thousand classes must not hold a thousand classes' counters.
    // A later reconnect starts a fresh entry and the store's additive upsert
    // sums the two flushes — which is precisely why that upsert adds.
    this.counters.delete(k);

    return { ...counters, score: scoreOf(counters) };
  }

  /** Increment one action for a user. No-op if they are not tracked (post-disconnect race). */
  record(classId: number, userId: number, action: EngagementAction): void {
    const counters = this.countersFor(classId, userId);
    switch (action) {
      case "message":
        counters.messagesSent += 1;
        break;
      case "question":
        counters.questionsAsked += 1;
        break;
      case "answer":
        counters.answersGiven += 1;
        break;
      case "upvote":
        counters.upvotesCast += 1;
        break;
      case "reaction":
        counters.reactionsAdded += 1;
        break;
    }
  }

  /**
   * Drain everything for one class, as at `now`, and forget it.
   *
   * Used when a class ends while people are still connected — the sockets will
   * disconnect eventually, but the class's record should not wait on the slowest
   * participant's browser to close. Sockets still open have their time counted
   * up to this moment and their clock restarted, so a subsequent disconnect
   * flushes only the remainder rather than double-counting the same minutes.
   */
  drainClass(classId: number): EngagementRecord[] {
    const now = this.clock();
    const records: EngagementRecord[] = [];

    for (const [k, counters] of [...this.counters]) {
      if (counters.classId !== classId) continue;

      const since = this.connectedSince.get(k);
      if (since !== undefined) {
        counters.connectedMs += Math.max(0, now - since);
        this.connectedSince.set(k, now);
      }

      records.push({ ...counters, score: scoreOf(counters) });

      if (this.openSockets.has(k)) {
        // Still connected: keep the entry but reset the counters, so the
        // eventual disconnect flush adds only what happened after this drain.
        this.counters.set(k, emptyCounters(counters.userId, counters.classId));
      } else {
        this.counters.delete(k);
      }
    }

    return records;
  }

  /** Everything still tracked. Used by the shutdown flush and by the leak tests. */
  drainAll(): EngagementRecord[] {
    const classIds = new Set([...this.counters.values()].map((c) => c.classId));
    return [...classIds].flatMap((classId) => this.drainClass(classId));
  }

  /** Live sizes, for /healthz and for the leak assertions. */
  sizes(): { tracked: number; connected: number } {
    return { tracked: this.counters.size, connected: this.openSockets.size };
  }
}

/**
 * Students in a class whose score is below the configured threshold.
 *
 * Returns the list rather than sending anything. Whether an instructor is
 * emailed about it is a decision for the caller and, by default, the answer is
 * no — see the header.
 */
export function lowEngagement(
  records: EngagementRecord[],
  threshold: number = LOW_ENGAGEMENT_SCORE,
): EngagementRecord[] {
  return records.filter((record) => record.score < threshold);
}
