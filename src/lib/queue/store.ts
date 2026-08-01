// =============================================================================
// QUEUE PERSISTENCE — the only module that reads or writes the `jobs` table.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// Three operations, and each one exists because the obvious application-level
// version of it is wrong under concurrency:
//
//   enqueueJob  — INSERT ... ON CONFLICT (idempotency_key) DO NOTHING.
//                 NOT `if (!await exists(key)) insert(...)`. Under READ
//                 COMMITTED two concurrent invocations both see no row and both
//                 insert; only a unique index can decide. The `created` flag in
//                 the result is derived from whether the INSERT returned a row,
//                 which is Postgres telling us who won — not a guess.
//
//   claimJobs   — UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED).
//                 NOT `select eligible, then update them`. Two overlapping
//                 drains (a cron tick landing while an after()-triggered drain
//                 is still running — routine on Vercel) would otherwise both
//                 select the same rows and both run the same handler, which for
//                 a mail queue means the student gets the email twice. SKIP
//                 LOCKED makes the second drain step over rows the first has
//                 already locked, in the database, atomically.
//
//   completeJob — a guarded UPDATE that also matches on `attempts`, so a worker
//                 whose lease already expired and was stolen cannot overwrite
//                 the state written by the worker that stole it.
//
// -----------------------------------------------------------------------------
// ONE CLOCK, AND IT IS THE DATABASE'S. Read this before writing a `new Date()`
// into `run_after` or `lease_expires_at`.
//
// Eligibility is decided in SQL, by `run_after <= now()` and
// `lease_expires_at < now()`, where `now()` is POSTGRES's clock. So every value
// those two comparisons read must be produced by that same clock, or the queue
// is comparing two clocks and calling the difference a schedule.
//
// THIS WAS A LIVE BUG, not a hypothetical. `enqueueJob` used to write
// `run_after = new Date(Date.now() + delayMs)` — the Node process's clock. On
// the machine this was diagnosed on, the app clock ran ~1_080 ms AHEAD of the
// Neon instance's, which made every freshly enqueued job ineligible for about a
// second. That is invisible for a job waiting on a 30_000 ms backoff and fatal
// for the zero-delay case, because the zero-delay case is drained by an
// `after()` callback that fires a few hundred milliseconds after the enqueue
// (src/lib/queue/schedule.ts): the drain claimed nothing, returned an empty
// report, and — with no scheduled drain to act as a floor — the row sat at
// `status='queued', attempts=0` indefinitely. That is precisely the "stuck" that
// tests/e2e/queue/queue.spec.ts's "never stuck" spec caught, and the evidence
// was on the row itself: `run_after` was 823 ms LATER than the `created_at` the
// database had just stamped on the same INSERT.
//
// So: `run_after` is written as `now()` / `now() + make_interval(...)` and
// `lease_expires_at` as `now() + make_interval(...)`, in SQL, in every path.
// `NextState.runAfter` (./policy.ts) is still the pure policy's answer and is
// what ./policy.test.ts asserts; the STORE re-derives it from `next.delayMs`
// against the database clock rather than trusting the Date.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs } from "@/db/schema";

import { DEFAULT_MAX_ATTEMPTS, LEASE_MS, type NextState } from "./policy";
import type { JobKind, JobRecord, JobStatus } from "./types";

/** Drizzle's transaction handle, derived from `db` so it cannot drift. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the pooled client or an open transaction. */
export type Db = typeof db | Tx;

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/**
 * `now() + <delayMs>` as SQL, evaluated by Postgres.
 *
 * The ONLY way this module produces a timestamp that eligibility SQL will later
 * compare against `now()`. Zero collapses to a bare `now()` rather than
 * `now() + make_interval(secs => 0)` so the common case reads as what it is in a
 * query log. `make_interval` takes a float seconds argument — Postgres has no
 * millisecond interval literal that is safe to interpolate — so the conversion
 * out of milliseconds happens here and nowhere else.
 */
