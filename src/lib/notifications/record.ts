// =============================================================================
// RECORD-AND-ENQUEUE — the one write path every notification goes through.
// Owner: the email-notifications stream. Import from "@/lib/notifications".
// -----------------------------------------------------------------------------
// THE ORDER OF THE TWO WRITES IS THE DESIGN, so it is argued rather than stated.
//
//   1. INSERT the `notifications` row  (ON CONFLICT (dedupe_key) DO NOTHING)
//   2. enqueue the `notification_email` job on the SAME key
//
// HISTORY FIRST, JOB SECOND, and never the other way round:
//
//   * if step 1 fails, nothing exists and nothing has been promised. The caller
//     gets `{ ok: false, reason: "record_failed" }`, the business write it already
//     committed is untouched, and one log line says which student missed which
//     notification. Recoverable by an operator INSERT.
//   * if step 2 fails, the row exists at `status='pending'` — VISIBLE. It is on
//     the student's history page and in
//     `select * from notifications where status = 'pending' and created_at < now() - interval '1 hour'`,
//     which is a query an operator can run. The message is late, not lost, and the
//     repair is re-enqueueing the same key.
//   * the reverse order would produce the inverse: a job pointing at a
//     `notifications` row that does not exist, which the handler can only
//     dead-letter. A dead-lettered job with nothing behind it is the one failure
//     shape nobody can act on.
//
// NEITHER WRITE IS IN THE CALLER'S TRANSACTION, and that is deliberate for the
// reason src/lib/queue/store.ts#enqueueJob states in its own header: inside the
// transaction these two writes would be atomic with the business write, but then a
// notification failure would roll back the student's quiz submission or the
// instructor's penalty. That inverts the priority. Outside, the worst case is a
// committed event with no notification, which is recoverable and does not lose the
// work anybody was actually waiting on.
//
// THE PREFERENCE GATE IS BEFORE BOTH WRITES. A student who has switched a category
// off produces no row, no job and no drain — not a row marked `suppressed`. The
// argument is cost plus honesty: writing a history row for a message the student
// asked not to receive turns their own opt-out into a list of things they opted out
// of, which nobody asked for, and it costs a table write plus a queue write plus a
// drain slot per event. The narrow case where the switch flips AFTER the enqueue is
// caught by the handler's re-check and IS recorded as `suppressed`, because there
// the row already exists and silently deleting it would be worse.
//
// NOTHING HERE THROWS. Producers are called from paths that have already committed
// (see ./producers.ts), so every failure is a value.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notifications } from "@/db/schema.notifications";
import { enqueueJob } from "@/lib/queue/store";
import { scheduleDrain } from "@/lib/queue/schedule";

import { isEnabled, resolvePreferencesOrDefault } from "./preferences";
import {
  NOTIFICATION_JOB_KIND,
  type NotificationMetadata,
  type NotificationType,
  type NotifyResult,
} from "./types";

/** Drizzle client. Injectable so the unit tests do not need a database. */
type Client = typeof db;

/** What `jobs.payload` carries for a `notification_email` job. */
export interface NotificationEmailPayload {
  /** `notifications.id`. A POINTER — the message text lives on the row. */
  notificationId: number;
}

export interface RecordNotificationInput {
  userId: number;
  type: NotificationType;
  /** From ./keys.ts. Becomes `notifications.dedupe_key` AND `jobs.idempotency_key`. */
  dedupeKey: string;
  recipientEmail: string;
  subject: string;
  /** The PLAIN-TEXT part. The HTML part is re-rendered at send time. */
  body: string;
  metadata?: NotificationMetadata;
  /**
   * Skip the preference read — for a caller that has already resolved
   * preferences for this student (a producer notifying about several penalties
   * from one ingest run reads once and passes `true` for each).
   */
  preferenceAlreadyChecked?: boolean;
  /**
   * Also drain in this request. Defaults to true, matching
   * src/lib/queue/producers.ts. Set false in a script or a loop that would
   * otherwise schedule one drain per row.
   */
  drain?: boolean;
}

/**
 * Record one notification and queue its email.
 *
 * Returns `{ ok: false, reason: "duplicate" }` when an equivalent notification
 * already existed. THAT IS A NORMAL OUTCOME, not an error: it is what a replayed
 * exam finalize (the cron sweeper racing the student's own submit) or a
 * re-ingested penalty produces, and it is the reason the dedupe key exists. No
 * caller should log it as a problem.
 */
