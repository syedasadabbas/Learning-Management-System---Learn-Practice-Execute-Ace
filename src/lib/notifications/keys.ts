// =============================================================================
// NOTIFICATION IDEMPOTENCY KEYS — pure. No database, no clock, no hashing.
// Owner: the email-notifications stream.
// -----------------------------------------------------------------------------
// Built ON TOP of src/lib/queue/keys.ts#buildIdempotencyKey rather than beside it.
// That file already refuses an empty scope, refuses a non-integer id, refuses a
// segment containing editable text, and refuses a key wider than the 200-character
// column — and its header explains at length why hashing a long scope is worse
// than throwing at the producer. Re-deriving any of that here would be a second
// set of rules to keep in step with the same three columns
// (`jobs.idempotency_key`, `mail_dispatches.dedupe_key`,
// `notifications.dedupe_key`), all of which hold the SAME STRING for one event.
//
// WHAT THIS FILE ADDS is the product decision that file cannot make: what "the
// same notification" MEANS for each event. Get that wrong and you get either
// duplicate email (scope too narrow) or silently suppressed email (scope too
// wide) — the two failures argued in ../queue/keys.ts's header.
//
// EVERY KEY HERE IS SCOPED TO A ROW THAT IS WRITTEN ONCE AND NEVER REWRITTEN, and
// therefore needs NO timestamp segment. That is the substantive difference from
// `gradedNotificationKey`, which must carry `graded_at` because a submission is
// regradeable in place. Evidence for each, so this is checkable rather than
// asserted:
//
//   quiz_submitted  — src/lib/quizzes/service.ts INSERTs a new `quiz_attempts`
//                     row per submit (~line 364) and never UPDATEs an existing
//                     one; attempt 2 is a different id from attempt 1. So the
//                     attempt id alone identifies one submission event forever.
//   exam_completed  — src/lib/grand-quiz/queries.ts#finalizeAttempt takes the row
//                     `FOR UPDATE` and SHORT-CIRCUITS when the status is already
//                     terminal (`already_terminal`), so `submitted_at` is written
//                     exactly once per attempt. All three finalize triggers —
//                     the student's own submit, the lazy finalize on read, and
//                     the cron sweeper /api/cron/finalize-exams — converge on that
//                     one function, which is why one key covers all three and the
//                     sweeper cannot produce a second email for an exam the
//                     student already submitted.
//   penalty_issued  — a `penalties` row is inserted once; resolving one sets
//                     `resolved_at` on the same row rather than inserting another.
//
// The consequence, stated plainly: if a row's id is ever REUSED (it cannot be —
// they are `serial`), or if an event is genuinely re-notified on purpose, these
// keys will suppress the second message. That is the intended trade: for facts
// about the past, one message is the correct number.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { buildIdempotencyKey } from "@/lib/queue/keys";

import { NOTIFICATION_JOB_KIND, type NotificationType } from "./types";

/**
 * The key for one notification of one type about one row.
 *
 * THE TYPE IS A SCOPE SEGMENT, and it has to be. Every notification this stream
 * produces shares the single queue kind `notification_email` (see ./types.ts for
 * why), so the kind prefix alone no longer distinguishes two events — and the
 * subject ids come from DIFFERENT tables whose `serial` sequences are independent.
 * Without the type segment, `quiz_attempts` id 41 and `penalties` id 41 would mint
 * the identical key, the unique index would fire, and the second notification would
 * be discarded as a duplicate. A student would silently never hear about their
 * penalty because somebody else's quiz attempt happened to have the same id.
 *
 * The resulting shape is `notification_email:<type>:<subjectId>`, e.g.
 * `notification_email:quiz_submitted:41` — 39 characters, well inside the
 * 200-character column, and readable in a log without decoding.
 */
export function notificationKey(type: NotificationType, subjectId: number): string {
  return buildIdempotencyKey(NOTIFICATION_JOB_KIND, [type, subjectId]);
}

/** "The student has been told they submitted quiz attempt A." */
export function quizSubmittedKey(attemptId: number): string {
  return notificationKey("quiz_submitted", attemptId);
}

/** "The student has been told exam attempt A was completed and scored." */
export function examCompletedKey(attemptId: number): string {
  return notificationKey("exam_completed", attemptId);
}

/** "The student has been told about penalty P." */
export function penaltyIssuedKey(penaltyId: number): string {
  return notificationKey("penalty_issued", penaltyId);
}

/**
 * "Reviewer R has been told about the peer reviews they were assigned in round D."
 *
 * ADDED BY THE PEER-REVIEW STREAM (roadmap feature 6), and it carries an EXTRA
 * SCOPE SEGMENT that no other key in this file has. That is the whole reason it is
 * a function here rather than a `notificationKey("course_message", id)` call at the
 * producer:
 *
 * WHY IT REUSES THE `course_message` TYPE. Peer review needs no new
 * `notification_type` label. Adding one would mean `ALTER TYPE ... ADD VALUE` plus a
 * new `notification_preferences` column plus entries in two exhaustive maps in
 * ./types.ts and in `PREFERENCE_DEFAULTS`/`fromRow` in ./preferences.ts — and the
 * whole add-on wave generates exactly ONE migration, whose `_journal.json` was
 * corrupted twice on 2026-07-31 by concurrent generation (see the argument on the
 * enum in src/db/schema.notifications.ts). `course_message` is labelled "Message
 * from an instructor" (./types.ts#NOTIFICATION_TYPE_LABELS) and a peer-review
 * assignment IS an instructor act — they open and allocate the round. The cost is
 * stated rather than hidden: a student who switches off "Message from an instructor"
 * also switches off peer-review assignment notices, and the two cannot be separated
 * until the label exists.
 *   TODO(notifications): if a future migration is being generated anyway, add a
 *   `peer_review_assigned` label and a `peer_review_assigned` preference column, and
 *   change the first segment below. The key shape already leaves room for it —
 *   changing the type segment changes the key, so historical rows keep their own and
 *   no message is retroactively suppressed.
 *
 * WHY THE `peer_review` SEGMENT IS MANDATORY. The lesson recorded in this file's
 * header, applied: every notification shares the single queue kind
 * `notification_email`, so the TYPE is what distinguishes two events — and two
 * events of the SAME type from different tables would collide, because
 * `peer_review_allocations` and any other `course_message` subject have independent
 * `serial` sequences. Without this segment, allocation 41 and some future
 * course-message subject 41 would mint the identical key, the unique index would
 * fire, and the second student would silently never be told. Shape:
 * `notification_email:course_message:peer_review:41`.
 *
 * WHY IT IS KEYED ON THE ALLOCATION AND NOT ON THE ROUND. `peer_review_allocations`
 * rows are insert-once (src/lib/peer-review/rounds.ts#allocateRound inserts with
 * `ON CONFLICT DO NOTHING` and never rewrites one), so an allocation id identifies
 * one "you were asked to review this" event forever — which is the property this
 * file's header requires of every key in it. Keying on the ROUND would mean a
 * student who is allocated more work by a later reconcile is never told, silently.
 * The consequence is that a reviewer given two submissions receives two messages;
 * the producer therefore takes the LOWEST of the new allocation ids and reports the
 * count, so one reconcile produces one message per reviewer. See
 * `notifyPeerReviewAssigned`.
 */
export function peerReviewAssignedKey(allocationId: number): string {
  return buildIdempotencyKey(NOTIFICATION_JOB_KIND, [
    "course_message",
    "peer_review",
    allocationId,
  ]);
}
