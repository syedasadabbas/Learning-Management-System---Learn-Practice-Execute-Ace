// =============================================================================
// NOTIFICATION LEDGER AND PER-STUDENT PREFERENCES — schema module for the
// email-notifications stream (IMPLEMENTATION_ROADMAP.md, PHASE 1 feature 1).
// -----------------------------------------------------------------------------
// WHY THIS IS A SIBLING MODULE AND NOT AN APPEND TO src/db/schema.ts
//
// The roadmap says "Add to src/db/schema.ts". That instruction is followed in
// spirit and not in letter, for the reason drizzle.config.ts states in its own
// comment and schema.access.ts / schema.queue.ts / schema.submissions.ts have
// already established: `schema.ts` is the frozen Wave 0 seam, it is edited
// concurrently by several streams, and drizzle-kit snapshots the WHOLE schema —
// so two streams appending to the hot file in the same wave produce conflicting
// migrations and a broken `_journal.json`. That happened twice on 2026-07-31.
// drizzle-kit unions every path in the config's `schema` array into one snapshot,
// so the generated migration is byte-identical to what an inline declaration
// would have produced. This module imports FROM schema.ts and schema.ts never
// imports back, so there is no cycle.
//
// -----------------------------------------------------------------------------
// WHAT THESE TWO TABLES ARE, AND — MORE IMPORTANTLY — WHAT THEY ARE NOT.
//
// They are NOT a mail queue, NOT a retry ledger and NOT a send-deduplication
// ledger. All three of those already exist and are not rebuilt here:
//
//   * `jobs` (src/db/schema.ts:807 onwards) + src/lib/queue/** is the queue:
//     DB-level idempotency on `jobs_idempotency_key_idx`, claiming with
//     `FOR UPDATE SKIP LOCKED`, bounded retries with backoff in milliseconds, and
//     a terminal `dead` state that an operator can list.
//   * `mail_dispatches` (src/db/schema.queue.ts) + src/lib/mail/dispatch.ts is
//     the "has this message already gone out?" decision, taken in the database
//     BEFORE the transport is called.
//   * .github/workflows/drain-jobs.yml is the scheduler, every 5 minutes.
//
// `notifications` is the STUDENT-FACING HISTORY of what the system decided to
// tell them, plus the pointer that the queue handler dereferences at send time.
// It is the answer to "what have I been emailed about?" — a product question —
// whereas `mail_dispatches` answers "did this exact message leave the building?",
// an operations question that deliberately stores no subject and no body.
//
// The two are tied together by ONE STRING. `notifications.dedupe_key` carries the
// same value as `jobs.idempotency_key` for the job that will send it and as
// `mail_dispatches.dedupe_key` for the send itself. So the three guarantees —
// one history row per event, one job per event, one message per event — are keyed
// on a single identifier rather than three that can drift apart. Building a
// second key here would be a fourth thing to keep in step. See
// src/lib/notifications/keys.ts for how each key is minted and why the scope of
// each one is what it is.
//
// All durations are milliseconds and every timestamp is `timestamptz` written by
// the DATABASE's clock (house rules: metric units, one clock — the argument is in
// src/lib/queue/store.ts's header and is not restated here).
// =============================================================================

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * The events a student can be emailed about.
 *
 * ALL EIGHT ROADMAP VALUES ARE DECLARED EVEN THOUGH THIS STREAM PRODUCES FOUR,
 * and that is a deliberate, cost-driven choice rather than speculative
 * generality. Adding a value to a Postgres enum requires a migration
 * (`ALTER TYPE ... ADD VALUE`), and on 2026-07-31 the whole add-on wave is
 * generating exactly ONE migration between eight parallel streams. `badge_earned`
 * (roadmap feature 3) and `forum_reply` (feature 5) are being built in the same
 * wave; if their values are absent here, those streams either cannot notify at
 * all or need a second migration in a `_journal.json` that has already been
 * corrupted twice today by concurrent generation. Declaring the value is free —
 * an enum label costs nothing until a row uses it — and omitting it is not.
 *
 * WHICH VALUES THIS STREAM ACTUALLY PRODUCES, so the gap is documented rather
 * than discovered:
 *   quiz_submitted      — produced. src/lib/notifications/producers.ts.
 *   exam_completed      — produced.
 *   assignment_feedback — produced, BUT NOT BY THIS STREAM'S PRODUCER. The
 *                         "your assignment has been graded" email already exists
 *                         as its own queue kind (`submission_graded_email`, see
 *                         src/lib/queue/handlers/submission-graded-email.ts) with
 *                         a pointer payload and a supersede guard that a generic
 *                         notification row cannot reproduce. It is NOT rebuilt
 *                         here; see src/lib/notifications/producers.ts for the
 *                         full argument and for the one-line change that would
 *                         make it also write a history row.
 *   penalty_issued      — produced.
 *   grade_posted        — NOT produced. In this app a posted grade IS
 *                         `assignment_feedback`; there is no second "grades are
 *                         published" event anywhere in src/lib/**. The label is
 *                         kept for the enum-migration reason above.
 *   badge_earned        — for roadmap feature 3, same wave.
 *   forum_reply         — for roadmap feature 5, same wave.
 *   course_message      — no instructor-broadcast feature exists.
 */
