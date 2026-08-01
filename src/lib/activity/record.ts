// =============================================================================
// WRITING AN AUDIT ROW. Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// THE CENTRAL DECISION OF THIS FEATURE: WHAT HAPPENS WHEN THE AUDIT WRITE FAILS?
//
// It has to be a decision, not an accident of where the try/catch landed. This
// file answers it twice, differently, and says which answer applies where.
//
// -----------------------------------------------------------------------------
// ANSWER 1 — `recordActivity`: FAIL CLOSED. The act does not succeed.
//
// `recordActivity` takes a database client. When the caller passes the `tx` from
// its own `db.transaction()`, the audit row is INSERTed on that transaction, so:
//
//     the act commits  <=>  its audit row commits
//
// Not "usually", not "unless something went wrong" — the same commit. If the
// INSERT throws, the exception propagates, the transaction rolls back, and the
// student gets an error instead of a graded quiz. And that is the intended
// behaviour for every action marked `significance: "critical"` in
// src/lib/activity/actions.ts.
//
// WHY FAIL CLOSED, when the more common instinct is "never let logging break the
// app". Because for this table the instinct is answering the wrong question. The
// premise of an audit trail is that the record and the act are the same event; a
// system that performs graded, irreversible, disputable acts while its trail is
// broken is not "degraded", it is producing exactly the state an audit exists to
// rule out — outcomes nobody can account for. Concretely, if the write fails and
// the grade change lands anyway:
//
//   * the student's appeal is decided on data with an unexplained gap, and nobody
//     can tell a missing row from an act that never happened;
//   * whatever caused the failure (a dead pool, a full disk, a dropped Neon
//     connection) is invisible, because the one signal it produced was swallowed;
//   * and the failure is silent precisely when it matters most, since a broad
//     outage means MANY missing rows, not one.
//
// The cost is real and is accepted with open eyes: a database problem that would
// otherwise have degraded the app now stops the affected writes outright. That is
// tolerable here for a specific structural reason — the audit INSERT runs on the
// SAME connection and inside the SAME transaction as the act it describes, so it
// introduces no new dependency that could fail on its own. If the audit INSERT
// cannot execute, the act's own statements could not have executed either. This
// is not "one more thing that can break"; it is one more statement in a unit of
// work that already had to succeed or fail as a whole.
//
// The trade would be much worse if the sink were elsewhere (a log service, a
// second database, a queue). Then failing closed WOULD couple availability to an
// unrelated system, and the answer would have to be different. It is one INSERT
// on one connection, which is why fail-closed is affordable.
//
// -----------------------------------------------------------------------------
// ANSWER 2 — `recordActivityDetached`: FAIL OPEN, and say so out loud.
//
// For `significance: "routine"` actions — `code_execute` most of all, which a live
// editor can fire many times a minute — a lost row costs nothing and blocking the
// act would be absurd. This function swallows the error, counts it, and never
// throws. Its loss mode is stated in its docstring and it refuses to be used for a
// critical action AT RUNTIME, not merely by convention: passing one throws, so the
// cheap path cannot be reached for the events that need the expensive one.
//
// -----------------------------------------------------------------------------
// WHY NOT THE QUEUE (src/lib/queue/**), which exists and has retries.
//
// Considered, and rejected for the critical path. `enqueueJob` is itself one
// INSERT on the same pool (src/lib/queue/store.ts:163), so queueing does not avoid
// the database — it performs the same round trip (~245 ms warm, measured in
// src/db/index.ts:63) and then ADDS failure modes:
//
//   * a job that exhausts its attempts becomes `status = 'dead'`. An audit entry
//     that can be dead-lettered is not an audit entry; it is a hope.
//   * the queue is drained by cron and by a best-effort in-request scheduler
//     (src/lib/queue/schedule.ts), so the row would appear seconds-to-minutes after
//     the act, out of order relative to other rows, from a different clock.
//   * the payload would have to carry the actor, the entity and the details
//     through a jsonb column, which is a second copy of the same data in a table
//     that is NOT subject to this stream's redaction rules.
//
// The queue is the right tool for an effect that must survive a failure and can
// tolerate delay (its actual job: email). An audit row must be simultaneous with
// its act, which is the opposite requirement.
//
// AND NOT AN IN-MEMORY BUFFER. FREE_STACK's target is Vercel serverless: there is
// no long-lived process, so a buffer flushed on a timer loses whatever it holds
// when the invocation is recycled — silently, which is the one property this table
// may not have.
//
// -----------------------------------------------------------------------------
// FORGERY. `actorId` and `actorRole` are taken from the caller's arguments, and the
// callers are server-side guards (`apiGuard` / `requireRole` in src/lib/guard.ts),
// never from a request body or a client-supplied header. There is no route in this
// stream that writes an arbitrary activity row: the admin API is read-only plus a
// prune, and `POST` of a hand-made log entry does not exist. A client therefore
// cannot author a row at all, which is a stronger property than validating one.
//
// The residual: anything running with the app's database credentials can INSERT or
// DELETE directly, and no application-level design changes that. Tamper-evidence
// against a compromised database (hash chaining, an append-only replica, shipping
// rows off-box) is deliberately out of scope and recorded as such in
// docs/ACTIVITY_LOGS.md rather than half-built.
//
// Durations are milliseconds throughout (house rule: metric units).
// =============================================================================

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { activityLogs, type ActivityLog } from "@/db/schema.activity";