export async function recordAndEnqueue(
  input: RecordNotificationInput,
  client: Client = db,
): Promise<NotifyResult> {
  const recipient = input.recipientEmail.trim();
  if (!recipient) return { ok: false, reason: "no_recipient" };

  if (!input.preferenceAlreadyChecked) {
    const preferences = await resolvePreferencesOrDefault(input.userId, client);
    if (!isEnabled(preferences, input.type)) {
      return { ok: false, reason: "suppressed_by_preference" };
    }
  }

  // -------------------------------------------------------------------------
  // 1. HISTORY. `ON CONFLICT (dedupe_key) DO NOTHING` names the unique index
  //    explicitly, exactly as src/lib/queue/store.ts#enqueueJob does: an
  //    untargeted conflict clause would also swallow a primary-key collision and
  //    report it as a successful de-duplication.
  // -------------------------------------------------------------------------
  let notificationId: number;
  try {
    const inserted = await client
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        dedupeKey: input.dedupeKey,
        // Truncated to the column width rather than allowed to raise: an
        // over-long address is a data problem, not a reason to lose the message.
        // Same call the mail ledger makes (src/lib/mail/dispatch.ts#claimDispatch).
        recipientEmail: recipient.slice(0, 320),
        subject: input.subject.slice(0, 255),
        body: input.body,
        metadata: input.metadata ?? null,
        status: "pending",
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });

    if (inserted.length === 0) {
      // Somebody already recorded this event. Do NOT enqueue a second job — the
      // first record's job owns the send, and the queue's own unique index would
      // discard it anyway. Reported as a distinct reason so a caller can tell
      // "already handled" from "refused".
      return { ok: false, reason: "duplicate" };
    }

    notificationId = inserted[0].id;
  } catch (error) {
    console.error(
      `[notifications] could not record a ${input.type} notification for user ` +
        `${input.userId} (key ${input.dedupeKey}). NOTHING was enqueued and the ` +
        `student will not be emailed about this event. The event itself is saved.`,
      error,
    );
    return { ok: false, reason: "record_failed" };
  }

  // -------------------------------------------------------------------------
  // 2. THE JOB. Same key as the row above and as the mail ledger will use, so
  //    "one history row / one job / one message per event" are one string.
  // -------------------------------------------------------------------------
  const payload: NotificationEmailPayload = { notificationId };
  let enqueued = false;
  try {
    const result = await enqueueJob(
      {
        kind: NOTIFICATION_JOB_KIND,
        idempotencyKey: input.dedupeKey,
        payload: { ...payload },
      },
      client,
    );
    enqueued = result.created;

    // Only when THIS call created the job. A duplicate must not buy a second
    // drain — the first already scheduled one (src/lib/queue/producers.ts:105).
    if (result.created && (input.drain ?? true)) scheduleDrain();
  } catch (error) {
    // The row survives at `status='pending'`, which is the visible-and-repairable
    // failure the write order was chosen for. See the file header.
    console.error(
      `[notifications] recorded notification ${notificationId} (key ${input.dedupeKey}) ` +
        `but FAILED to enqueue its email job. The row stays 'pending' and is ` +
        `visible on the student's history and to an operator; re-enqueueing the ` +
        `same key repairs it.`,
      error,
    );
  }

  return { ok: true, notificationId, dedupeKey: input.dedupeKey, enqueued };
}

/**
 * Validate a `notification_email` payload read back from jsonb.
 *
 * Hand-rolled rather than zod for the reason
 * src/lib/queue/handlers/submission-graded-email.ts#parseGradedEmailPayload gives:
 * this runs on the drain path, the shape is one number, and the failure must be
 * classified as PERMANENT — a malformed payload does not become well-formed by
 * waiting — rather than surfaced as a validation error object.
 */
export function parseNotificationEmailPayload(
  payload: unknown,
): NotificationEmailPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const id = Number((payload as Record<string, unknown>).notificationId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { notificationId: id };
}

/** The columns the queue handler needs. Selected explicitly, never `select()`. */
export async function loadNotificationForSend(id: number, client: Client = db) {
  const [row] = await client
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      dedupeKey: notifications.dedupeKey,
      recipientEmail: notifications.recipientEmail,
      subject: notifications.subject,
      body: notifications.body,
      status: notifications.status,
      metadata: notifications.metadata,
    })
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Move a row to a terminal state.
 *
 * `sent_at` is written by the DATABASE's clock (`now()` via drizzle's `defaultNow`
 * is not available on an UPDATE, so the value is passed — see the note below), for
 * the reason src/lib/queue/store.ts's "ONE CLOCK" header gives: every timestamp
 * this system compares must come from one clock. `sent_at` is NOT compared against
 * anything by any query today, so a JS `Date` here is a display value rather than a
 * scheduling input, and the honest statement is that it is accurate to whatever the
 * app clock says — measured ~1_080 ms ahead of the Neon instance on the machine
 * where that drift was diagnosed.
 * TODO(notifications): if a digest producer is ever written it will compare
 * `sent_at` to `now()`, and this must become `sql`now()`` at that point.
 */
export async function markNotificationSent(
  id: number,
  client: Client = db,
): Promise<void> {
  await client
    .update(notifications)
    .set({ status: "sent", sentAt: new Date(), failureReason: null, updatedAt: new Date() })
    .where(eq(notifications.id, id));
}

/** Record a definite failure. `reason` is a diagnostic and is never shown to the student. */
export async function markNotificationFailed(
  id: number,
  reason: string,
  client: Client = db,
): Promise<void> {
  await client
    .update(notifications)
    .set({
      status: "failed",
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id));
}

/**
 * Record a failure that is NOT terminal, keeping the row `pending`.
 *
 * The queue still has attempts left, so the notification is late rather than
 * failed. Writing `status='failed'` here would tell the student "we could not
 * reach you" while a retry is scheduled inside the backoff window, and would put a
 * row on an operator's failure list that is not yet a failure. The reason is stored
 * anyway, because "pending with a last error" is the state that distinguishes
 * "waiting for its first drain" from "the relay refused it twice".
 */
export async function noteNotificationRetry(
  id: number,
  reason: string,
  client: Client = db,
): Promise<void> {
  await client
    .update(notifications)
    .set({ failureReason: reason.slice(0, 500), updatedAt: new Date() })
    .where(eq(notifications.id, id));
}

/**
 * Record that the student turned this category off after the job was enqueued.
 *
 * A distinct status rather than `failed`, argued on the enum in
 * src/db/schema.notifications.ts: an operator triaging failures must not have to
 * sift opt-outs out of relay errors.
 */
export async function markNotificationSuppressed(
  id: number,
  client: Client = db,
): Promise<void> {
  await client
    .update(notifications)
    .set({
      status: "suppressed",
      failureReason: "The student switched this category off before it was sent.",
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id));
}
