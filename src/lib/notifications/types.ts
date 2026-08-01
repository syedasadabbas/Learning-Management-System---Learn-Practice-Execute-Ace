// =============================================================================
// NOTIFICATIONS — TYPES, AND THE ONE MAPPING THAT MUST NOT DRIFT.
// Owner: the email-notifications stream. Import from "@/lib/notifications".
// -----------------------------------------------------------------------------
// WHAT THIS STREAM ADDED, AND — LOUDER — WHAT IT DELIBERATELY DID NOT REBUILD.
//
// IMPLEMENTATION_ROADMAP.md's feature 1 sketches a `NotificationService` that
// sends mail, retries three times with `2^n` second backoff, and records
// pending/sent/failed. Every one of those three mechanisms already exists in this
// repository, built and tested earlier the same day, and building a second copy
// would not be "following the spec" — it would be shipping two mail paths that
// disagree about whether a message has gone out:
//
//   RETRIES + BACKOFF + A DEAD-LETTER STATE  -> src/lib/queue/**. Bounded
//       attempts, backoff in milliseconds, `FOR UPDATE SKIP LOCKED` claiming,
//       leases, and a terminal `dead` state an operator can list at
//       GET /api/admin/jobs?status=dead.
//   "HAS THIS ALREADY BEEN SENT?"            -> src/lib/mail/dispatch.ts +
//       `mail_dispatches`. The decision is taken IN THE DATABASE, BEFORE the
//       transport is called, so the answer survives a lost completion write.
//   THE SCHEDULER                            -> .github/workflows/drain-jobs.yml,
//       every 5 minutes, plus an in-request drain via
//       src/lib/queue/schedule.ts#scheduleDrain.
//   THE TRANSPORT                            -> src/lib/mail/index.ts#getMailer,
//       which falls back to a dev logger when no SMTP is configured (the
//       project's DEFAULT state per FREE_STACK.md).
//
// So this stream contributes exactly three things: two tables
// (src/db/schema.notifications.ts), one new queue KIND with one handler
// (src/lib/queue/handlers/notification-email.ts), and the producers + preference
// gate in this directory. There is no `NotificationService.send()` here, because
// nothing in this directory ever calls a mail transport. Sending is the queue's.
//
// -----------------------------------------------------------------------------
// WHY ONE JOB KIND AND NOT ONE PER EVENT.
//
// The queue's existing kind, `submission_graded_email`, carries a POINTER payload
// (`{ submissionId, gradedAtMs }`) and re-reads the grade at send time, because a
// grade is MUTABLE — an instructor can regrade while the job waits, and a
// snapshot would email a score that no longer exists. That handler's supersede
// guard is specific to that mutability and is not generalisable.
//
// The events this stream produces are the opposite: they are IMMUTABLE FACTS
// ABOUT THE PAST. A quiz attempt row is inserted, never rewritten
// (src/lib/quizzes/service.ts:364-379 inserts a new attempt per submit); an exam
// attempt is finalized once into a terminal status
// (src/lib/grand-quiz/queries.ts#finalizeAttempt short-circuits on
// `already_terminal`); a penalty row is insert-once. "You scored 7/10 on attempt 2"
// cannot become false.
//
// For immutable events the rendered message IS the durable record, so ONE kind —
// `notification_email` — with a payload that points at a `notifications` row
// covers all of them. The alternative, a kind per event, would mean N handlers
// that differ only in which four tables they re-join, N entries in
// ../queue/registry.ts, and N places to get the failure classification wrong. The
// cost of the single kind is stated honestly: it can only send messages whose
// content was correct at record time, which is precisely why
// `submission_graded_email` is left alone rather than folded into it.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import type { NotificationType } from "@/db/schema.notifications";

export type { NotificationType };

/**
 * The queue kind that sends every notification recorded by this stream.
 *
 * A constant rather than a literal at each call site so the string appears once;
 * it must equal the member added to `JOB_KINDS` in src/lib/queue/types.ts, and
 * the compiler enforces that wherever this value is passed to `enqueueJob` or
 * `buildIdempotencyKey`, both of which take `JobKind`.
 */
export const NOTIFICATION_JOB_KIND = "notification_email" as const;

/**
 * The `notification_preferences` column that gates each event type.
 *
 * THIS MAP IS THE ONE PLACE THE OPT-OUT CAN BE GOT WRONG, so it is exhaustive by
 * type (`Record<NotificationType, …>`): adding a label to the `notification_type`
 * pgEnum without deciding which switch controls it is a COMPILE ERROR, not a
 * notification that quietly ignores a student's preference. That failure mode is
 * the reason this is a typed map and not a `camelCase(type)` helper — a helper
 * cannot fail to compile, it just returns `undefined`, and `undefined` read as a
 * boolean means "send it anyway".
 */
export const PREFERENCE_COLUMN_FOR_TYPE = {
  quiz_submitted: "quizSubmitted",
  exam_completed: "examCompleted",
  assignment_feedback: "assignmentFeedback",
  penalty_issued: "penaltyIssued",
  forum_reply: "forumReply",
  badge_earned: "badgeEarned",
  grade_posted: "gradePosted",
  course_message: "courseMessage",
} as const satisfies Record<NotificationType, string>;

export type PreferenceColumn =
  (typeof PREFERENCE_COLUMN_FOR_TYPE)[keyof typeof PREFERENCE_COLUMN_FOR_TYPE];

/**
 * Human labels for the settings UI and the history list.
 *
 * Kept next to the map above rather than in the component, so a new enum label
 * cannot ship with a raw `snake_case` string on a student-facing page.
 */
export const NOTIFICATION_TYPE_LABELS = {
  quiz_submitted: "Quiz submitted",
  exam_completed: "Exam completed",
  assignment_feedback: "Assignment feedback",
  penalty_issued: "Penalty or warning issued",
  forum_reply: "Reply to my forum post",
  badge_earned: "Badge earned",
  grade_posted: "Grade posted",
  course_message: "Message from an instructor",
} as const satisfies Record<NotificationType, string>;

/**
 * What `notifications.metadata` may carry.
 *
 * Every field optional and every field an id or a relative path — no free text.
 * The history page renders at most `url`, and `url` is a RELATIVE path built by
 * this stream (never a value from a request), so a stored metadata blob can never
 * become an off-site link in a page this app renders. That is the whole reason the
 * type exists: jsonb accepts anything, and "the writer was careful" is not a
 * property the reader can check.
 */
export interface NotificationMetadata {
  quizId?: number;
  attemptId?: number;
  weekId?: number;
  submissionId?: number;
  penaltyId?: number;
  /** Relative in-app path, e.g. "/quizzes/3". Rendered as a link by the history UI. */
  url?: string;
}

/** Why a producer wrote nothing. Returned as a value — producers never throw. */
export type NotifySkipReason =
  /** The student has this category switched off. Nothing was recorded or enqueued. */
  | "suppressed_by_preference"
  /** The user row is gone, or carries no email address. Nothing to send to. */
  | "no_recipient"
  /** An equivalent notification already existed. The NORMAL outcome of a replay. */
  | "duplicate"
  /** The database write failed. Logged, swallowed; the business write is unaffected. */
  | "record_failed";

export type NotifyResult =
  | {
      ok: true;
      notificationId: number;
      /** The shared key: `notifications.dedupe_key` = `jobs.idempotency_key`. */
      dedupeKey: string;
      /** False when the queue reported that an equivalent job already existed. */
      enqueued: boolean;
    }
  | { ok: false; reason: NotifySkipReason };