import { actionSignificance, type ActivityActionName } from "./actions";
import {
  clientFamily as toClientFamily,
  coarsenIp,
  errorCode as toErrorCode,
  sanitiseDetails,
  type DetailsInput,
} from "./redact";

/**
 * A database client: the pool, or a transaction handle. Same shape and same
 * reason as `Db` in src/lib/queue/store.ts:72 — passing a `tx` is what makes the
 * audit row atomic with the act.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ActivityDb = typeof db | Tx;

/** The raw network origin and client hints, before redaction. */
export interface ActivityOrigin {
  /** `x-forwarded-for` or equivalent. Coarsened to a /24 or /48 before storage. */
  ip?: string | null;
  /** `user-agent`. Reduced to a coarse family before storage. */
  userAgent?: string | null;
  /** `x-vercel-id` or equivalent request correlation handle. */
  correlationId?: string | null;
}

export interface ActivityEntry {
  action: ActivityActionName;
  /** Null for an act with no established identity (a failed login, a cron run). */
  actorId?: number | null;
  /** The actor's role AT THE TIME. Snapshotted because users.role is mutable. */
  actorRole?: string | null;
  status?: "success" | "failure";
  entityType?: string | null;
  entityId?: number | null;
  /** Named, flat context. Passed through sanitiseDetails; see redact.ts. */
  details?: DetailsInput | null;
  /** A short code on failure. Never a message or a stack. */
  errorCode?: string | null;
  /**
   * Makes recording idempotent: a second write with the same key is rejected by
   * the partial unique index and reported as `duplicate`, not as an error. Use it
   * wherever an act can legitimately be retried (see the exam_submit note in
   * hook-points.ts).
   */
  dedupeKey?: string | null;
  origin?: ActivityOrigin | null;
}

export type RecordResult =
  | { ok: true; id: number; duplicate: false }
  | { ok: true; id: null; duplicate: true };

function toRow(entry: ActivityEntry) {
  const origin = entry.origin ?? {};
  return {
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    status: entry.status ?? "success",
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    ipPrefix: coarsenIp(origin.ip),
    clientFamily: toClientFamily(origin.userAgent),
    correlationId: origin.correlationId ? origin.correlationId.slice(0, 64) : null,
    details: sanitiseDetails(entry.details),
    errorCode: toErrorCode(entry.errorCode),
    dedupeKey: entry.dedupeKey ? entry.dedupeKey.slice(0, 200) : null,
    // `occurredAt` is deliberately NOT set: the column's defaultNow() means the
    // database's clock decides, so rows written by serverless instances with
    // different clock skew are still totally ordered against each other.
  } satisfies Omit<typeof activityLogs.$inferInsert, "id" | "occurredAt">;
}

/**
 * Record an act. THROWS if the row cannot be written.
 *
 * Pass the transaction that performs the act as `client` and the row commits with
 * it or not at all — which is the entire point, and the reason the signature takes
 * a client instead of reaching for the global `db`.
 *
 * @param entry  what happened. Every field is redacted on the way in; see redact.ts.
 * @param client the pool (default) or a transaction handle from `db.transaction`.
 * @returns the new row id, or `{ duplicate: true }` when `dedupeKey` was already
 *          recorded — a duplicate is a SUCCESS, because it means the act is already
 *          on the record.
 * @throws whatever the driver throws. Callers inside a transaction should NOT
 *         catch it: propagating is what rolls the act back. See this file's header
 *         for why that is the intended behaviour.
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   await tx.update(submissions).set({ stars }).where(eq(submissions.id, id));
 *   await recordActivity(
 *     { action: "submission_graded", actorId: user.id, actorRole: user.role,
 *       entityType: "submission", entityId: id, details: { stars, previousStars } },
 *     tx,
 *   );
 * });
 * ```
 */
