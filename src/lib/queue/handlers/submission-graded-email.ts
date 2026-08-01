// =============================================================================
// CONSUMER — "your assignment has been graded" email.
// Owner: the async-queues stream. Registered in ../registry.ts.
// -----------------------------------------------------------------------------
// This is the ONE real consumer the queue was built for. See ../types.ts for why
// this work, and not sheet ingestion / leaderboard rebuilds / video harvesting.
//
// THE PAYLOAD IS A POINTER, NOT A SNAPSHOT. It carries `submissionId` and the
// `gradedAtMs` the key was built from, and nothing else that could go stale. The
// score, the stars, the feedback and the student's email address are all re-read
// from the database at SEND time. That matters because a job can sit in the
// queue for minutes across four retries, and during that window an instructor
// can regrade. A snapshot payload would cheerfully email the student a score
// that no longer exists, and the student would have no way to tell which figure
// is real. A pointer can only ever be stale in the direction of "slightly newer
// than the moment that triggered it", which is the harmless direction.
//
// THE `gradedAtMs` GUARD is the other half of that. If `submissions.graded_at`
// has MOVED since this job was enqueued, a regrade has happened, a SECOND job
// exists for the new grade (different idempotency key — see ../keys.ts), and
// this one is obsolete. It reports `succeeded` rather than a failure: nothing
// went wrong, the notification simply no longer needs sending, and dead-lettering
// it would put a non-problem on the operator's dead-letter list.
//
// THE SEND IS DE-DUPLICATED AT THE POINT OF EFFECT, which is the difference
// between this version and the first one. The queue guarantees that one grading
// moment produces one JOB; it cannot guarantee that one job RUNS once, because a
// lease expiring after a lost `completeJob` write reclaims the row on purpose (see
// ../drain.ts). So the send goes through `sendDeduplicated`
// (src/lib/mail/dispatch.ts), keyed on this job's own `idempotencyKey`, and a
// second run of the same job finds the key already marked sent and does nothing.
// That file states what remains unguaranteed; this one does not restate it.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, submissions, users, weeks } from "@/db/schema";
import { POINTS } from "@/lib/contracts/scoring";
import { MAIL_APP_NAME, appOrigin, renderSubmissionGradedMail } from "@/lib/mail";
import {
  INDETERMINATE_RESEND_LIMIT,
  sendDeduplicated,
  type DispatchOutcome,
} from "@/lib/mail/dispatch";

import type { JobOutcome, JobRecord } from "../types";

/** What the producer writes into `jobs.payload`. */
export interface GradedEmailPayload {
  submissionId: number;
  /**
   * `submissions.graded_at` at enqueue time, as epoch milliseconds. Also the
   * second segment of the idempotency key, so the two cannot drift apart.
   */
  gradedAtMs: number;
}

/**
 * Validate a payload read back from jsonb.
 *
 * Hand-rolled rather than zod, deliberately: this runs on the drain path, the
 * shape is two numbers, and the failure has to be classified as PERMANENT (a
 * malformed payload will never become well-formed by waiting) rather than
 * surfaced as a validation error object. A zod schema here would buy nothing but
 * an import.
 */
export function parseGradedEmailPayload(payload: unknown): GradedEmailPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const submissionId = Number(record.submissionId);
  const gradedAtMs = Number(record.gradedAtMs);
  if (!Number.isInteger(submissionId) || submissionId <= 0) return null;
  if (!Number.isFinite(gradedAtMs) || gradedAtMs <= 0) return null;
  return { submissionId, gradedAtMs: Math.trunc(gradedAtMs) };
}

/**
 * How far apart the stored `graded_at` and the payload's `gradedAtMs` may be
 * before this job is treated as superseded.
 *
 * Not zero. Postgres `timestamptz` keeps MICROSECONDS; a JavaScript `Date`
 * keeps milliseconds. A value written as a `Date` and read back is exact today,
 * but a value that ever round-trips through a text representation with
 * microsecond precision would compare unequal by a fraction of a millisecond and
 * every notification would be silently classified as superseded — the queue
 * would appear to work perfectly and send nothing. A 1000 ms window is far below
 * the realistic gap between a grade and its regrade (a human pressing a button
 * twice deliberately) and far above any representation noise.
 */
