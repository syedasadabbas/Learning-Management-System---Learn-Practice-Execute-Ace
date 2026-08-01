// =============================================================================
// ATTEMPT STATE MACHINE — invariant I3, as pure functions.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream.
//
// I3 (submission is idempotent and terminal) has two halves. The half that needs
// a database is the `SELECT ... FOR UPDATE` inside the submit transaction, which
// lives in ./queries.ts. The half that needs no database is the DECISION — "may
// this write happen at all?" — and it lives here so it can be tested without one
// and so both the autosave path and the submit path consult the same rule.
//
// `attempt_status` is `in_progress | submitted | graded`. Both of the last two
// are terminal for writing purposes. They are NOT interchangeable for reading:
//
//   submitted — scored, but at least one item is awaiting a human or a re-run.
//               The total shown is PROVISIONAL (invariant I6).
//   graded    — every item was auto-graded; the total is final.
//
// That distinction is the only place the deferred/provisional state is persisted,
// because the schema is frozen and `answers` has no `deferred` column. See
// `deferredCandidateCount` in ./grading.ts for the consequence and its bounds.
// =============================================================================

import { isExpired } from "./timing";

/** The three values of the `attempt_status` enum, as a value for exhaustive code. */
export const ATTEMPT_STATUSES = ["in_progress", "submitted", "graded"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Statuses after which no answer may be inserted or updated, and a repeat submit
 * returns the existing result instead of scoring again.
 */
export const TERMINAL_STATUSES: readonly AttemptStatus[] = ["submitted", "graded"];

/**
 * Is this attempt closed?
 *
 * Takes a plain `string` rather than `AttemptStatus` on purpose: the value comes
 * from a database row, and an unrecognised status must be treated as terminal
 * (fail closed) rather than as writable. A status this code does not understand
 * is not a licence to keep writing answers into it.
 */
export function isTerminal(status: string): boolean {
  if (status === "in_progress") return false;
  return true;
}

/**
 * The status to store for a freshly finalized attempt. Invariant I6's persistence.
 *
 * The return type is the two TERMINAL statuses, not `AttemptStatus`: a finalized
 * attempt can never be `in_progress`, and typing it that way would let a caller
 * pass this straight into a column update that must be terminal.
 */
export function statusForFinalized(deferredCount: number): "submitted" | "graded" {
  return deferredCount > 0 ? "submitted" : "graded";
}

/** True when a stored attempt's total may still rise. Never lets it fall (I5). */
export function isProvisionalStatus(status: string): boolean {
  return status === "submitted";
}

// ---------------------------------------------------------------------------
// Autosave admission
// ---------------------------------------------------------------------------

export type AutosaveRefusal =
  /** The attempt is submitted or graded. I3: no write may follow. */
  | "attempt_terminal"
  /** The clock ran out. The answer is not stored; expiry finalizes the attempt. */
  | "attempt_expired";

export type AutosaveDecision =
  | { accept: true }
  | { accept: false; code: AutosaveRefusal; error: string };

/**
 * May this autosave be written?
 *
 * Order matters. Terminal is checked FIRST so that a request arriving after a
 * submit is reported as "already submitted" rather than as "out of time" —
 * they are different facts and the student is owed the accurate one.
 *
 * `now` is the SERVER's instant and `deadlineAt` the stored one (I2). No
 * parameter here can be supplied by a client: the route handler reads the
 * attempt from the database and calls `new Date()` itself.
 */
export function autosaveDecision(params: {
  status: string;
  deadlineAt: Date | null | undefined;
  now: Date;
}): AutosaveDecision {
  const { status, deadlineAt, now } = params;

  if (isTerminal(status)) {
    return {
      accept: false,
      code: "attempt_terminal",
      error: "This exam has already been submitted. No further answers can be saved.",
    };
  }
  // Reuses ./timing rather than restating `now >= deadline`: the boundary rule
  // has exactly one definition, so it cannot drift between autosave and submit.
  if (isExpired(deadlineAt, now)) {
    return {
      accept: false,
      code: "attempt_expired",
      error: "Your time for this exam has run out, so this answer was not saved.",
    };
  }
  return { accept: true };
}