function dbClockPlus(delayMs: number) {
  const ms = Number.isFinite(delayMs) ? Math.max(0, Math.trunc(delayMs)) : 0;
  if (ms === 0) return sql`now()`;
  return sql`now() + make_interval(secs => ${ms / 1000})`;
}

type Row = typeof jobs.$inferSelect;

function toRecord(row: Row): JobRecord {
  return {
    id: row.id,
    kind: row.kind,
    idempotencyKey: row.idempotencyKey,
    payload: row.payload,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter,
    leaseExpiresAt: row.leaseExpiresAt,
    lockedBy: row.lockedBy,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

// ---------------------------------------------------------------------------
// Produce
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  kind: JobKind;
  /** Built by src/lib/queue/keys.ts. Never assembled inline at a call site. */
  idempotencyKey: string;
  payload: Record<string, unknown>;
  /** Defaults to DEFAULT_MAX_ATTEMPTS. */
  maxAttempts?: number;
  /** Delay before the job first becomes eligible, in milliseconds. Default 0. */
  delayMs?: number;
}

export interface EnqueueResult {
  /**
   * True only when THIS call inserted the row.
   *
   * False means an equivalent job already existed — which is the normal, correct
   * outcome of a duplicate submit, not an error. Producers log it at info level
   * at most; a warning here would fire on every double-clicked Save.
   */
  created: boolean;
  /** Null only in the pathological case where the conflicting row vanished between statements. */
  jobId: number | null;
  idempotencyKey: string;
}

/**
 * Enqueue one job, at most once per idempotency key, ever.
 *
 * The uniqueness decision belongs to `jobs_idempotency_key_idx`. This function
 * only reports it. When the INSERT conflicts, `returning()` yields no rows, and
 * the existing job's id is fetched in a second statement so the caller can log
 * or correlate — that second read is best-effort and its absence never turns a
 * successful de-duplication into a failure.
 *
 * NOTE ON TRANSACTIONS: producers call this OUTSIDE the transaction that wrote
 * the thing being notified about. That is a deliberate trade-off, stated plainly
 * rather than left implicit. Inside the transaction, enqueue and the business
 * write would be atomic (a true transactional outbox), but a queue write failing
 * would then roll back the instructor's grade — the exact inversion of priority
 * that src/lib/leaderboard/on-scoring-event.ts already argues against for the
 * same path. Outside, the failure mode is a grade saved with no notification
 * enqueued, which is recoverable (regrade, or an operator INSERT) and does not
 * lose the graded work. A caller that wants the atomic version can pass its `tx`.
 */
export async function enqueueJob(
  input: EnqueueInput,
  client: Db = db,
): Promise<EnqueueResult> {
  const delayMs = Math.max(0, Math.trunc(input.delayMs ?? 0));

  const inserted = await client
    .insert(jobs)
    .values({
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: "queued",
      attempts: 0,
      maxAttempts: Math.max(1, Math.trunc(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
      // DATABASE CLOCK, not `new Date()` — see the "ONE CLOCK" note in the file
      // header for the bug this line is the fix for. `make_interval` takes float
      // seconds, so the millisecond value is converted here at the boundary.
      runAfter: dbClockPlus(delayMs),
    })
    // Names the unique index explicitly. `onConflictDoNothing()` with no target
    // would also absorb a conflict on the primary key, which would hide a
    // genuine id collision as a successful de-duplication.
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });

  if (inserted.length > 0) {
    return { created: true, jobId: inserted[0].id, idempotencyKey: input.idempotencyKey };
  }

  const [existing] = await client
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, input.idempotencyKey))
    .limit(1);

  return {
    created: false,
    jobId: existing?.id ?? null,
    idempotencyKey: input.idempotencyKey,
  };
}

// ---------------------------------------------------------------------------
// Consume
// ---------------------------------------------------------------------------

