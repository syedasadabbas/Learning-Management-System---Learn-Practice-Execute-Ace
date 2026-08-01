// =============================================================================
// POSTGRES ERROR CLASSIFICATION + DENORMALIZED COUNTER MAINTENANCE.
// Owner: the API stream.
// -----------------------------------------------------------------------------
// PART 1 — WHY A CONSTRAINT VIOLATION IS NOT A 500.
//
// Several tables in this wave carry UNIQUE constraints that exist precisely so
// a concurrent write FAILS rather than producing a wrong row:
// UNIQUE(assignment_id, sample_order), UNIQUE(lecture_id, problem_order),
// UNIQUE(class_id, student_id), UNIQUE(presentation_id, slide_number),
// UNIQUE(assignment_id, student_id).
//
// The whole point of choosing a constraint over a read-then-write check is that
// the constraint has no race. That only pays off if the caller is told what
// happened: a 500 says "we broke", a 409 says "somebody took position 3, pick
// another". Classifying the driver error is therefore part of the design, not
// error-handling boilerplate.
//
// The codes are the SQLSTATE values from the Postgres manual, matched on the
// `code` property `pg` puts on its errors. Matching on the message text would
// break the first time a server runs in a different locale.
//
// PART 2 — THE COUNTERS.
//
// `lectures.visualizations_count`, `lectures.practice_problems_count`,
// `assignments.samples_count`, `live_classes.attendance_count`,
// `presentations.view_count` and `presentations.presentation_count` are
// denormalized and have NO database trigger. Maintaining them is the write
// handler's job, and it must happen INSIDE the same transaction as the row that
// changes them — otherwise a failure between the two leaves a count that
// disagrees with reality permanently, with no process that would ever notice.
//
// THEY ARE DISPLAY HINTS. Every helper below is written as a relative
// `count + 1` / `greatest(count - 1, 0)` rather than a recount, and nothing in
// this codebase reads them to make a decision. The `greatest(...)` floor is not
// paranoia: the CHECK constraints on these columns are `>= 0`, so a double-fired
// decrement would otherwise abort the transaction that carried it — turning a
// cosmetic drift into a failed delete.
// =============================================================================

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = "23505";
/** SQLSTATE 23503 — foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = "23503";
/** SQLSTATE 23514 — check_violation. */
const CHECK_VIOLATION = "23514";

/** The shape `pg` errors actually have. Narrowed rather than cast. */
function sqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** The constraint name Postgres reported, when it reported one. */
export function constraintName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { constraint?: unknown }).constraint;
  return typeof name === "string" ? name : null;
}

/** A UNIQUE index rejected the write. The caller answers 409. */
export function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === UNIQUE_VIOLATION;
}

/**
 * A foreign key rejected the write — the parent row named in the payload does
 * not exist. The caller answers 404 (the parent) or 422 (the field), never 500.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return sqlState(error) === FOREIGN_KEY_VIOLATION;
}

/**
 * A CHECK rejected the write. This is a 422: the database caught a rule the
 * request layer's zod schema should also have caught, and the request is
 * genuinely invalid rather than the server being broken. When one of these
 * appears in a log it means a validation schema and a CHECK have drifted.
 */
export function isCheckViolation(error: unknown): boolean {
  return sqlState(error) === CHECK_VIOLATION;
}

/**
 * Map a driver error to an HTTP status, or null when it is not a constraint
 * violation and should therefore propagate as a 500.
 */
export function statusForDbError(error: unknown): number | null {
  if (isUniqueViolation(error)) return 409;
  if (isForeignKeyViolation(error)) return 422;
  if (isCheckViolation(error)) return 422;
  return null;
}

// ---------------------------------------------------------------------------
// Counter expressions
// ---------------------------------------------------------------------------

/**
 * `column + 1`, as a SQL fragment for a `set()` clause.
 *
 * A fragment rather than a read-modify-write in TypeScript, because two
 * concurrent handlers reading 4 and both writing 5 is the standard way a
 * denormalized counter loses an increment. `column + 1` is evaluated by
 * Postgres against the row it holds a lock on.
 */
export function increment(column: SQL | unknown, by = 1): SQL<number> {
  return sql`${column} + ${by}`;
}

/**
 * `greatest(column - 1, 0)`.
 *
 * Floored at zero for the reason in the module header: these columns carry
 * `>= 0` CHECKs, and a decrement that would go negative must degrade to a wrong
 * display number rather than abort the DELETE it is riding along with. A count
 * that reads 0 when the truth is 0 is also, usefully, correct.
 */
export function decrement(column: SQL | unknown, by = 1): SQL<number> {
  return sql`greatest(${column} - ${by}, 0)`;
}
