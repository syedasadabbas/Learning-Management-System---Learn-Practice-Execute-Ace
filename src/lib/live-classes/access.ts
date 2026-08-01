// =============================================================================
// LIVE-CLASS ACCESS AND LIFECYCLE RULES — the pure decisions, extracted so they
// can be tested without a database.
// Owner: the API stream. (src/lib/live-classes/realtime-token.ts is the
// real-time stream's file and is not touched here.)
// -----------------------------------------------------------------------------
// WHY THESE ARE FUNCTIONS AND NOT `if`s IN THE HANDLERS.
//
// Every one of them is a rule that must be identical across several routes.
// "May this instructor end this class?" is asked by /start, /end, PUT and
// DELETE; "is this class joinable?" by /join and by the room page. A rule
// written four times is a rule that will differ in one of them, and the one it
// differs in will be the one nobody tested.
//
// OWNERSHIP IS A WHERE CLAUSE, NOT A POST-FETCH CHECK. `ownershipFilter` below
// returns a Drizzle predicate rather than a boolean about an already-loaded row.
// That is deliberate: fetching first and comparing after means the handler holds
// another instructor's class in memory and depends on remembering to check. As a
// WHERE clause, the wrong instructor simply gets no row, and "no row" is
// already the 404 path every handler has.
// =============================================================================

import { eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { liveClasses } from "@/db/schema.live-classes";
import type { AuthUser } from "@/lib/guard";

/** The four lifecycle states of `live_classes.status`. */
export type ClassStatus = "scheduled" | "active" | "ended" | "cancelled";

/**
 * Must this user's writes be restricted to classes they own?
 *
 * Admins: no. An admin covering for an absent instructor should not need a role
 * change to end a session that is still running with students in it. That is an
 * operational reality, not a loosening — and it is expressed here once so that
 * every handler agrees on it.
 *
 * Instructors: yes. `ROLES_SATISFYING.instructor` admits every instructor
 * equally, so without this clause instructor B can start, end, edit and delete
 * instructor A's classes. The role check answers "is this a teacher"; this
 * answers "is this THEIR class", and the two are different questions.
 */
export function mustOwn(role: AuthUser["role"]): boolean {
  return role !== "admin";
}

/**
 * The ownership predicate to AND into a class-scoped write.
 *
 * @returns a predicate for an instructor, `undefined` for an admin — which is
 *          Drizzle's "no additional constraint" value, so callers can spread it
 *          into `and(...)` without branching
 */
export function ownershipFilter(user: AuthUser): SQL | undefined {
  return mustOwn(user.role) ? eq(liveClasses.instructorId, user.id) : undefined;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Outcome of a requested lifecycle transition.
 *
 * `already` is separated from `ok` and from `refused` because the three need
 * different HTTP answers and a boolean cannot carry that: starting an
 * already-started class is a SUCCESS (200, idempotent), starting an ended one is
 * a CONFLICT (409), and starting a cancelled one is also a conflict but for a
 * reason the operator needs to read.
 */
export type Transition =
  | { kind: "ok" }
  | { kind: "already" }
  | { kind: "refused"; reason: string };

/**
 * May this class be started?
 *
 * IDEMPOTENT. A second POST to /start on an active class returns `already` and
 * the handler answers 200 with the current state. The instructor's browser
 * retrying on a flaky connection must not produce an error page over a class
 * that is, in fact, running — and must not restamp `started_at`, which would
 * silently shorten every attendance duration computed from it.
 */
export function canStart(status: ClassStatus): Transition {
  switch (status) {
    case "scheduled":
      return { kind: "ok" };
    case "active":
      return { kind: "already" };
    case "ended":
      return { kind: "refused", reason: "This class has already ended." };
    case "cancelled":
      return { kind: "refused", reason: "This class was cancelled." };
  }
}

/**
 * May this class be ended?
 *
 * A `scheduled` class cannot be ended: `live_classes_ends_after_starts` CHECKs
 * `ended_at > started_at`, and a class that never started has a null
 * `started_at`. The CHECK would pass (nulls are exempt) and leave a row that
 * ended without ever starting, which no attendance report can interpret.
 * Cancelling is the operation for a class that will not happen.
 */
export function canEnd(status: ClassStatus): Transition {
  switch (status) {
    case "active":
      return { kind: "ok" };
    case "ended":
      return { kind: "already" };
    case "scheduled":
      return {
        kind: "refused",
        reason: "This class has not started. Cancel it instead of ending it.",
      };
    case "cancelled":
      return { kind: "refused", reason: "This class was cancelled." };
  }
}

/**
 * May a student join?
 *
 * `scheduled` is allowed as well as `active`, deliberately: students arrive
 * before the instructor presses start, and locking the room until then produces
 * a class where everyone is refused at the advertised time. The gate on a
 * session that must NOT be entered is `ended` / `cancelled`, which is a fact
 * about the class rather than a comparison against the clock — a session that
 * runs long must not lock out its own students, which is exactly why
 * `live_classes.status` exists instead of a `scheduled_at + duration` window.
 */
export function canJoin(status: ClassStatus): Transition {
  switch (status) {
    case "scheduled":
    case "active":
      return { kind: "ok" };
    case "ended":
      return { kind: "refused", reason: "This class has ended." };
    case "cancelled":
      return { kind: "refused", reason: "This class was cancelled." };
  }
}

// ---------------------------------------------------------------------------
// Attendance arithmetic
// ---------------------------------------------------------------------------

/**
 * Whole minutes between two instants, floored at zero.
 *
 * MINUTES because `class_attendance.time_present_minutes` is minutes and metric
 * units are the house rule. FLOORED rather than rounded: a student who was
 * present for 59 seconds was present for zero minutes, and rounding up would let
 * a join-then-immediately-leave count as attendance.
 *
 * The floor at zero exists because the two timestamps come from two different
 * requests. A clock that steps backwards between them would otherwise produce a
 * negative that `class_attendance_time_present_non_negative` rejects, aborting
 * a leave the student cannot retry.
 */
export function minutesBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 60_000);
}

