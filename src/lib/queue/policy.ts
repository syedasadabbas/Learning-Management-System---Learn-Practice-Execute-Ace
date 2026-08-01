// =============================================================================
// RETRY POLICY — pure functions, no database, no clock of its own.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// Every scheduling decision the queue makes lives here as a pure function so it
// can be asserted directly rather than inferred from timing. ./store.ts knows
// how to write rows; this file knows WHICH row to write. `now` and `random` are
// always parameters — a test that has to sleep to observe a backoff is a test
// that will be flaky on CI and deleted within a month.
//
// EVERY DURATION IS MILLISECONDS (house rule: metric units). There is no seconds
// value anywhere in this module; the only place seconds appear in this stream is
// `maxDuration` on a route handler, which is Vercel's own unit and is labelled
// as such at each use.
// =============================================================================

import type { JobOutcome, JobRecord, JobStatus } from "./types";

// ---------------------------------------------------------------------------
// Constants. Every one of these is a trade-off, so every one is argued.
// ---------------------------------------------------------------------------

/**
 * Attempts before a job is dead-lettered, INCLUDING the first.
 *
 * With the base and factor below, five attempts span roughly
 * 30 s + 60 s + 120 s + 240 s ≈ 7.5 minutes of retrying before the job gives up.
 * That is chosen against the actual failure this queue exists to survive: an
 * SMTP relay that is briefly refusing (a Gmail app-password rate limit, a
 * restart). Anything still failing after seven minutes is a configuration fault,
 * and a configuration fault should surface on the dead-letter list where an
 * operator can see it — not be papered over by a queue that retries for a day.
 */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Delay before the FIRST retry. */
export const BACKOFF_BASE_MS = 30_000;

/** Each subsequent retry waits this multiple of the previous one. */
export const BACKOFF_FACTOR = 2;

/**
 * Hard ceiling on a single backoff delay.
 *
 * Unreachable at DEFAULT_MAX_ATTEMPTS = 5 (the largest computed delay is
 * 480_000 ms). It is here because `maxAttempts` is a per-job column, so a future
 * kind can raise it, and unbounded exponential growth means attempt 12 is
 * scheduled two months out — indistinguishable from lost.
 */
export const BACKOFF_CEILING_MS = 3_600_000;

/**
 * Jitter, as a fraction applied symmetrically (±20%).
 *
 * NOT decoration. The failure mode this prevents is real for this app: when the
 * one SMTP relay refuses, EVERY queued mail job fails in the same drain tick and
 * therefore computes the same deterministic delay, so all of them retry in the
 * same later tick, and hammer the relay that just rate-limited them — repeatedly
 * and in lockstep, for all five attempts. Spreading the retries over a ±20% band
 * breaks the convoy. It is deliberately narrow: wide jitter would make the
 * observed retry time unpredictable enough to be hard to support.
 */
export const BACKOFF_JITTER_RATIO = 0.2;

/**
 * How long a claim is held before another worker may steal the job back.
 *
 * THIS IS THE ONLY THING STANDING BETWEEN A KILLED SERVERLESS FUNCTION AND A JOB
 * STUCK IN `running` FOREVER. A Vercel function can be terminated mid-handler
 * (timeout, deploy, instance recycle) after the row has been flipped to
 * `running` and before any completion is written. Without a lease, that row is
 * never eligible again and the mail is silently never sent — exactly the "fails
 * forever and vanishes" outcome this item forbids.
 *
 * 120 s is chosen to be comfortably longer than the slowest legitimate handler
 * (an SMTP send bounded by three 10 s timeouts, so ~30 s worst case) and shorter
 * than the interval between drains, so recovery happens on the next tick rather
 * than the one after. The cost of setting it too low is a DOUBLE SEND: two
 * workers running the same handler concurrently. That is why it is 4x the worst
 * case and not 1.5x.
 */
export const LEASE_MS = 120_000;

/**
 * How much wall-clock a single drain will spend before returning what it has.
 *
 * The cron drain route declares `maxDuration = 60` (seconds — Vercel's unit).
 * Being KILLED at that boundary is much worse than stopping early: a killed
 * invocation leaves whatever it was running leased for LEASE_MS and returns no
 * report at all. 25 s leaves room for one more in-flight handler to finish
 * inside the platform limit.
 */
export const DRAIN_BUDGET_MS = 25_000;

/** Jobs claimed per drain. See ./drain.ts for why the batch is small. */
export const DRAIN_BATCH_SIZE = 10;

/** `last_error` is truncated to this many characters before it is stored. */
export const MAX_ERROR_CHARS = 1_000;

/**
 * The error recorded when a row's `kind` matches no handler.
 *
 * Dead-lettered on the FIRST attempt rather than retried: a missing handler is a
 * deploy-shaped fact, not a transient one, and retrying it five times only
 * delays the moment an operator sees it. The row is preserved, so re-deploying
 * the handler and flipping the row back to `queued` is a one-line UPDATE.
 */
export const UNKNOWN_KIND_ERROR = "No handler is registered for this job kind.";

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

