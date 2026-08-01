// =============================================================================
// RETENTION AND PRUNING — the growth story for the largest table in the database.
// Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// THE POLICY. INTEGRATION_SUMMARY.md:115 states it: "keep 90 days hot, auto-archive
// older", and IMPLEMENTATION_ROADMAP.md:756 lists "storage bloat" as this feature's
// risk with "retention policy (90 days)" as the mitigation. So 90 days is the
// default here, taken from the spec rather than invented.
//
// WHERE THE SPEC AND REALITY DISAGREE, AND WHAT THIS DOES ABOUT IT.
//
// "Auto-archive" implies cold storage. There is none: `@vercel/blob` is on the
// roadmap's proposed-dependency list, not in package.json, and FREE_STACK's whole
// premise is a stack with no object store. So a prune here DELETES; it does not
// archive. Rather than paper over that:
//
//   * `pruneActivity` refuses to run unless the caller passes
//     `confirmExported: true`, so deletion is never something a misconfigured
//     schedule does by accident;
//   * the CSV export is the archive path, and it is a real one — an operator runs
//     it before the prune and keeps the file;
//   * the prune writes an `activity_pruned` audit row recording the cutoff, the row
//     count and the id range, so the deletion itself is on the record. Deleting
//     from an audit trail must never be the one untraceable operation.
//
// A HARD FLOOR OF 30 DAYS, enforced in code. `ACTIVITY_RETENTION_DAYS=1` — a typo,
// a misread unit, a copy-pasted value — would otherwise erase almost the entire
// trail on the next scheduled run, and there is no undo. The floor makes the worst
// misconfiguration survivable.
//
// 90 DAYS IS SHORTER THAN THIS COHORT'S AUDIT HORIZON, and that is worth saying
// where an operator will read it: a cohort runs for weeks and grade appeals arrive
// after it ends, so a dispute about week 1 can easily fall outside a 90-day window.
// The recommended production value is 400 days (a full year plus 35 days of grace,
// so a year-over-year comparison is possible), set via ACTIVITY_RETENTION_DAYS. The
// default follows the spec; the recommendation is documented so that following the
// spec is a choice rather than an accident.
//
// BOUNDED BATCHES, not one big DELETE. A single `DELETE FROM activity_logs WHERE
// occurred_at < cutoff` against millions of rows holds one transaction open for
// minutes, and on Vercel the invocation is killed at a wall-clock limit — leaving
// the work rolled back and repeated forever. Deleting in bounded batches means each
// statement commits, progress is kept, and a killed invocation resumes on the next
// schedule.
//
// All units: whole DAYS for the policy (the unit the policy is written in),
// milliseconds for anything time-based in code (house rule: metric units).
// =============================================================================

import { and, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { activityLogs } from "@/db/schema.activity";

import { recordActivity, type ActivityDb } from "./record";

/** The spec's number (INTEGRATION_SUMMARY.md:115). */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * The floor. Below this, a misconfiguration destroys the trail with no undo, so the
 * value is clamped rather than trusted.
 */
export const MIN_RETENTION_DAYS = 30;

/** Recommended production value; see this file's header. */
export const RECOMMENDED_RETENTION_DAYS = 400;

/**
 * Rows removed per statement. Large enough that pruning a real backlog terminates
 * in a sensible number of invocations, small enough that no single statement holds
 * locks long or risks the platform's wall-clock limit mid-transaction.
 */
export const PRUNE_BATCH_ROWS = 5_000;

/**
 * Ceiling on one invocation's work, in milliseconds. Vercel's free-plan function
 * limit is tighter than this; stopping ourselves at 20 s leaves room for the
 * response and means the prune ends by CHOOSING to stop, with a reported partial
 * result, rather than by being killed.
 */
export const PRUNE_BUDGET_MS = 20_000;

/**
 * Retention in days, from the environment, clamped to the floor.
 *
 * Pure apart from reading `process.env`, and separated from `pruneActivity` so the
 * clamping can be unit-tested without a database — which is the part of this file
 * where a mistake is unrecoverable.
 */
export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ACTIVITY_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const trimmed = raw.trim();
  // DECIMAL DIGITS ONLY, deliberately stricter than Number(). `Number("1e3")` is
  // 1000 and `Number("0x5A")` is 90 — both are integers, so an `isInteger` check
  // alone accepts them and silently sets a retention window nobody typed. For a
  // value whose misreading permanently deletes data, "I do not recognise this"
  // beats "I found a plausible interpretation".
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    // A malformed value falls back to the DEFAULT, never to "delete everything".
    // Failing towards keeping data is the only safe direction here.
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.max(MIN_RETENTION_DAYS, parsed);
}

