// =============================================================================
// THE WORKER — claim, run, record. There is no daemon and no timer.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// READ THIS BEFORE ADDING A setInterval ANYWHERE NEAR THIS FILE.
//
// This app deploys to Vercel (FREE_STACK.md: "Hosting — Vercel hobby"). A
// serverless function is frozen the moment its response is flushed and is
// destroyed some time after; it does NOT keep running between requests. A
// `setInterval` worker started at module scope would tick a few times during one
// invocation, look perfectly healthy in `next dev` where the Node process is
// long-lived, and then process nothing at all in production — the single worst
// outcome available, because it fails only where nobody is watching.
//
// So this module exports a function that drains a BOUNDED batch within ONE
// invocation and returns. Who calls it, and what that costs, is argued in full
// in the header of src/app/api/cron/drain-jobs/route.ts.
//
// WHY JOBS RUN SEQUENTIALLY within a drain, not with Promise.all:
//   - src/db/index.ts caps the connection pool at `max: 5`, and every handler
//     does at least one query. Ten concurrent handlers would queue on the pool
//     anyway, and would do it while ALSO holding ten leases.
//   - the one real handler talks to a single SMTP relay. Firing ten sends at a
//     free Gmail-app-password mailbox concurrently is how the rate limit that
//     the backoff jitter exists to survive gets triggered in the first place.
//   Concurrency here would be a change to make when a handler is CPU-idle and
//   the queue is deep, neither of which is true today.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import {
  DRAIN_BATCH_SIZE,
  DRAIN_BUDGET_MS,
  LEASE_MS,
  UNKNOWN_KIND_ERROR,
  decideNextState,
  truncateError,
} from "./policy";
import { resolveHandler } from "./registry";
import { claimJobs, completeJob } from "./store";
import type { DrainReport, JobHandler, JobOutcome, JobRecord } from "./types";

/**
 * The side-effecting collaborators, injectable.
 *
 * Not dependency-injection ceremony: the retry/dead-letter behaviour of this
 * loop is the substance of this work item, and it has to be assertable WITHOUT a
 * database and WITHOUT a mail relay. With these as parameters, ./drain.test.ts
 * can prove "a handler that always fails ends up dead after exactly
 * maxAttempts claims" in milliseconds and with no I/O. Defaults are the real
 * implementations, so production call sites pass nothing.
 */
export interface DrainDeps {
  claim: (input: { limit: number; workerId: string; leaseMs: number }) => Promise<JobRecord[]>;
  complete: (input: {
    jobId: number;
    expectedAttempts: number;
    next: ReturnType<typeof decideNextState>;
  }) => Promise<boolean>;
  resolve: (kind: string) => JobHandler | null;
  now: () => Date;
  random: () => number;
  /** Wall clock for the budget. Separate from `now` so a test can freeze one and advance the other. */
  elapsedMs: () => number;
  log: (level: "info" | "warn" | "error", message: string, meta?: unknown) => void;
}

export interface DrainOptions {
  /** Jobs claimed per round trip. Default DRAIN_BATCH_SIZE. */
  batchSize?: number;
  /** Wall-clock ceiling for the whole drain. Default DRAIN_BUDGET_MS. */
  budgetMs?: number;
  /** Lease length handed to claimed jobs. Default LEASE_MS. */
  leaseMs?: number;
  /** Identifies this invocation in `jobs.locked_by` and in logs. */
  workerId?: string;
  /** Hard ceiling on total jobs processed, across all batches. */
  maxJobs?: number;
}

/**
 * A short, unique-enough identifier for one drain invocation.
 *
 * Diagnostic only — nothing about correctness depends on it being unique, since
 * the lease and the `attempts` guard in ./store.ts#completeJob are what actually
 * prevent two workers stepping on each other. It exists so that a log showing
 * two overlapping drains is readable.
 */