/**
 * The delay before the next attempt, in milliseconds.
 *
 * @param attemptsMade how many attempts have ALREADY been made (>= 1). The queue
 *   increments `attempts` when it claims, so the value on the row after a failed
 *   run is exactly this number.
 * @param random a [0, 1) source. Injected so the jitter is testable; defaults to
 *   Math.random for production. Values outside [0, 1) are clamped rather than
 *   trusted, because a stubbed generator returning 1 would otherwise push the
 *   delay a full jitter step past the intended band.
 *
 * Guarantees, all pinned in ./policy.test.ts:
 *   - never negative, never zero (a zero delay is an instant re-run, which for a
 *     rate-limited relay is the worst possible response);
 *   - never above BACKOFF_CEILING_MS, jitter included;
 *   - an integer, because it is added to a timestamp.
 */
export function backoffDelayMs(
  attemptsMade: number,
  random: () => number = Math.random,
): number {
  // An attempt count below 1 means a caller computed a delay for a job that has
  // not run. Treat it as the first retry rather than returning something absurd.
  const attempt = Number.isFinite(attemptsMade) ? Math.max(1, Math.floor(attemptsMade)) : 1;

  // Math.pow with a large exponent overflows to Infinity long before it becomes
  // a problem here, but min-ing against the ceiling BEFORE applying jitter keeps
  // the arithmetic finite for any attempt number a future kind might reach.
  const exponential = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  const base = Math.min(exponential, BACKOFF_CEILING_MS);

  const r = clamp01(random());
  // (2r - 1) maps [0, 1) onto [-1, 1), so the band is base * (1 ± ratio).
  const jittered = base * (1 + BACKOFF_JITTER_RATIO * (2 * r - 1));

  return Math.min(BACKOFF_CEILING_MS, Math.max(1, Math.round(jittered)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 0.999_999_999;
  return value;
}

// ---------------------------------------------------------------------------
// The state transition
// ---------------------------------------------------------------------------

/** What ./store.ts should write once a handler has reported. */
export interface NextState {
  status: JobStatus;
  /** Only meaningful when `status` is "queued". */
  runAfter: Date;
  /** Null on success; the truncated handler error otherwise. */
  lastError: string | null;
  /** Set only on a terminal state, so a retry does not look finished. */
  completedAt: Date | null;
  /** Milliseconds until the next attempt. 0 for any terminal state. */
  delayMs: number;
  /**
   * Why the job is terminal, when it is. Distinguishes the two ways a job dies,
   * which matters to an operator reading the dead-letter list: "attempts
   * exhausted" says retry it after fixing the relay, "permanent" says do not.
   */
  terminalReason?: "succeeded" | "attempts_exhausted" | "permanent";
}

/**
 * Decide what happens to a job after its handler reported `outcome`.
 *
 * Pure. `job.attempts` is read AS ALREADY INCREMENTED by the claim — see
 * ./store.ts#claimJobs — so `attempts >= maxAttempts` here means "this run was
 * the last one allowed", not "one more to go". Getting that off by one is the
 * difference between four retries and five, so it is asserted explicitly in
 * ./policy.test.ts rather than left to reading.
 */
export function decideNextState(
  job: Pick<JobRecord, "attempts" | "maxAttempts">,
  outcome: JobOutcome,
  now: Date,
  random: () => number = Math.random,
): NextState {
  if (outcome.status === "succeeded") {
    return {
      status: "succeeded",
      runAfter: now,
      lastError: null,
      completedAt: now,
      delayMs: 0,
      terminalReason: "succeeded",
    };
  }

  const error = truncateError(outcome.error);

  if (outcome.status === "dead") {
    return {
      status: "dead",
      runAfter: now,
      lastError: error,
      completedAt: now,
      delayMs: 0,
      terminalReason: "permanent",
    };
  }

  // A `maxAttempts` of 0 or a negative value would otherwise mean "retry
  // forever with a comparison that never trips". Floor it at 1 so every job is
  // guaranteed to reach a terminal state.
  const ceiling = Math.max(1, Math.floor(job.maxAttempts));

  if (job.attempts >= ceiling) {
    return {
      status: "dead",
      runAfter: now,
      lastError: `${error} (gave up after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"})`,
      completedAt: now,
      delayMs: 0,
      terminalReason: "attempts_exhausted",
    };
  }

  const delayMs = backoffDelayMs(job.attempts, random);
  return {
    status: "queued",
    runAfter: new Date(now.getTime() + delayMs),
    lastError: error,
    completedAt: null,
    delayMs,
  };
}

/**
 * Bound what goes into `last_error`.
 *
 * An SMTP failure detail can carry a full server transcript, and an unbounded
 * TEXT column written five times per failing job across a cohort's worth of mail
 * is how a free-tier database fills up. 1000 characters (~1 kB) keeps the useful
 * first line and the error class while capping the row.
 */
export function truncateError(message: string): string {
  const text = (message ?? "").toString().trim() || "Unknown error.";
  if (text.length <= MAX_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_ERROR_CHARS - 1)}…`;
}