export const notificationType = pgEnum("notification_type", [
  "quiz_submitted",
  "exam_completed",
  "assignment_feedback",
  "penalty_issued",
  "forum_reply",
  "badge_earned",
  "grade_posted",
  "course_message",
]);

/**
 * Lifecycle of a `notifications` row.
 *
 * The roadmap lists four values: pending / sent / failed / bounced. A fifth,
 * `suppressed`, is added and one of the four is honestly qualified:
 *
 *   pending    — recorded and enqueued; the queue has not sent it yet. Normal for
 *                at most one drain interval (5 minutes, per drain-jobs.yml) and
 *                usually for a few hundred milliseconds, because the producing
 *                request also schedules an in-request drain via
 *                src/lib/queue/schedule.ts#scheduleDrain.
 *
 *   sent       — the transport ACKNOWLEDGED the message. Not "the student read
 *                it", and on an install with no SMTP configured not even "it left
 *                the building": the default transport is the dev logger
 *                (src/lib/mail/dev.ts), which always reports success. That is
 *                existing, argued behaviour inherited here, and it means a
 *                history full of `sent` rows is not proof of delivery.
 *
 *   failed     — the transport reported a definite failure, or the queue job
 *                dead-lettered. `failure_reason` says which.
 *
 *   suppressed — THE ADDED VALUE. The student has this category switched off in
 *                `notification_preferences`, so nothing was sent. It is NOT
 *                `failed`: an operator triaging a failure list must not have to
 *                sift opt-outs out of relay errors, and a student looking at their
 *                own history is owed the difference between "we could not tell
 *                you" and "you asked us not to". Suppression is normally decided
 *                BEFORE a row is written at all (no row, no job, no wasted drain
 *                — see src/lib/notifications/producers.ts); this value exists for
 *                the narrower case where the switch is turned off in the window
 *                between the enqueue and the drain, which the handler re-checks.
 *
 *   bounced    — DECLARED AND NEVER WRITTEN TODAY, stated plainly instead of
 *                implied. A bounce is asynchronous: it arrives as a DSN at the
 *                sending mailbox, or over a webhook from a provider that this
 *                project deliberately does not have (FREE_STACK.md: the only mail
 *                credential is the organisation's own free mailbox). Nothing in
 *                this codebase can observe one, so nothing sets this. The label is
 *                kept because the enum-migration cost argued above applies here
 *                too, and because a future DSN reader would need it.
 */
export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "suppressed",
  "bounced",
]);