/**
 * Atomically take up to `limit` jobs and mark them `running`.
 *
 * WHAT THE SQL BELOW GUARANTEES, clause by clause, because every clause is load
 * bearing and a well-meaning simplification of any of them reintroduces a bug:
 *
 *   `status = 'queued' and run_after <= now()`
 *       normal eligibility, including a job whose backoff has elapsed.
 *
 *   `or (status = 'running' and lease_expires_at < now())`
 *       LEASE RECLAIM. This is the recovery path for a serverless invocation
 *       that was terminated after claiming and before completing. Without it
 *       that row stays `running` forever and the work silently never happens.
 *
 *   `order by run_after asc, id asc`
 *       roughly FIFO with a deterministic tie-break, so a job cannot be starved
 *       by a steady stream of newer ones.
 *
 *   `for update skip locked`
 *       THE CONCURRENCY GUARANTEE. Rows already locked by another in-flight
 *       claim are skipped rather than waited on, so two overlapping drains
 *       partition the queue between them instead of serialising or colliding.
 *       Waiting (plain FOR UPDATE) would be correct but would make the second
 *       drain block for the length of the first, and on a platform that bills
 *       and time-limits by wall clock that is a self-inflicted timeout.
 *
 *   `attempts = jobs.attempts + 1`
 *       INCREMENTED AT CLAIM, not at completion. If it were incremented at
 *       completion, a worker killed mid-handler would leave the count unchanged
 *       and the job would be retried without limit — a job that crashes the
 *       runtime would then be immortal. Burning the attempt up front means a
 *       job that kills its worker still reaches the dead-letter state.
 *
 * The whole statement is one UPDATE, so it is atomic without an explicit
 * transaction: the SELECT's locks are held until the enclosing implicit
 * transaction commits.
 *
 * `onlyIds` NARROWS the candidate set to a known list of job ids and changes
 * nothing else about the statement — same CTE, same ordering, same
 * `for update skip locked`. Two callers want it:
 *   - store.integration.test.ts, which proves SKIP LOCKED against the real
 *     database while five other agents share that database. Without a way to
 *     confine a claim to the rows the test itself inserted, "worker B saw
 *     exactly the one row worker A did not lock" is a race against every other
 *     stream's traffic rather than an assertion;
 *   - an operator draining one specific job after repairing whatever killed it.
 * It is a filter on WHICH rows are eligible, never on HOW they are locked, so a
 * test using it exercises the identical concurrency mechanism production does.
 */
export async function claimJobs(
  input: { limit: number; workerId: string; leaseMs?: number; onlyIds?: number[] },
  client: Db = db,
): Promise<JobRecord[]> {
  const limit = Math.max(1, Math.trunc(input.limit));
  const leaseMs = Math.max(1_000, Math.trunc(input.leaseMs ?? LEASE_MS));
  // Postgres has no millisecond interval literal that is safe to interpolate as
  // a string; make_interval takes a float seconds argument, so the millisecond
  // value is converted here at the boundary and nowhere else.
  const leaseSeconds = leaseMs / 1000;

  // An EMPTY array must select nothing, not everything. `undefined` means "no
  // restriction"; `[]` means "these zero ids", and `id = any('{}')` is false for
  // every row, which is the correct reading of an empty allow-list.
  const idFilter =
    input.onlyIds === undefined
      ? sql`true`
      : input.onlyIds.length === 0
        ? sql`false`
        : sql`j0.id in (${sql.join(
            input.onlyIds.map((n) => sql`${Math.trunc(n)}`),
            sql`, `,
          )})`;

  const result = await client.execute(sql`
    with claimable as (
      select j0.id
        from jobs j0
       where ${idFilter}
         and ( (j0.status = 'queued'  and j0.run_after <= now())
            or (j0.status = 'running' and j0.lease_expires_at is not null and j0.lease_expires_at < now()) )
       order by j0.run_after asc, j0.id asc
       limit ${limit}
         for update skip locked
    )
    update jobs j
       set status           = 'running',
           attempts         = j.attempts + 1,
           lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
           locked_by        = ${input.workerId},
           updated_at       = now()
      from claimable c
     where j.id = c.id
    returning j.id, j.kind, j.idempotency_key, j.payload, j.status, j.attempts,
              j.max_attempts, j.run_after, j.lease_expires_at, j.locked_by,
              j.last_error, j.created_at, j.updated_at, j.completed_at
  `);

  // node-postgres returns snake_case columns for a raw statement; drizzle does
  // not map them because this is not a table-shaped query. Mapped by hand rather
  // than cast, so a column rename fails visibly here instead of producing
  // `undefined` attempts and an immortal job.
  const rows = extractRows(result);
  return rows.map(rawToRecord);
}