export async function recordActivity(
  entry: ActivityEntry,
  client: ActivityDb = db,
): Promise<RecordResult> {
  const rows = await client
    .insert(activityLogs)
    .values(toRow(entry))
    // ON CONFLICT DO NOTHING, not an error: the partial unique index on
    // `dedupe_key` exists so a legitimately retried act does not produce a second
    // row claiming it happened twice. Same pattern, and the same reasoning, as
    // `mail_dispatches` in src/db/schema.queue.ts:35-47 — the database settles the
    // race, not the caller's memory of what it already did.
    //
    // THE `where` IS NOT OPTIONAL AND ITS ABSENCE IS NOT A STYLE POINT. Postgres
    // infers which unique index an ON CONFLICT target refers to, and a PARTIAL
    // index is only inferable when the statement repeats its predicate. Without
    // this clause every insert fails with
    //
    //     42P10: there is no unique or exclusion constraint matching the
    //            ON CONFLICT specification
    //
    // — i.e. not "duplicates slip through" but "nothing can be logged at all".
    // Found by running the real DDL and this statement against Postgres
    // (scripts/tmp-activity-probe.ts, since deleted); no amount of typechecking
    // catches it, because the types are identical either way.
    .onConflictDoNothing({
      target: activityLogs.dedupeKey,
      where: sql`${activityLogs.dedupeKey} is not null`,
    })
    .returning({ id: activityLogs.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    // No row came back and no error was raised: the dedupe key was already
    // present. The act is on the record, so this is a success.
    return { ok: true, id: null, duplicate: true };
  }
  return { ok: true, id, duplicate: false };
}

/** Counters for the detached path, so its losses are visible rather than assumed. */
const detachedFailures = { count: 0, lastError: null as string | null };

/**
 * Record a ROUTINE act without letting a failure affect the caller.
 *
 * LOSS MODE, STATED: if the INSERT fails, the entry is GONE. Nothing retries it,
 * nothing buffers it, and the caller is not told. That is acceptable only for the
 * high-volume, low-consequence actions marked `significance: "routine"` in
 * src/lib/activity/actions.ts — `code_execute` above all, which a live editor can
 * fire many times a minute and whose individual rows nobody will ever read.
 *
 * REFUSES A CRITICAL ACTION AT RUNTIME. Not a comment asking callers to be
 * careful: passing an action whose significance is "critical" throws immediately,
 * so the cheap path is unreachable for the events that need the expensive one, and
 * the mistake surfaces in the first test that exercises the call site rather than
 * as a quiet gap in production.
 *
 * @throws only for misuse (a critical action). Never for a database failure.
 */
export function recordActivityDetached(entry: ActivityEntry, client: ActivityDb = db): void {
  if (actionSignificance(entry.action) === "critical") {
    throw new Error(
      `recordActivityDetached refuses "${entry.action}": it is a critical action, ` +
        "and a critical action must not be recorded on a path that can silently " +
        "drop it. Use recordActivity and let the failure propagate.",
    );
  }

  void recordActivity(entry, client).catch((error: unknown) => {
    detachedFailures.count += 1;
    detachedFailures.lastError = error instanceof Error ? error.message : String(error);
    // Deliberately console.warn and not a rethrow: an unhandled rejection would
    // terminate the Node process, which is a far worse outcome than a lost
    // `code_execute` row. Same fire-and-forget-with-a-mandatory-catch shape as the
    // pool pre-warm in src/db/index.ts:143-149.
    console.warn(
      `[activity] dropped a detached "${entry.action}" entry (${detachedFailures.count} so far):`,
      detachedFailures.lastError,
    );
  });
}

/**
 * How many detached entries this instance has lost, for an operator.
 *
 * Per-instance and reset by every cold start — which is a real limitation, not an
 * oversight: a serverless platform has nowhere durable to keep such a counter
 * except this table, and writing to the table to report that writing to the table
 * failed is circular. It is a debugging aid for one live instance, and the reason
 * the critical path does not rely on counters at all.
 */
export function detachedFailureCount(): { count: number; lastError: string | null } {
  return { ...detachedFailures };
}

/** The row type the query layer returns. Re-exported for convenience. */
export type { ActivityLog };