export const GRADED_AT_TOLERANCE_MS = 1_000;

/**
 * Send the notification.
 *
 * Failure classification, which is the whole reason `JobOutcome` is a value:
 *   - submission missing, not graded, or student has no email  -> `dead`.
 *     None of these becomes true by waiting. Retrying them four more times only
 *     delays the moment they appear on the dead-letter list.
 *   - the mailer reports `ok: false`                            -> `retry`.
 *     Both documented reasons are worth another attempt:
 *     `transport_unavailable` is usually a missing/misconfigured dependency that
 *     a redeploy fixes, and `send_failed` is a refused or dropped message.
 *   - anything thrown                                           -> propagates to
 *     ../drain.ts, which treats an exception as `retry`.
 *
 * NOTE ON WHAT "ok" MEANS HERE. With no SMTP configured — the project's DEFAULT
 * state per FREE_STACK.md — `getMailer()` returns the dev transport, which logs
 * the message and ALWAYS reports success. So on an unconfigured install every
 * job succeeds and nothing is actually delivered. That is the existing, argued
 * behaviour of src/lib/mail/dev.ts (an unconfigured install must not look broken
 * to a student), and it is inherited here rather than re-litigated; the outcome
 * is a queue whose retry path is exercised only when SMTP is genuinely present.
 * Stated plainly because it means a green drain is NOT proof of delivery.
 */
