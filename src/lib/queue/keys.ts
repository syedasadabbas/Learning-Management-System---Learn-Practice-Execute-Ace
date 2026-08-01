// =============================================================================
// IDEMPOTENCY KEYS — pure. No database, no hashing, no clock.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// THIS FILE IS ONE HALF OF THE IDEMPOTENCY GUARANTEE. The other half is the
// UNIQUE INDEX `jobs_idempotency_key_idx` in src/db/schema.ts. Neither is
// sufficient alone, and the split matters:
//
//   - This file decides WHAT "the same job" means. That is a product decision
//     ("one graded-notification per submission per grading round"), and getting
//     it wrong produces either duplicate emails or silently suppressed ones.
//   - The unique index decides WHO WINS when two requests race. That is not an
//     application decision and must not be one.
//
// WHY NOT A SELECT-THEN-INSERT CHECK. Because it does not work. Two instructors
// clicking Save at the same instant — or, far more likely, ONE instructor whose
// double-click fires two requests that Vercel routes to two different function
// instances — both run `SELECT ... WHERE idempotency_key = $1`, both find
// nothing (neither has committed), and both INSERT. Postgres READ COMMITTED does
// not prevent this; nothing at the application layer does. The unique index is
// what turns the second INSERT into a 23505 that `ON CONFLICT DO NOTHING`
// absorbs, and it is the reason `enqueueJob` in ./store.ts reports
// `created: false` rather than pretending both callers created a job.
//
// WHY THE KEY EMBEDS THE KIND. The index is on ONE column, because
// `ON CONFLICT (idempotency_key) DO NOTHING` needs a single-column unique
// constraint to name as its arbiter. Two different kinds must therefore not be
// able to mint the same string, so the kind is a mandatory prefix built here
// rather than left to each caller to remember.
//
// WHY THERE IS NO HASHING. An obvious way to keep keys short is to hash a long
// scope. It is rejected: a hash collision here does not corrupt data, it
// SILENTLY DROPS A JOB — the second enqueue looks like a duplicate and is
// discarded, and nobody ever finds out. Keys are built from small integer ids,
// so `buildIdempotencyKey` simply REFUSES a key that would not fit and throws at
// the producer, where the mistake is visible, instead of hashing the problem
// away. See KEY_MAX_CHARS.
// =============================================================================

import type { JobKind } from "./types";

/**
 * Must equal the `varchar` length of `jobs.idempotency_key` in
 * src/db/schema.ts. A key longer than the column would be truncated or rejected
 * by the driver at INSERT time — inside a request path — rather than caught
 * here where the message can say which producer is at fault.
 */
export const KEY_MAX_CHARS = 200;

/** Separator between the kind and each scope segment. */
export const KEY_SEPARATOR = ":";

/**
 * Characters a scope segment may contain.
 *
 * Restricted on purpose. The keys this app builds are ids and short slugs, and
 * a permissive charset invites a caller to interpolate something like a student
 * name — which changes when it is edited, producing a DIFFERENT key for the
 * same logical job and therefore a duplicate send. Refusing the input is the
 * cheapest way to keep keys derived from stable identifiers only.
 *
 * The separator itself is excluded, so a segment can never forge an extra
 * boundary and collide with a differently-shaped key.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9_.@-]+$/;

/** Thrown by `buildIdempotencyKey`. A producer bug, never a runtime condition. */
export class IdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyKeyError";
  }
}

/**
 * Build the globally unique key identifying one logical unit of work.
 *
 * @param kind    the job kind; becomes the mandatory first segment.
 * @param scope   the segments that identify THIS unit of work within the kind.
 *
 * Throws `IdempotencyKeyError` rather than returning a fallback, because every
 * fallback is worse: a generated-unique key means the duplicate suppression
 * quietly stops working, and an empty key means every job of that kind collides
 * and only the first is ever enqueued.
 */