interface RawJobRow {
  id: number;
  kind: string;
  idempotency_key: string;
  payload: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  run_after: string | Date;
  lease_expires_at: string | Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
}

function extractRows(result: unknown): RawJobRow[] {
  // node-postgres: { rows: [...] }. Guarded rather than cast so a driver change
  // surfaces as an empty drain plus a log line, not a TypeError on the cron path.
  const rows = (result as { rows?: unknown } | undefined)?.rows;
  return Array.isArray(rows) ? (rows as RawJobRow[]) : [];
}

function rawToRecord(row: RawJobRow): JobRecord {
  return {
    id: Number(row.id),
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    status: row.status as JobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: toDate(row.run_after),
    leaseExpiresAt: row.lease_expires_at == null ? null : toDate(row.lease_expires_at),
    lockedBy: row.locked_by,
    lastError: row.last_error,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    completedAt: row.completed_at == null ? null : toDate(row.completed_at),
  };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Write the outcome of a run.
 *
 * The WHERE clause matches on `attempts` as well as `id`. That guard exists for
 * one specific sequence: worker A claims a job, stalls past its lease, worker B
 * reclaims it (incrementing `attempts`) and completes it — and only then does A
 * wake up and try to report. Without the guard A would overwrite B's result,
 * possibly resurrecting a `succeeded` job back to `queued` and sending the email
 * a second time. With it, A's UPDATE matches nothing and the function reports
 * `false`, which ./drain.ts logs.
 */
export async function completeJob(
  input: { jobId: number; expectedAttempts: number; next: NextState },
  client: Db = db,
): Promise<boolean> {
  const { next } = input;

  const result = await client
    .update(jobs)
    .set({
      status: next.status,
      // DATABASE CLOCK. `next.runAfter` is the pure policy's answer and is what
      // ./policy.test.ts asserts, but writing that Date here would put the app
      // process's clock back into the column that `claimJobs` compares against
      // Postgres's `now()`. `next.delayMs` is 0 for every terminal state, so this
      // reduces to `now()` there. See the "ONE CLOCK" note in the file header.
      runAfter: dbClockPlus(next.delayMs),
      lastError: next.lastError,
      completedAt: next.completedAt,
      // Cleared on every terminal or re-queued state: a `queued` row still
      // holding a lease would be skipped by nothing but would read as claimed.
      leaseExpiresAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, input.jobId), eq(jobs.attempts, input.expectedAttempts)))
    .returning({ id: jobs.id });

  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Observe — the dead-letter state has to be VISIBLE or it is not a state
// ---------------------------------------------------------------------------

export interface ListJobsInput {
  status?: JobStatus | JobStatus[];
  kind?: string;
  limit?: number;
}

/** Newest activity first. Backing read for GET /api/admin/jobs. */
export async function listJobs(
  input: ListJobsInput = {},
  client: Db = db,
): Promise<JobRecord[]> {
  const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 50)));

  const filters = [];
  if (input.status) {
    const statuses = Array.isArray(input.status) ? input.status : [input.status];
    if (statuses.length > 0) filters.push(inArray(jobs.status, statuses));
  }
  if (input.kind) filters.push(eq(jobs.kind, input.kind));

  const rows = await client
    .select()
    .from(jobs)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(jobs.updatedAt), desc(jobs.id))
    .limit(limit);

  return rows.map(toRecord);
}