export async function handleSubmissionGradedEmail(job: JobRecord): Promise<JobOutcome> {
  const payload = parseGradedEmailPayload(job.payload);
  if (!payload) {
    return {
      status: "dead",
      error: `Malformed payload for job ${job.id}: expected { submissionId, gradedAtMs }.`,
    };
  }

  const [row] = await db
    .select({
      submissionId: submissions.id,
      score: submissions.score,
      feedback: submissions.feedback,
      stars: submissions.instructorRating,
      status: submissions.status,
      gradedAt: submissions.gradedAt,
      studentName: users.name,
      studentEmail: users.email,
      assignmentTitle: assignments.title,
      weekId: weeks.id,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    .where(eq(submissions.id, payload.submissionId))
    .limit(1);

  if (!row) {
    return {
      status: "dead",
      error: `Submission ${payload.submissionId} no longer exists.`,
    };
  }

  if (!row.gradedAt) {
    // The grade was withdrawn (status reset) between enqueue and drain. Nothing
    // to tell the student about, and it will not come back on this job's key.
    return {
      status: "dead",
      error: `Submission ${payload.submissionId} is no longer graded; notification dropped.`,
    };
  }

  const drift = Math.abs(row.gradedAt.getTime() - payload.gradedAtMs);
  if (drift > GRADED_AT_TOLERANCE_MS) {
    // Superseded by a regrade, which enqueued its own job. Not a failure.
    return {
      status: "succeeded",
      detail:
        `Superseded: submission ${payload.submissionId} was regraded ` +
        `${drift} ms away from this job's grading moment.`,
    };
  }

  const email = row.studentEmail?.trim();
  if (!email) {
    return {
      status: "dead",
      error: `Student for submission ${payload.submissionId} has no email address.`,
    };
  }

  const rendered = renderSubmissionGradedMail({
    name: row.studentName ?? null,
    assignmentTitle: row.assignmentTitle,
    // `instructor_rating` is nullable in the schema even though the grade path
    // always writes it. Clamped rather than trusted, because the template repeats
    // the value as a star string and a null would render "NaN".
    stars: clampStars(row.stars),
    score: row.score ?? 0,
    maxScore: POINTS.ASSIGNMENT_MAX,
    feedback: row.feedback,
    url: `${appOrigin()}/assignments/${row.weekId}`,
    appName: MAIL_APP_NAME,
  });

  // THE SEND GOES THROUGH THE LEDGER, not straight at the transport.
  //
  // `job.idempotencyKey` is passed as the dedupe key so the "one job per grading
  // moment" guarantee (jobs_idempotency_key_idx) and the "one message per grading
  // moment" guarantee (mail_dispatches_dedupe_key_idx) are keyed on ONE string.
  // Deriving a second key here would be two things to keep in step.
  //
  // What this closes: a handler that ran successfully and whose `completeJob` then
  // failed used to be retried after its lease expired and send the email a second
  // time — logged loudly by ../drain.ts and otherwise unfixed. The retry now finds
  // a ledger row saying "already sent" and reports success without sending. Read
  // src/lib/mail/dispatch.ts for the full argument and, importantly, for what is
  // still NOT guaranteed.
  const dispatch = await sendDeduplicated({
    dedupeKey: job.idempotencyKey,
    message: {
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    },
  });

  return classifyDispatch(dispatch, payload.submissionId);
}

/**
 * Map a `DispatchOutcome` onto a `JobOutcome`.
 *
 * Separated out and exported so ./submission-graded-email.test.ts can assert every
 * branch as a table, rather than six near-identical tests that each have to build
 * a submission row first. The mapping IS the interesting part of this handler now:
 * two of the six branches mean "do not retry this", and getting either of them
 * wrong reintroduces the double-send.
 */
export function classifyDispatch(
  dispatch: DispatchOutcome,
  submissionId: number,
): JobOutcome {
  switch (dispatch.status) {
    case "sent":
      return {
        status: "succeeded",
        detail: `Sent via ${dispatch.transport} to submission ${submissionId}'s student (${dispatch.messageId}).`,
      };

    case "already_sent":
      // NOT a failure and NOT a no-op to hide. The work this job exists to do has
      // been done — by a previous run of this same job whose completion write was
      // lost. Reporting success is what stops the retry loop that would otherwise
      // send a second email on every lease expiry.
      return {
        status: "succeeded",
        detail:
          `Already sent for submission ${submissionId}; de-duplicated by the mail ` +
          `dispatch ledger (message ${dispatch.messageId ?? "unknown"}). No second email.`,
      };

    case "resent_after_unknown":
      // Succeeded, but say plainly in `last_error`-adjacent detail that a duplicate
      // is possible. This is the at-least-once half of the guarantee being exercised.
      return {
        status: "succeeded",
        detail:
          `Re-sent for submission ${submissionId} after an earlier send whose outcome ` +
          `was never recorded. THE STUDENT MAY HAVE RECEIVED TWO COPIES; both carry ` +
          `Message-ID ${dispatch.messageId}, so a client that de-duplicates on it may ` +
          `show one.`,
      };

    case "failed":
      // Definite transport failure. Both documented reasons are worth another go,
      // which is the same classification this handler always made.
      return {
        status: "retry",
        error: `Mail transport ${dispatch.transport} reported ${dispatch.reason}: ${dispatch.detail ?? "no detail"}`,
      };

    case "ledger_unavailable":
      // NOTHING WAS SENT — this is the safe failure the ledger's write-first order
      // buys. An ordinary retry cannot duplicate anything.
      return {
        status: "retry",
        error: `Mail dispatch ledger unavailable, so nothing was sent: ${dispatch.error}`,
      };

    case "unknown_exhausted":
      // DEAD, deliberately, and this is the one branch that trades a possible
      // missing email for a certain non-duplicate. The ledger says a send was
      // started INDETERMINATE_RESEND_LIMIT times and never reported an outcome;
      // the machine has run out of information and a human has to look at the
      // relay's log. Retrying here is how one flapping relay becomes five copies.
      return {
        status: "dead",
        error:
          `Submission ${submissionId}: ${dispatch.attempts} send attempt(s) were started ` +
          `and none reported an outcome (limit ${INDETERMINATE_RESEND_LIMIT}). It is NOT ` +
          `known whether the student received this email. Check the relay log for the ` +
          `derived Message-ID before requeueing; see mail_dispatches.`,
      };
  }
}

function clampStars(stars: number | null): number {
  if (stars == null || !Number.isFinite(stars)) return 0;
  return Math.min(5, Math.max(0, Math.trunc(stars)));
}