/**
 * One thing the system decided to tell one student, and what became of it.
 *
 * WHY THE SUBJECT AND BODY ARE STORED HERE WHEN
 * src/lib/queue/handlers/submission-graded-email.ts ARGUES FOR POINTERS, NOT
 * SNAPSHOTS. Because the two are not in conflict — they are about different
 * mutability:
 *
 *   * a GRADE is mutable. An instructor can regrade between enqueue and drain, so
 *     that handler carries a pointer and re-reads the score at send time; a
 *     snapshot there would email a student a figure that no longer exists.
 *   * the four events THIS table records are FACTS ABOUT THE PAST and cannot be
 *     restated. "You submitted attempt 2 of the Week 3 quiz and scored 7/10" is
 *     true forever; the attempt row is never rewritten (src/lib/quizzes/**
 *     inserts a new attempt rather than mutating an old one). A snapshot is
 *     therefore not a staleness risk, and it buys two things a pointer cannot:
 *     the history page renders from one indexed read instead of re-joining four
 *     tables per row, and it shows the student WHAT THEY WERE ACTUALLY SENT
 *     rather than a re-derivation that may not match the email in their inbox.
 *
 * The body stored is the PLAIN-TEXT part only. The HTML part is re-rendered from
 * the same template at send time and never persisted: it is presentation, it is
 * three times the bytes, and a stored HTML blob is a stored XSS payload waiting
 * for somebody to render it with `dangerouslySetInnerHTML`.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),

    /**
     * The recipient. `cascade` because a deleted user's notification history is
     * meaningless and keeping it would keep their email address in
     * `recipient_email` after the account is gone.
     */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: notificationType("type").notNull(),

    /**
     * THE JOIN TO THE QUEUE AND TO THE MAIL LEDGER — the same string as
     * `jobs.idempotency_key` and `mail_dispatches.dedupe_key`.
     *
     * UNIQUE, and that uniqueness does real work: it is what makes recording a
     * notification idempotent under concurrency. A student double-submitting, or
     * two overlapping ingest runs issuing the same penalty, both reach
     * `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING` and Postgres decides which
     * one wrote the row — exactly as src/lib/queue/store.ts#enqueueJob does, and
     * for the reason src/lib/queue/keys.ts's header gives at length: a
     * SELECT-then-INSERT check does not work under READ COMMITTED.
     *
     * varchar(200) matches `KEY_MAX_CHARS` in src/lib/queue/keys.ts and the width
     * of both other columns that hold this same value. A narrower column here
     * would truncate a legal queue key and silently break the join.
     */
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),

    /**
     * Snapshotted at record time rather than joined from `users.email` at read
     * time, because it answers "where was this sent?" and a student who changes
     * their address must not have their history rewritten to claim the old mail
     * went to the new one. 320 = the RFC 5321 maximum, as in `mail_dispatches`.
     */
    recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),

    subject: varchar("subject", { length: 255 }).notNull(),

    /** The plain-text part actually sent. See the table comment for why not HTML. */
    body: text("body").notNull(),

    /**
     * Context for the history UI's deep link and for an operator correlating a
     * row with the event that caused it: `{ quizId, attemptId, weekId, ... }`.
     *
     * jsonb and not columns, because the shape differs per `type` and a column
     * per event kind would be eight nullable columns of which seven are always
     * null. Nothing branches on the contents — src/lib/notifications/types.ts
     * validates it at the edge and the UI reads at most a `url`.
     */
    metadata: jsonb("metadata"),

    status: notificationStatus("status").notNull().default("pending"),

    /** Set when the transport acknowledged. Null while pending/suppressed/failed. */
    sentAt: timestamp("sent_at", { withTimezone: true }),

    /** Truncated diagnostic; never rendered to the student. */
    failureReason: text("failure_reason"),

    /**
     * When the student opened their notification history with this row visible.
     *
     * A nullable timestamp rather than a boolean `is_read`: "when" is strictly
     * more information than "whether" at the same storage cost, and the unread
     * COUNT the UI needs is `where read_at is null`, which the index below serves
     * either way.
     */
    readAt: timestamp("read_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * The idempotency guarantee. Named explicitly so
     * `onConflictDoNothing({ target: notifications.dedupeKey })` has a
     * single-column arbiter to name — an untargeted conflict clause would also
     * absorb a primary-key collision and report it as successful de-duplication
     * (the same mistake src/lib/queue/store.ts refuses to make).
     */
    dedupeIdx: uniqueIndex("notifications_dedupe_key_idx").on(table.dedupeKey),

    /**
     * The history page's only query: newest first for one user. Composite and
     * descending on `created_at` so the read is an index scan with no sort — the
     * page shows 50 rows and a student who has been on the course for 10 weeks
     * has a few hundred.
     */
    userRecentIdx: index("notifications_user_created_idx").on(table.userId, table.createdAt),

    /** The drain's and the operator's query: everything still pending or failed. */
    statusIdx: index("notifications_status_idx").on(table.status),
  }),
);

