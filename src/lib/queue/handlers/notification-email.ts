// =============================================================================
// CONSUMER — the generic notification email. Registered in ../registry.ts.
// Owner: the email-notifications stream (roadmap PHASE 1 feature 1).
// -----------------------------------------------------------------------------
// THE SECOND KIND THIS QUEUE HAS, and the reason it is one kind rather than three
// is argued in src/lib/notifications/types.ts: every event it carries (quiz
// submitted, exam completed, penalty issued) is an IMMUTABLE FACT ABOUT THE PAST,
// so the rendered message can be recorded once and sent from the record. The
// existing `submission_graded_email` kind is deliberately NOT folded into this one
// — a grade is mutable between enqueue and drain, which is why that handler carries
// a pointer payload and re-reads the score with a supersede guard.
//
// WHAT THIS HANDLER DOES NOT DO, because it is already done elsewhere:
//   * it does not retry. ../policy.ts decides backoff and when to dead-letter.
//   * it does not decide whether the message has already gone out.
//     src/lib/mail/dispatch.ts does, in the database, before the transport is
//     called, keyed on THIS JOB'S OWN `idempotencyKey` — the same string as
//     `notifications.dedupe_key`. So a job re-claimed after a lost `completeJob`
//     write finds the key already marked sent and sends nothing.
//   * it does not choose a transport. src/lib/mail/index.ts#getMailer does.
//
// THE PAYLOAD IS A POINTER TO A `notifications` ROW, and that row is the message.
// The alternative — carrying the subject and body in `jobs.payload` — was rejected
// for two reasons: the student-facing history would then be a second copy that can
// disagree with what was sent, and a jsonb payload holding a 2 kB body makes the
// queue table the largest table in the database for no gain.
//
// PREFERENCES ARE RE-CHECKED HERE even though the producer already checked them.
// The window is real: a job enqueued at 09:00:00 may not drain until the cron tick
// at 09:05 (.github/workflows/drain-jobs.yml runs every 5 minutes), and a student
// who switches a category off inside that window has asked not to receive THIS
// message. The re-check costs one indexed read on a path nobody is waiting on, and
// it is the only thing that makes the settings page's promise true for mail already
// in flight.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import {
  INDETERMINATE_RESEND_LIMIT,
  sendDeduplicated,
  type DispatchOutcome,
} from "@/lib/mail/dispatch";
import {
  loadNotificationForSend,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSuppressed,
  noteNotificationRetry,
  parseNotificationEmailPayload,
} from "@/lib/notifications/record";
import { isEnabledFor } from "@/lib/notifications/preferences";

import type { JobOutcome, JobRecord } from "../types";

export async function handleNotificationEmail(job: JobRecord): Promise<JobOutcome> {
  const payload = parseNotificationEmailPayload(job.payload);
  if (!payload) {
    return {
      status: "dead",
      error: `Malformed payload for job ${job.id}: expected { notificationId }.`,
    };
  }

  const row = await loadNotificationForSend(payload.notificationId);
  if (!row) {
    // The row is the message. Without it there is nothing to send and nothing to
    // reconstruct, and waiting will not bring it back — a deleted user cascades
    // their notifications away (schema.notifications.ts, `onDelete: "cascade"`).
    return {
      status: "dead",
      error: `Notification ${payload.notificationId} no longer exists; nothing to send.`,
    };
  }

  // -------------------------------------------------------------------------
  // THE KEY MUST MATCH. `jobs.idempotency_key` and `notifications.dedupe_key`
  // carry the same string by construction (src/lib/notifications/record.ts writes
  // both from one value). If they ever differ, the send would be de-duplicated
  // against a DIFFERENT message's ledger row — the one failure mode that could
  // suppress a real email or duplicate one — so it is refused loudly rather than
  // papered over by preferring one of the two.
  // -------------------------------------------------------------------------
  if (row.dedupeKey !== job.idempotencyKey) {
    return {
      status: "dead",
      error:
        `Notification ${row.id} carries dedupe_key ${row.dedupeKey} but job ${job.id} ` +
        `carries idempotency_key ${job.idempotencyKey}. These must be one string; ` +
        `sending would de-duplicate against the wrong mail_dispatches row.`,
    };
  }

  if (row.status === "sent") {
    // Recorded as sent by a previous run whose `completeJob` write was lost. Not a
    // failure and not a no-op to hide: the work is done, and reporting success is
    // what stops the retry loop. (The mail ledger would also catch this; this check
    // saves the round trip.)
    return {
      status: "succeeded",
      detail: `Notification ${row.id} was already recorded as sent. No second email.`,
    };
  }

  if (row.status === "suppressed") {
    return {
      status: "succeeded",
      detail: `Notification ${row.id} was suppressed by the student's preferences.`,
    };
  }

  // The late opt-out. See the file header for why this is re-read here.
  if (!(await isEnabledFor(row.userId, row.type))) {
    await markNotificationSuppressed(row.id).catch(() => {
      // A failed status write must not turn an opt-out into a sent email. The job
      // reports success either way; the row keeps whatever status it had, and the
      // next run of this job (there is none — this is terminal) would re-check.
    });
    return {
      status: "succeeded",
      detail:
        `Notification ${row.id} was NOT sent: the student switched ` +
        `${row.type} off after it was queued.`,
    };
  }

  // -------------------------------------------------------------------------
  // THE SEND. Text only, and that is deliberate rather than an omission.
  //
  // `notifications.body` stores the PLAIN-TEXT part, because storing the HTML part
  // would put a rendered markup blob in the database that some future page renders
  // with `dangerouslySetInnerHTML` (src/db/schema.notifications.ts argues this on
  // the column). Re-rendering the HTML here is not possible either: the template
  // needs the event's numbers, and the pointer payload deliberately does not carry
  // them. So the message goes out as text/plain — which every client renders, which
  // spam filters prefer to HTML-only mail (the reason src/lib/mail/types.ts makes
  // text mandatory and html optional in the first place), and which is
  // byte-identical to the history the student can read in the app.
  // TODO(notifications): if these messages need HTML, the honest fix is a second
  // column holding the rendered HTML plus a renderer that never interpolates it
  // into a page — not re-deriving it here from data this job does not have.
  // -------------------------------------------------------------------------
  const dispatch = await sendDeduplicated({
    dedupeKey: job.idempotencyKey,
    message: { to: row.recipientEmail, subject: row.subject, text: row.body },
  });

  return applyDispatch(dispatch, row.id, job);
}