/** Inputs to the participation score. All non-negative. */
export interface ParticipationInputs {
  /** Accumulated presence, minutes. */
  timePresentMinutes: number;
  /** The class's planned length, minutes. Used as the presence denominator. */
  durationMinutes: number;
  messagesSent: number;
  questionsAsked: number;
}

/**
 * A 0-100 participation score, reproducible from the stored counters.
 *
 * THE WEIGHTS ARE A PRODUCT DECISION AND ARE STATED, not tuned in silence:
 *   60 points  presence, as a fraction of the class's planned length
 *   25 points  chat, saturating at 10 messages
 *   15 points  questions asked, saturating at 3
 *
 * Presence dominates because it is the one signal that cannot be gamed by
 * typing. The other two SATURATE rather than scaling linearly, because an
 * unbounded chat term rewards flooding the transcript, which is the opposite of
 * participation. A student who is present throughout and says nothing scores
 * 60, which is the intended floor for "attended".
 *
 * `durationMinutes <= 0` cannot happen (`live_classes_duration_positive`) but is
 * handled anyway: a division by zero here would write NaN into an integer column
 * and fail the whole leave transaction.
 */
export function participationScore(input: ParticipationInputs): number {
  const presenceFraction =
    input.durationMinutes > 0
      ? Math.min(1, Math.max(0, input.timePresentMinutes) / input.durationMinutes)
      : 0;

  const chatFraction = Math.min(1, Math.max(0, input.messagesSent) / 10);
  const qaFraction = Math.min(1, Math.max(0, input.questionsAsked) / 3);

  const raw = presenceFraction * 60 + chatFraction * 25 + qaFraction * 15;

  // Rounded and clamped: the column is an integer CHECKed 0..100, and a value
  // outside that range aborts the transaction that carries it.
  return Math.max(0, Math.min(100, Math.round(raw)));
}