/**
 * One row per student: which categories they want, and whether they want digests.
 *
 * WHY A ROW-PER-USER TABLE WITH BOOLEAN COLUMNS, and not the two obvious
 * alternatives:
 *
 *   * a row per (user, type) opt-out — normalised, and worse here. The set of
 *     types is a closed enum fixed at deploy time, the read is always "all
 *     preferences for one user" on the path of every notification, and the
 *     absence of a row would have to mean "opted in", which makes every query a
 *     left join against an enum the database cannot enumerate for it.
 *   * a jsonb blob — no default per key, no type checking, and a typo'd key reads
 *     as `undefined` and silently changes behaviour.
 *
 * THE ROW IS OPTIONAL AND ITS ABSENCE IS THE DEFAULT, which is why every column
 * carries a database default AND src/lib/notifications/preferences.ts carries the
 * same defaults in code. That duplication is deliberate: the code default applies
 * to the ~100% of students who have never opened the settings page and therefore
 * have no row at all, and the column default applies when a row is inserted with
 * only some columns named. A student is opted IN to every event category (the
 * whole feature is worth 15-25% more on-time submissions per
 * LMS_ENHANCEMENT_INDEX.md:33 only if it reaches people) and opted OUT of the
 * daily digest, per the roadmap's own defaults.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),

    /**
     * UNIQUE — one row per student. The roadmap's sketch omits this, and without
     * it two concurrent saves from the same student's two browser tabs insert two
     * rows and every later read has to pick one arbitrarily. The uniqueness is
     * also what makes the save an `INSERT ... ON CONFLICT (user_id) DO UPDATE`
     * (src/lib/notifications/preferences.ts) instead of a read-modify-write race.
     */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // One column per `notification_type` label that this app can produce, plus
    // the two the roadmap names. Kept in the roadmap's own order so the two are
    // diffable. `grade_posted`, `forum_reply`, `badge_earned` and `course_message`
    // are included for the streams landing in this same wave; see the enum's
    // comment for why an unused label is cheaper than a second migration.
    quizSubmitted: boolean("quiz_submitted").notNull().default(true),
    examCompleted: boolean("exam_completed").notNull().default(true),
    assignmentFeedback: boolean("assignment_feedback").notNull().default(true),
    penaltyIssued: boolean("penalty_issued").notNull().default(true),
    forumReply: boolean("forum_reply").notNull().default(true),
    badgeEarned: boolean("badge_earned").notNull().default(true),
    gradePosted: boolean("grade_posted").notNull().default(true),
    courseMessage: boolean("course_message").notNull().default(true),

    /**
     * DIGEST PREFERENCES ARE STORED AND NOT YET HONOURED BY ANY CODE.
     *
     * TODO(notifications): no digest producer exists. A digest needs a scheduled
     * sweep that aggregates a window of `notifications` rows, and this app has
     * exactly one scheduler for queue work (.github/workflows/drain-jobs.yml,
     * every 5 minutes) plus two spent Vercel cron slots — adding a second
     * scheduler was explicitly out of scope for this stream. The columns exist
     * because the enum/migration argument above applies to columns too: adding
     * them later is another migration in a shared `_journal.json`. Until a
     * producer reads them, toggling these changes NOTHING, and the settings UI
     * says so rather than lying with a live-looking switch.
     */
    digestDaily: boolean("digest_daily").notNull().default(false),
    digestWeekly: boolean("digest_weekly").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: uniqueIndex("notification_preferences_user_idx").on(table.userId),
  }),
);

/** Row types, so service code never re-describes the table's shape. */
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;

/** The enums as values, for exhaustive switches. Mirrors the pgEnums above. */
export const NOTIFICATION_TYPES = notificationType.enumValues;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_STATUSES = notificationStatus.enumValues;
export type NotificationStatusValue = (typeof NOTIFICATION_STATUSES)[number];