/**
 * Map a `DispatchOutcome` onto a `JobOutcome`, and record the result on the row.
 *
 * Exported so ./notification-email.test.ts can assert all six branches as a table
 * rather than provoking each one through a mocked transport. The mapping IS the
 * interesting logic: two of the six mean "do not retry this", and getting either
 * wrong reintroduces a double-send.
 *
 * WHY `failed` DOES NOT ALWAYS SET status='failed'. A transport failure with
 * attempts left is not a terminal state for the notification — the queue will try
 * again within the backoff window — so the row keeps `status='pending'` and records
 * the reason. Marking it `failed` on the first refusal would show the student "we
 * could not tell you" while a retry is still pending, and would put a row on an
 * operator's failure list that is not yet a failure. `attempts` is compared against
 * `maxAttempts` here because ../store.ts#claimJobs increments `attempts` AT CLAIM
 * TIME, so inside a handler `job.attempts` already counts this run.
 */
export async function applyDispatch(
  dispatch: DispatchOutcome,
  notificationId: number,
  job: Pick<JobRecord, "attempts" | "maxAttempts">,
): Promise<JobOutcome> {
  const lastChance = job.attempts >= job.maxAttempts;

  switch (dispatch.status) {
    case "sent":
      await markNotificationSent(notificationId).catch(logStatusWriteFailure(notificationId));
      return {
        status: "succeeded",
        detail: `Sent notification ${notificationId} via ${dispatch.transport} (${dispatch.messageId}).`,
      };

    case "already_sent":
      // The ledger says a previous run already sent it. Bring the row into line so
      // the student's history does not sit at "pending" forever for a message that
      // is in their inbox.
      await markNotificationSent(notificationId).catch(logStatusWriteFailure(notificationId));
      return {
        status: "succeeded",
        detail:
          `Notification ${notificationId} was already sent; de-duplicated by the mail ` +
          `dispatch ledger (message ${dispatch.messageId ?? "unknown"}). No second email.`,
      };

    case "resent_after_unknown":
      await markNotificationSent(notificationId).catch(logStatusWriteFailure(notificationId));
      return {
        status: "succeeded",
        detail:
          `Re-sent notification ${notificationId} after an earlier send whose outcome was ` +
          `never recorded. THE STUDENT MAY HAVE RECEIVED TWO COPIES; both carry ` +
          `Message-ID ${dispatch.messageId}, so a client that de-duplicates on it may show one.`,
      };

    case "failed": {
      const reason = `Mail transport ${dispatch.transport} reported ${dispatch.reason}: ${dispatch.detail ?? "no detail"}`;
      if (lastChance) {
        await markNotificationFailed(notificationId, reason).catch(
          logStatusWriteFailure(notificationId),
        );
      } else {
        await noteNotificationRetry(notificationId, reason).catch(
          logStatusWriteFailure(notificationId),
        );
      }
      return { status: "retry", error: reason };
    }

    case "ledger_unavailable": {
      // NOTHING WAS SENT — the safe failure the ledger's write-first order buys. An
      // ordinary retry cannot duplicate anything.
      const reason = `Mail dispatch ledger unavailable, so nothing was sent: ${dispatch.error}`;
      if (lastChance) {
        await markNotificationFailed(notificationId, reason).catch(
          logStatusWriteFailure(notificationId),
        );
      } else {
        await noteNotificationRetry(notificationId, reason).catch(
          logStatusWriteFailure(notificationId),
        );
      }
      return { status: "retry", error: reason };
    }

    case "unknown_exhausted": {
      // DEAD deliberately: the ledger says a send was STARTED
      // INDETERMINATE_RESEND_LIMIT times and never reported an outcome, so whether
      // the student received it is unknown and retrying is how one flapping relay
      // becomes five copies. The row is marked failed because, from the student's
      // history's point of view, the system cannot claim it was sent.
      const reason =
        `${dispatch.attempts} send attempt(s) were started and none reported an outcome ` +
        `(limit ${INDETERMINATE_RESEND_LIMIT}). It is NOT known whether this reached the ` +
        `student. Check the relay log for the derived Message-ID before requeueing; see ` +
        `mail_dispatches.`;
      await markNotificationFailed(notificationId, reason).catch(
        logStatusWriteFailure(notificationId),
      );
      return { status: "dead", error: `Notification ${notificationId}: ${reason}` };
    }
  }
}

/**
 * A status write failing must never change the job's outcome.
 *
 * The mail ledger — not this column — is the authority on whether a message went
 * out (src/lib/mail/dispatch.ts). `notifications.status` is the student-facing and
 * operator-facing VIEW of it, so losing the write costs a stale row and one error
 * line, and must not cost a duplicate email by turning a successful send into a
 * retry.
 */
function logStatusWriteFailure(notificationId: number) {
  return (error: unknown) => {
    console.error(
      `[notifications] could not update the status of notification ${notificationId}. ` +
        `The send outcome above stands — mail_dispatches is the authority — but the ` +
        `row may show a stale status on the student's history page.`,
      error,
    );
  };
}
