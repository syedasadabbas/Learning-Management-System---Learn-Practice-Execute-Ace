// =============================================================================
// GRAND-QUIZ TIMING — invariant I2, as pure functions.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream.
//
// I2 (expiry is server-authoritative) says `quiz_attempts.deadline_at` is
// computed on the server at start as `started_at + time_limit_minutes`, stored,
// and never updated; every later decision compares the SERVER's now() against
// that stored value.
//
// This file is where that arithmetic lives, and it is deliberately pure so that
// the skewed-clock case can be tested without a database, a browser or a clock
// change. Nothing here reads `Date.now()` implicitly — every function takes the
// instant it should reason about, which is what makes "a laptop 40 minutes slow"
// untestable-by-accident rather than a live defect.
//
// THE CLIENT NEVER SUPPLIES A TIME. There is no function here that accepts a
// client-reported "remainingMs" and there must never be one: the browser
// countdown is seeded from `countdownSeed()` below and its value is never read
// back into a decision. A forged countdown changes what a student SEES, which is
// their problem; it cannot change what is SCORED.
//
// Units: milliseconds everywhere (house rule 5). Minutes appear only where the
// schema stores minutes (`quizzes.time_limit_minutes`).
// =============================================================================

/** One minute in milliseconds. Named so the conversion is never an inline 60000. */
export const MS_PER_MINUTE = 60_000;

/**
 * The exam's nominal length, in minutes.
 *
 * A grand quiz is defined by `docs/GRAND_QUIZ_INVARIANTS.md` as
 * `attempts_allowed = 1` and `time_limit_minutes = 120`. This constant is the
 * FALLBACK used when a `grand` row was authored without a limit — not an
 * override. `quizzes.time_limit_minutes` wins whenever it is set, because an
 * admin who shortens an exam must not be silently overruled by a literal here.
 */
export const GRAND_QUIZ_DEFAULT_MINUTES = 120;

/**
 * The effective time limit for a grand quiz, in minutes.
 *
 * A null or non-positive stored limit means the row was authored incompletely.
 * Falling back to the documented 120 is the safe direction: the alternative —
 * treating it as "untimed" — would hand one student an unlimited exam.
 */
export function effectiveTimeLimitMinutes(stored: number | null | undefined): number {
  if (stored == null) return GRAND_QUIZ_DEFAULT_MINUTES;
  if (!Number.isFinite(stored) || stored <= 0) return GRAND_QUIZ_DEFAULT_MINUTES;
  return Math.floor(stored);
}

/**
 * The deadline to STORE at start: `startedAt + timeLimitMinutes`.
 *
 * Computed from the server's own `startedAt` — the same instant written to
 * `quiz_attempts.started_at`, passed in explicitly rather than read from a clock
 * here, so the stored pair can never disagree by the microseconds between two
 * `new Date()` calls.
 *
 * Called exactly once per attempt, at insert. `deadline_at` is never recomputed:
 * see `src/lib/grand-quiz/queries.ts`, which has no UPDATE touching that column.
 */
export function computeDeadlineAt(
  startedAt: Date,
  timeLimitMinutes: number | null | undefined,
): Date {
  const minutes = effectiveTimeLimitMinutes(timeLimitMinutes);
  return new Date(startedAt.getTime() + minutes * MS_PER_MINUTE);
}

/**
 * Has this attempt's time run out?
 *
 * `deadlineAt == null` means an untimed attempt (a practice quiz row, or a grand
 * row written before this column existed) and is NEVER expired — refusing an
 * attempt because a column is null would take marks from a student for a data
 * problem they did not cause.
 *
 * The comparison is `>=`: at the exact millisecond of the deadline the time is
 * spent. A student cannot lose a whole answer to a boundary decision either way
 * — an autosave one millisecond earlier was already accepted and stored.
 */
export function isExpired(deadlineAt: Date | null | undefined, now: Date): boolean {
  if (deadlineAt == null) return false;
  return now.getTime() >= deadlineAt.getTime();
}

/**
 * Milliseconds left, floored at 0. `Infinity` is never returned: an untimed
 * attempt reports `null` so a caller cannot accidentally render "Infinity ms".
 */
export function remainingMs(
  deadlineAt: Date | null | undefined,
  now: Date,
): number | null {
  if (deadlineAt == null) return null;
  return Math.max(0, deadlineAt.getTime() - now.getTime());
}

/** How much of the exam has elapsed, floored at 0. Used for the result view. */
export function elapsedMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

/**
 * What the browser countdown is seeded with.
 *
 * Three values, and the reason there are three rather than one:
 *
 *   * `deadlineAtMs`  the stored, authoritative instant. Sent so the UI can show
 *                     an absolute "ends at 14:37" as well as a countdown.
 *   * `serverNowMs`   the server's clock at the moment of the response. The
 *                     client subtracts its OWN clock from this once to obtain a
 *                     skew offset, so a device 40 minutes slow still renders a
 *                     correct countdown instead of 40 spare minutes.
 *   * `remainingMs`   the server's own answer, so a client that does no arithmetic
 *                     at all still starts from the truth.
 *
 * This is presentation only. Nothing derived from it is ever sent back and
 * believed — see the file header.
 */
export interface CountdownSeed {
  deadlineAtMs: number | null;
  serverNowMs: number;
  remainingMs: number | null;
  expired: boolean;
}

export function countdownSeed(
  deadlineAt: Date | null | undefined,
  now: Date,
): CountdownSeed {
  return {
    deadlineAtMs: deadlineAt ? deadlineAt.getTime() : null,
    serverNowMs: now.getTime(),
    remainingMs: remainingMs(deadlineAt, now),
    expired: isExpired(deadlineAt, now),
  };
}
