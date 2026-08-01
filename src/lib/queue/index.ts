// =============================================================================
// ASYNC JOB QUEUE — public surface. Import from "@/lib/queue".
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// Start with ./types.ts: it records WHAT in this app needs queueing and, more
// usefully, the three candidates that were examined and rejected.
//
// Producers  : enqueueGradedNotification (./producers.ts)
// Consumers  : ./handlers/*, routed by ./registry.ts
// Triggers   : scheduleDrain (./schedule.ts) and /api/cron/drain-jobs
// Idempotency: ./keys.ts + the unique index `jobs_idempotency_key_idx`
// Retries    : ./policy.ts (bounded attempts, ms backoff, dead-letter)
// =============================================================================

export type {
  DrainReport,
  JobHandler,
  JobKind,
  JobOutcome,
  JobRecord,
  JobStatus,
} from "./types";
export { JOB_KINDS, JOB_STATUSES, isJobKind } from "./types";

export {
  BACKOFF_BASE_MS,
  BACKOFF_CEILING_MS,
  BACKOFF_FACTOR,
  BACKOFF_JITTER_RATIO,
  DEFAULT_MAX_ATTEMPTS,
  DRAIN_BATCH_SIZE,
  DRAIN_BUDGET_MS,
  LEASE_MS,
  MAX_ERROR_CHARS,
  UNKNOWN_KIND_ERROR,
  backoffDelayMs,
  decideNextState,
  truncateError,
} from "./policy";
export type { NextState } from "./policy";

export {
  IdempotencyKeyError,
  KEY_MAX_CHARS,
  KEY_SEPARATOR,
  buildIdempotencyKey,
  gradedNotificationKey,
} from "./keys";

export {
  claimJobs,
  completeJob,
  enqueueJob,
  findJobByKey,
  listJobs,
  purgeSucceededJobs,
  queueCounts,
  requeueDeadJobs,
} from "./store";
export type { EnqueueInput, EnqueueResult, ListJobsInput, QueueCounts } from "./store";

export { drainJobs, makeWorkerId, runOne } from "./drain";
export type { DrainDeps, DrainOptions } from "./drain";

export { registeredKinds, resolveHandler } from "./registry";

export { enqueueGradedNotification } from "./producers";

export {
  REQUEST_DRAIN_BUDGET_MS,
  REQUEST_DRAIN_MAX_JOBS,
  scheduleDrain,
} from "./schedule";

export {
  GRADED_AT_TOLERANCE_MS,
  handleSubmissionGradedEmail,
  parseGradedEmailPayload,
} from "./handlers/submission-graded-email";
export type { GradedEmailPayload } from "./handlers/submission-graded-email";