export function makeWorkerId(prefix = "drain"): string {
  const stamp = Date.now().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${noise}`.slice(0, 64);
}

function defaultDeps(): DrainDeps {
  const startedAt = Date.now();
  return {
    claim: (input) => claimJobs(input),
    complete: (input) => completeJob(input),
    resolve: resolveHandler,
    now: () => new Date(),
    random: Math.random,
    elapsedMs: () => Date.now() - startedAt,
    log: (level, message, meta) => {
      const line = `[queue] ${message}`;
      if (level === "error") console.error(line, meta ?? "");
      else if (level === "warn") console.warn(line, meta ?? "");
      else if (process.env.NODE_ENV !== "production") console.info(line, meta ?? "");
    },
  };
}

/**
 * Drain the queue until it is empty, the budget is spent, or `maxJobs` is hit.
 *
 * NEVER THROWS. A rejection out of here would surface as a 500 on the cron
 * schedule (leaving it permanently red, which is how a monitoring signal gets
 * ignored) or, worse, as an unhandled rejection inside an `after()` callback on
 * a request the user has already been served. Every failure is either recorded
 * on the job row or logged and counted.
 */
export async function drainJobs(
  options: DrainOptions = {},
  overrides: Partial<DrainDeps> = {},
): Promise<DrainReport> {
  const deps: DrainDeps = { ...defaultDeps(), ...overrides };

  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? DRAIN_BATCH_SIZE));
  const budgetMs = Math.max(1, Math.trunc(options.budgetMs ?? DRAIN_BUDGET_MS));
  const leaseMs = Math.max(1_000, Math.trunc(options.leaseMs ?? LEASE_MS));
  const maxJobs = Math.max(1, Math.trunc(options.maxJobs ?? Number.MAX_SAFE_INTEGER));
  const workerId = options.workerId ?? makeWorkerId();

  const report: DrainReport = {
    workerId,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    budgetExhausted: false,
    durationMs: 0,
  };

  try {
    // Every exit condition is inside the body: budget spent, maxJobs reached,
    // claim failed, empty batch, or a short batch meaning the queue is drained.
    while (true) {
      if (deps.elapsedMs() >= budgetMs) {
        report.budgetExhausted = true;
        break;
      }
      if (report.claimed >= maxJobs) break;

      const remaining = Math.min(batchSize, maxJobs - report.claimed);

      let batch: JobRecord[];
      try {
        batch = await deps.claim({ limit: remaining, workerId, leaseMs });
      } catch (error) {
        // A failed CLAIM is not a failed job — no row was moved to `running`, so
        // nothing is stranded. Log and stop; the next drain retries.
        deps.log("error", "claim failed; stopping this drain", errorMeta(error));
        break;
      }

      if (batch.length === 0) break;
      report.claimed += batch.length;

      for (const job of batch) {
        // Checked per JOB, not just per batch: a batch of ten SMTP sends at up
        // to ~30 s each would blow a 25 s budget several times over if the
        // budget were only consulted between batches.
        if (deps.elapsedMs() >= budgetMs) {
          report.budgetExhausted = true;
          // The remaining jobs of this batch keep their lease and are picked up
          // by the next drain once it expires. They are NOT lost, but they ARE
          // delayed by up to LEASE_MS — the price of a bounded invocation.
          deps.log("warn", `budget spent mid-batch; ${batch.length} claimed, some deferred`, {
            workerId,
            budgetMs,
          });
          break;
        }

        const outcome = await runOne(job, deps);
        const next = decideNextState(job, outcome, deps.now(), deps.random);

        let recorded = false;
        try {
          recorded = await deps.complete({
            jobId: job.id,
            expectedAttempts: job.attempts,
            next,
          });
        } catch (error) {
          // THE HANDLER ALREADY RAN and this is the write that would have recorded
          // it. The lease will expire and the job will be reclaimed, so from the
          // queue's own point of view the handler runs a SECOND time — that part
          // is unavoidable and is the same mechanism that recovers a killed
          // invocation.
          //
          // What used to follow from it was a second email. It no longer does:
          // the mail handler sends through the `mail_dispatches` ledger
          // (src/lib/mail/dispatch.ts), so the second run finds the key already
          // marked sent and reports success WITHOUT sending. The residual case is
          // narrower and is named there — a send whose acknowledgement was never
          // recorded is resent at most once, with an identical derived Message-ID.
          //
          // A HANDLER THAT DOES NOT USE THAT LEDGER HAS NO SUCH PROTECTION. Any
          // future kind whose side effect is externally visible must supply its own
          // dedupe at the point of effect; the queue cannot do it on the handler's
          // behalf, which is why this log line still exists and still says ERROR.
          deps.log(
            "error",
            `job ${job.id} (${job.kind}) RAN but its result could not be recorded; ` +
              `it will be retried after its lease expires. Its effect will repeat unless ` +
              `the handler de-duplicates at the point of effect (see src/lib/mail/dispatch.ts)`,
            errorMeta(error),
          );
          continue;
        }

        if (!recorded) {
          // `attempts` moved: another worker reclaimed this job while we ran it.
          // Its result wins. Ours is discarded rather than overwriting a state
          // that may already be terminal.
          deps.log(
            "warn",
            `job ${job.id} (${job.kind}) was reclaimed by another worker mid-run; ` +
              `discarding this worker's result`,
            { workerId, expectedAttempts: job.attempts },
          );
          continue;
        }

        if (next.status === "succeeded") {
          report.succeeded += 1;
        } else if (next.status === "dead") {
          report.deadLettered += 1;
          // ERROR level, unconditionally. A dead-lettered job is the definition
          // of work that will not happen unless a human intervenes, and the only
          // thing worse than the failure is the failure being quiet.
          deps.log(
            "error",
            `job ${job.id} (${job.kind}) DEAD-LETTERED after ${job.attempts} attempt(s): ` +
              `${next.lastError}. Visible at GET /api/admin/jobs?status=dead.`,
            { workerId, idempotencyKey: job.idempotencyKey, reason: next.terminalReason },
          );
        } else {
          report.retried += 1;
          deps.log(
            "warn",
            `job ${job.id} (${job.kind}) failed attempt ${job.attempts}/${job.maxAttempts}; ` +
              `retrying in ${next.delayMs} ms`,
            { workerId, error: next.lastError },
          );
        }
      }

      if (report.budgetExhausted) break;
      // A short batch means the queue is drained; another claim would be a
      // pointless ~245 ms round trip (see the measurement in src/db/index.ts).
      if (batch.length < remaining) break;
    }
  } catch (error) {
    // Belt and braces. See the "NEVER THROWS" note above.
    deps.log("error", "drain aborted unexpectedly", errorMeta(error));
  }

  report.durationMs = deps.elapsedMs();
  return report;
}