/** One job by its idempotency key. Used by tests and by operator tooling. */
export async function findJobByKey(
  idempotencyKey: string,
  client: Db = db,
): Promise<JobRecord | null> {
  const [row] = await client
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ? toRecord(row) : null;
}

export interface QueueCounts {
  queued: number;
  running: number;
  succeeded: number;
  dead: number;
  /** Queued jobs whose `run_after` has passed — i.e. work a drain would pick up now. */
  readyNow: number;
  /** `running` rows whose lease has expired. Persistently non-zero means drains are not firing. */
  staleLeases: number;
}

/**
 * Aggregate health, in ONE query.
 *
 * One statement rather than six, because src/db/index.ts measured a query on an
 * existing pooled connection at ~245 ms against this Neon instance: six
 * sequential counts would be a second and a half on an admin page for numbers
 * that fit in a single row.
 */
export async function queueCounts(client: Db = db): Promise<QueueCounts> {
  const [row] = await client
    .select({
      queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
      succeeded: sql<number>`count(*) filter (where ${jobs.status} = 'succeeded')::int`,
      dead: sql<number>`count(*) filter (where ${jobs.status} = 'dead')::int`,
      readyNow: sql<number>`count(*) filter (where ${jobs.status} = 'queued' and ${jobs.runAfter} <= now())::int`,
      staleLeases: sql<number>`count(*) filter (where ${jobs.status} = 'running' and ${jobs.leaseExpiresAt} < now())::int`,
    })
    .from(jobs);

  return {
    queued: Number(row?.queued ?? 0),
    running: Number(row?.running ?? 0),
    succeeded: Number(row?.succeeded ?? 0),
    dead: Number(row?.dead ?? 0),
    readyNow: Number(row?.readyNow ?? 0),
    staleLeases: Number(row?.staleLeases ?? 0),
  };
}

/**
 * Move a dead job back to `queued` so it runs again — the repair path that makes
 * the dead-letter state actionable rather than merely observable.
 *
 * `attempts` is reset to 0. The alternative (leave it) would mean a revived job
 * is immediately dead-lettered again by the first failure, which makes the
 * repair look like it did not work. Only rows currently in `dead` are touched,
 * so this can never resurrect a `running` job out from under its worker.
 */
export async function requeueDeadJobs(
  input: { ids?: number[]; kind?: JobKind } = {},
  client: Db = db,
): Promise<number> {
  const filters = [eq(jobs.status, "dead")];
  if (input.ids?.length) filters.push(inArray(jobs.id, input.ids));
  if (input.kind) filters.push(eq(jobs.kind, input.kind));

  const rows = await client
    .update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      runAfter: new Date(),
      leaseExpiresAt: null,
      lockedBy: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(...filters))
    .returning({ id: jobs.id });

  return rows.length;
}

/**
 * Delete `succeeded` rows older than `olderThanMs`.
 *
 * The queue is append-only otherwise, and a cohort of 80 students being graded
 * across four weeks' assignments is a few hundred rows — small, but unbounded
 * over successive cohorts. Not wired to a schedule: with two Vercel Hobby cron
 * slots already spent (vercel.json), spending a third on housekeeping would be
 * the wrong priority. Exposed for an operator or a future sweep.
 *
 * `dead` rows are NEVER swept. A dead-letter that disappears on a timer is the
 * silent vanishing this design exists to prevent.
 */
export async function purgeSucceededJobs(
  olderThanMs: number,
  client: Db = db,
): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(0, Math.trunc(olderThanMs)));
  const rows = await client
    .delete(jobs)
    .where(
      and(
        eq(jobs.status, "succeeded"),
        or(sql`${jobs.completedAt} < ${cutoff}`, sql`${jobs.completedAt} is null`),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/** Oldest-first ordering helper, exported so tests can assert the claim order. */
export const CLAIM_ORDER = [asc(jobs.runAfter), asc(jobs.id)] as const;