/** The instant before which rows are eligible for deletion. */
export function retentionCutoff(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export interface PruneOptions {
  /**
   * MUST be true. The gate that stops a schedule deleting an unarchived trail by
   * accident; see this file's header. Named for what the operator is asserting
   * (the rows are exported) rather than a generic `force`.
   */
  confirmExported: boolean;
  /** Overrides ACTIVITY_RETENTION_DAYS. Still clamped to MIN_RETENTION_DAYS. */
  days?: number;
  /** Count what WOULD be deleted and delete nothing. */
  dryRun?: boolean;
  budgetMs?: number;
  /** Actor for the `activity_pruned` row. Null for a cron run. */
  actorId?: number | null;
  actorRole?: string | null;
}

export interface PruneResult {
  cutoff: string;
  days: number;
  deleted: number;
  /** True when the budget ran out before the backlog was cleared. */
  incomplete: boolean;
  dryRun: boolean;
  /** Rows still older than the cutoff after this run (0 unless `incomplete`). */
  remaining: number;
}

/**
 * Delete rows older than the retention window, in bounded batches.
 *
 * @throws when `confirmExported` is not true. Deliberately an exception and not a
 *         quiet no-op: a schedule misconfigured to omit the flag should be loudly
 *         broken, because a prune that silently does nothing for months is
 *         indistinguishable from one that is working until the disk fills.
 */
export async function pruneActivity(
  options: PruneOptions,
  client: ActivityDb = db,
): Promise<PruneResult> {
  if (options.confirmExported !== true) {
    throw new Error(
      "pruneActivity requires confirmExported: true. There is no cold-storage " +
        "archive on this stack (see this module's header), so a prune is a " +
        "permanent deletion and the caller must assert that the window has been " +
        "exported first.",
    );
  }

  const days = Math.max(MIN_RETENTION_DAYS, options.days ?? retentionDays());
  const cutoff = retentionCutoff(days);
  const budgetMs = options.budgetMs ?? PRUNE_BUDGET_MS;
  const startedAt = Date.now();

  const remainingBefore = await countOlderThan(cutoff, client);

  if (options.dryRun) {
    return {
      cutoff: cutoff.toISOString(),
      days,
      deleted: 0,
      incomplete: remainingBefore > 0,
      dryRun: true,
      remaining: remainingBefore,
    };
  }

  // THE AUDIT ROW COMES FIRST, before anything is deleted — the same pre-write
  // ordering, for the same reason, as the mail ledger in src/db/schema.queue.ts:35:
  // if the pre-write fails nothing has happened yet, so refusing to proceed is
  // completely safe, whereas a post-write failure would leave rows deleted with no
  // record of the deletion. This is the one place in the feature where an audit row
  // describes an act that has not happened yet, so it records the INTENT (cutoff
  // and eligible count) rather than the outcome, and the count is re-reported in
  // the API response for the operator.
  await recordActivity(
    {
      action: "activity_pruned",
      actorId: options.actorId ?? null,
      actorRole: options.actorRole ?? null,
      entityType: "activity_log",
      details: {
        cutoffDays: days,
        eligibleRows: remainingBefore,
        batchRows: PRUNE_BATCH_ROWS,
      },
    },
    client,
  );

  let deleted = 0;
  let incomplete = false;

  // A subselect with LIMIT rather than `DELETE ... LIMIT`, which Postgres does not
  // support. `ctid` is the physical row identifier and is the cheapest possible
  // join back for this purpose; the inner scan is served by the BRIN index on
  // occurred_at, which is exactly the wide-range case BRIN is for.
  for (;;) {
    if (Date.now() - startedAt > budgetMs) {
      incomplete = true;
      break;
    }

    const result = await client.execute(sql`
      delete from ${activityLogs}
      where ctid in (
        select ctid from ${activityLogs}
        where ${activityLogs.occurredAt} < ${cutoff.toISOString()}
        limit ${PRUNE_BATCH_ROWS}
      )
    `);

    const rows = rowCountOf(result);
    deleted += rows;
    if (rows < PRUNE_BATCH_ROWS) break;
  }

  const remaining = incomplete ? await countOlderThan(cutoff, client) : 0;

  return {
    cutoff: cutoff.toISOString(),
    days,
    deleted,
    incomplete,
    dryRun: false,
    remaining,
  };
}

/** How many rows are currently eligible for deletion. */
export async function countOlderThan(cutoff: Date, client: ActivityDb = db): Promise<number> {
  const rows = await client
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLogs)
    .where(and(lt(activityLogs.occurredAt, cutoff)));
  return rows[0]?.n ?? 0;
}

/**
 * `rowCount` off a driver result, defensively.
 *
 * Drizzle's `execute` returns the driver's own result object, whose shape differs
 * between node-postgres and the other drivers. Reading it through a guard rather
 * than a cast means a driver change surfaces as "deleted 0" and an incomplete
 * prune, not a crash mid-loop.
 */
function rowCountOf(result: unknown): number {
  if (result && typeof result === "object" && "rowCount" in result) {
    const value = (result as { rowCount: unknown }).rowCount;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * WHAT COMES AFTER PRUNING, when 90-day batches stop being enough.
 *
 * Documented here rather than built, because building it now would be speculative
 * and the migration is cheap precisely because of the choices already made:
 *
 *   MONTHLY RANGE PARTITIONING on `occurred_at`. Dropping a partition is a catalogue
 *   operation — instant, no row-by-row delete, no bloat and no vacuum afterwards —
 *   which replaces this whole file with `DROP TABLE activity_logs_2026_03`. It is
 *   cheap to adopt later because the table is append-only, never updated, and
 *   inserted in time order, so no existing row has to move between partitions and
 *   the BRIN index stays optimal per partition.
 *
 * The trigger to do it: when a prune run regularly reports `incomplete: true`, or
 * when the table's heap outgrows what a scheduled batch delete can keep up with.
 */
export const PARTITIONING_NOTE =
  "Monthly range partitioning on occurred_at is the next step; see retention.ts.";