/**
 * Run one job's handler, converting every failure mode into a `JobOutcome`.
 *
 * A thrown error becomes `retry`, not `dead`: an exception carries no signal
 * about permanence, and of the two possible mistakes, retrying something
 * hopeless costs a bounded number of attempts while dead-lettering something
 * transient loses the work. Handlers that KNOW a failure is permanent say so by
 * returning `{ status: "dead" }` — which is exactly why JobOutcome is a value.
 */
export async function runOne(job: JobRecord, deps: DrainDeps): Promise<JobOutcome> {
  const handler = deps.resolve(job.kind);
  if (!handler) {
    return { status: "dead", error: `${UNKNOWN_KIND_ERROR} (kind: ${job.kind})` };
  }

  try {
    const outcome = await handler(job);
    // A handler returning garbage (or undefined, from a forgotten return) must
    // not be read as success. Treated as a retry so the mistake is visible in
    // the logs across several attempts before the job dies.
    if (!outcome || typeof outcome !== "object" || !("status" in outcome)) {
      return {
        status: "retry",
        error: `Handler for ${job.kind} returned no outcome.`,
      };
    }
    return outcome;
  } catch (error) {
    return {
      status: "retry",
      error: truncateError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function errorMeta(error: unknown): { error: string } {
  return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}
