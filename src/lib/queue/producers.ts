// =============================================================================
// PRODUCERS — the call sites that put work on the queue.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// Kept in one file rather than scattered next to their callers so that "what can
// enqueue work" is answerable by reading one screen, and so that every producer
// is forced through ./keys.ts instead of assembling an idempotency key inline.
//
// EVERY PRODUCER HERE IS NON-THROWING BY CONTRACT. They are called from paths
// that have already committed the business write — a grade is saved before its
// notification is enqueued — and a queue failure must never be able to fail, or
// appear to fail, an operation that already succeeded. Same argument, same
// shape, as src/lib/leaderboard/on-scoring-event.ts.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { submissions } from "@/db/schema";

import type { GradedEmailPayload } from "./handlers/submission-graded-email";
import { gradedNotificationKey } from "./keys";
import { scheduleDrain } from "./schedule";
import { enqueueJob, type EnqueueResult } from "./store";

/** Why an enqueue produced no job. Returned rather than thrown — see the header. */
export type EnqueueSkipReason = "not_graded" | "submission_missing" | "enqueue_failed";

export type ProduceResult =
  | (EnqueueResult & { ok: true })
  | { ok: false; reason: EnqueueSkipReason };

/**
 * Queue the "your assignment has been graded" email for one submission.
 *
 * Call it AFTER the grading transaction has committed. See
 * ./keys.ts#gradedNotificationKey for why the idempotency key is scoped to
 * (submission, graded_at) rather than to the submission alone — that choice is
 * what makes a double-clicked Save produce one email and a genuine regrade
 * produce two.
 *
 * THE `gradedAt` READ, AND ITS COST, stated rather than hidden. When the caller
 * does not already hold the timestamp the grading transaction wrote, this
 * function reads it back: one primary-key lookup, which src/db/index.ts measures
 * at roughly 245 ms of network round trip on this Neon instance. That is a real
 * addition to an instructor's grading request and it was weighed against the
 * alternatives:
 *   - stamping the key with `Date.now()` at enqueue time makes every enqueue
 *     unique, so the unique index never fires and there is no idempotency at all;
 *   - keying on the submission id alone means a regrade never notifies the
 *     student, silently;
 *   - having `gradeSubmission` RETURN its `graded_at` would remove the read
 *     entirely and is the right long-term fix, but src/lib/submissions/** and
 *     src/lib/instructor/** belong to other streams.
 *   TODO(queue): once `gradeSubmission`/`recordGrade` return `gradedAt`, pass it
 *   in and this read disappears. Flagged to the submissions stream.
 * Callers that DO know the timestamp pass it and pay nothing.
 *
 * Returns a result rather than throwing. `created: false` is the NORMAL outcome
 * of a double-clicked Save and is not logged as a problem.
 */
export async function enqueueGradedNotification(input: {
  submissionId: number;
  /** `submissions.graded_at` as written by the grading transaction, when known. */
  gradedAt?: Date | null;
  /**
   * Whether to also try to run the queue in this same invocation. Defaults to
   * true. See ./schedule.ts for what that does and does not guarantee.
   */
  drain?: boolean;
}): Promise<ProduceResult> {
  try {
    let gradedAt = input.gradedAt ?? null;

    if (!gradedAt) {
      const [row] = await db
        .select({ gradedAt: submissions.gradedAt })
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!row) return { ok: false, reason: "submission_missing" };
      gradedAt = row.gradedAt;
    }

    if (!gradedAt) {
      // Not graded. Nothing to tell the student, and no stable key to build:
      // `graded_at` IS the second half of the idempotency key.
      return { ok: false, reason: "not_graded" };
    }

    const gradedAtMs = gradedAt.getTime();
    const payload: GradedEmailPayload = { submissionId: input.submissionId, gradedAtMs };

    const result = await enqueueJob({
      kind: "submission_graded_email",
      idempotencyKey: gradedNotificationKey({ submissionId: input.submissionId, gradedAtMs }),
      payload: { ...payload },
    });

    // Only when THIS call created the row. A duplicate submit should not also
    // buy a second drain — the first one already scheduled it.
    if (result.created && (input.drain ?? true)) {
      scheduleDrain();
    }

    return { ok: true, ...result };
  } catch (error) {
    // Swallowed ON PURPOSE — see the file header. The grade is already saved and
    // the instructor has already been told so; a queue write failure here means
    // one missing email, which is recoverable (regrade, or an operator INSERT),
    // and must not become a 500 on a request whose work is done.
    console.error(
      `[queue] failed to enqueue the graded notification for submission ` +
        `${input.submissionId}. The grade IS saved; the student will not receive ` +
        `an email for this grading round.`,
      error,
    );
    return { ok: false, reason: "enqueue_failed" };
  }
}