export function buildIdempotencyKey(
  kind: JobKind,
  scope: ReadonlyArray<string | number>,
): string {
  if (scope.length === 0) {
    throw new IdempotencyKeyError(
      `buildIdempotencyKey(${kind}): the scope is empty, so every job of this ` +
        `kind would share one key and only the first would ever be enqueued.`,
    );
  }

  const segments = scope.map((raw, index) => {
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) {
        throw new IdempotencyKeyError(
          `buildIdempotencyKey(${kind}): scope segment ${index} is ${raw}, which is ` +
            `not a usable identifier.`,
        );
      }
      // Integers only. A float id is always a bug, and `1.0` vs `1` would
      // stringify to two different keys for the same row.
      if (!Number.isInteger(raw)) {
        throw new IdempotencyKeyError(
          `buildIdempotencyKey(${kind}): scope segment ${index} is ${raw}; ids must ` +
            `be integers or the same row can produce two different keys.`,
        );
      }
      return String(raw);
    }

    const trimmed = raw.trim();
    if (!SEGMENT_PATTERN.test(trimmed)) {
      throw new IdempotencyKeyError(
        `buildIdempotencyKey(${kind}): scope segment ${index} (${JSON.stringify(raw)}) ` +
          `is empty or contains characters outside [A-Za-z0-9_.@-]. Keys must be built ` +
          `from stable identifiers, not from editable text.`,
      );
    }
    return trimmed;
  });

  const key = [kind, ...segments].join(KEY_SEPARATOR);

  if (key.length > KEY_MAX_CHARS) {
    throw new IdempotencyKeyError(
      `buildIdempotencyKey(${kind}): the key is ${key.length} characters, over the ` +
        `${KEY_MAX_CHARS}-character column limit. Shorten the scope — do NOT hash it: ` +
        `a hash collision silently discards a job instead of duplicating one.`,
    );
  }

  return key;
}

// ---------------------------------------------------------------------------
// The keys this app actually mints
// ---------------------------------------------------------------------------

/**
 * "The student has been told about grade N of submission S."
 *
 * THE `gradedAtMs` SEGMENT IS THE WHOLE DESIGN DECISION, so it is argued rather
 * than stated. The two obvious alternatives both fail:
 *
 *   - Key on the submission alone (`submission_graded_email:S`). One email per
 *     submission, ever. An instructor who grades, then notices they meant 4
 *     stars and regrades, leaves the student holding a notification about a
 *     grade that no longer exists, with no second mail coming. Silent, and the
 *     student is the one who finds out.
 *
 *   - Add a timestamp taken at ENQUEUE time (`Date.now()`). Then every enqueue
 *     is unique, the unique index never fires, and the queue has no idempotency
 *     at all — which is the failure this item is about.
 *
 * The key is therefore scoped to the submission plus `submissions.graded_at`,
 * which is written inside the grading transaction (src/lib/submissions/grade.ts,
 * `gradedAt: new Date()` in the UPDATE). Consequences, both intended:
 *   - a double-clicked Save produces ONE grading transaction and therefore one
 *     `graded_at`, so the second enqueue collides and is discarded by Postgres;
 *   - a genuine REGRADE writes a new `graded_at`, so it correctly produces a
 *     second notification.
 *
 * Millisecond precision matches `timestamp with time zone` closely enough for
 * this purpose: two distinct grading transactions on the same submission within
 * the same millisecond would share a key, and the second mail would be dropped.
 * That is an acceptable loss — it can only happen when a regrade is
 * indistinguishable in time from the grade it replaces, in which case the
 * student would receive two identical emails.
 *
 * Postgres stores microseconds, so `graded_at` read back may carry sub-millisecond
 * precision that `Date` does not; the key is built from the JS `Date` the driver
 * hands back, consistently, on both the produce and any re-derive path.
 */
export function gradedNotificationKey(input: {
  submissionId: number;
  gradedAtMs: number;
}): string {
  return buildIdempotencyKey("submission_graded_email", [
    input.submissionId,
    Math.trunc(input.gradedAtMs),
  ]);
}
