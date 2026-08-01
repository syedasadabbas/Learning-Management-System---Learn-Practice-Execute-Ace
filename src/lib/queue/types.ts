// =============================================================================
// ASYNC JOB QUEUE — TYPES AND THE HANDLER CONTRACT.
// Owner: the async-queues stream. Import from "@/lib/queue".
// -----------------------------------------------------------------------------
// WHAT ACTUALLY NEEDS QUEUEING IN THIS APP — the question answered by reading,
// before any of this was written. Recorded here because "we built a queue" is
// not a justification, and because the three candidates that were REJECTED are
// the more useful half of the answer.
//
//  1. REJECTED — Google Sheet ingestion of assignment submissions.
//     src/lib/submissions/ingest.ts is already driven by a scheduled sweep
//     (vercel.json -> /api/cron/ingest-submissions, "0 * * * *") and is already
//     idempotent at the database level: `submissions_assignment_row_idx` is a
//     unique index on (assignment_id, sheet_row_ref), which is precisely the
//     mechanism this module generalises. Putting a queue in front of it would
//     add a second scheduler in front of a scheduler and buy nothing.
//
//  2. REJECTED — leaderboard rebuilds on grading events.
//     src/lib/leaderboard/rebuild.ts does its work inside ONE transaction under
//     `pg_advisory_xact_lock`, and src/lib/leaderboard/on-scoring-event.ts
//     already swallows its own failures so a ranking problem cannot roll back a
//     grade. Deferring it would make the board lag the grade for a whole drain
//     interval, and the renumber is a single UPDATE over one cohort — tens of
//     rows. The cost of queueing it exceeds the cost of doing it.
//
//  3. REJECTED — video harvesting (scripts/harvest-videos.ts).
//     Not request-triggered at all. It is an operator script run by hand, its
//     output lands as `status='candidate'` behind a human approval gate, and
//     nobody is waiting on it. A queue would be scaffolding around a cron job
//     that does not exist yet.
//
//  4. ACCEPTED — OUTBOUND EMAIL, and specifically the "your assignment has been
//     graded" notification, which the app does not send today at all.
//     Three properties make this the real case:
//       (a) It is EXTERNAL I/O with a 10-second timeout on each of connection,
//           greeting and socket (SMTP_TIMEOUT_MS, src/lib/mail/smtp.ts:44).
//           Sending it inline from POST /api/instructor/submissions/:id/grade
//           would park an instructor's grading request behind a slow or dead MX
//           for up to ~30 s, for a side effect the instructor is not waiting on.
//       (b) It is RETRYABLE and worth retrying. A refused relay is usually
//           transient; the correct response is to try again later, which a
//           request handler cannot do because the request is over.
//       (c) It MUST NOT DOUBLE-SEND. An instructor correcting a star rating
//           re-runs the whole grade path (src/lib/instructor/grading.ts
//           #applyGrade -> src/lib/submissions/grade.ts#gradeSubmission), and a
//           student receiving four "you have been graded" emails for one
//           assignment is the visible failure this item exists to prevent.
//     Password-reset mail is deliberately NOT queued: it is the one message a
//     human IS waiting on, and delaying it to the next drain would make the
//     reset flow feel broken. It stays inline in src/lib/account/reset.ts.
//
// The queue is therefore built narrow and given exactly one real producer and
// one real consumer. Adding a second kind is a new entry in ./registry.ts.
//
// All durations are milliseconds and all sizes are kB (house rule: metric).
// =============================================================================

/**
 * The kinds of work this queue knows how to run.
 *
 * A string union rather than a free-form string so that ./registry.ts can be
 * `Record<JobKind, JobHandler>` and the compiler refuses a kind with no handler.
 * A job row whose `kind` is not in this union is unroutable — see
 * `UNKNOWN_KIND_ERROR` in ./policy.ts for why that is dead-lettered rather than
 * retried forever.
 */
// `notification_email` was added by the email-notifications stream (roadmap
// PHASE 1 feature 1). ONE kind covers quiz-submitted, exam-completed and
// penalty-issued mail because all three describe IMMUTABLE facts about the past,
// so the rendered message is recorded once on a `notifications` row and the payload
// is a pointer to it. `submission_graded_email` is deliberately NOT folded into it:
// a grade is mutable between enqueue and drain, which is why that handler re-reads
// the score and carries a supersede guard. The argument is in
// src/lib/notifications/types.ts.
export const JOB_KINDS = ["submission_graded_email", "notification_email"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Runtime membership test, for values arriving from the database. */
export function isJobKind(value: unknown): value is JobKind {
  return typeof value === "string" && (JOB_KINDS as readonly string[]).includes(value);
}

/**
 * Lifecycle of a row in `jobs`. Mirrors the `job_status` pgEnum exactly.
 *
 *   queued     — eligible once `run_after` has passed.
 *   running    — claimed by a worker, holds a lease until `lease_expires_at`.
 *   succeeded  — terminal, handler reported success.
 *   dead       — TERMINAL FAILURE. Attempts exhausted, or the handler reported a
 *                permanent error. This state exists so that a job which fails
 *                forever becomes VISIBLE (GET /api/admin/jobs?status=dead)
 *                instead of either vanishing or retrying until the end of time.
 */
export const JOB_STATUSES = ["queued", "running", "succeeded", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** One row of `jobs`, as the queue code consumes it. */
export interface JobRecord {
  id: number;
  kind: string;
  /** Globally unique; the database enforces it. See ./keys.ts. */
  idempotencyKey: string;
  payload: unknown;
  status: JobStatus;
  /** Incremented AT CLAIM TIME, not at completion — see ./store.ts#claimJobs. */
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  leaseExpiresAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/**
 * What a handler reports back. Deliberately a VALUE, not an exception, for the
 * same reason src/lib/mail/types.ts makes mail failures values: the difference
 * between "try again in a minute" and "this will never work" is a decision the
 * handler is uniquely able to make, and a thrown Error erases it.
 *
 * A handler that throws anyway is caught by ./drain.ts and treated as `retry`,
 * because an unexpected exception is more likely transient (a dropped
 * connection) than permanent, and a wrong `retry` costs a bounded number of
 * attempts whereas a wrong `dead` loses the work outright.
 */
export type JobOutcome =
  /** Done. Terminal. */
  | { status: "succeeded"; detail?: string }
  /** Transient failure. Re-queued with backoff until `maxAttempts` is reached. */
  | { status: "retry"; error: string }
  /** Permanent failure. Dead-lettered immediately, no further attempts. */
  | { status: "dead"; error: string };

/** A consumer. Receives the whole row so it can see `attempts` if it cares. */
export type JobHandler = (job: JobRecord) => Promise<JobOutcome>;

/** Per-kind summary returned by a drain, for the cron route's response body. */
export interface DrainReport {
  /** Which worker ran, so overlapping invocations are distinguishable in logs. */
  workerId: string;
  claimed: number;
  succeeded: number;
  /** Failed and re-queued with backoff. */
  retried: number;
  /** Failed terminally this run. Non-zero means an operator should look. */
  deadLettered: number;
  /** True when the wall-clock budget stopped the drain before the queue emptied. */
  budgetExhausted: boolean;
  /** Wall-clock duration of the whole drain, in milliseconds. */
  durationMs: number;
}
