// =============================================================================
// LIVE CLASSES — LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md §1.2 and
// LIVE_CLASSES_AND_PRESENTATIONS_STRATEGY.md §2.4.
// Owner: the lms-complete-enhancement wave (Subagent 1, database architect).
// -----------------------------------------------------------------------------
// WHY A SIBLING MODULE: drizzle.config.ts:9-15. `schema.ts` is the frozen Wave 0
// seam; a stream that needs tables of its own adds a module plus ONE line to that
// config's `schema` array. An unlisted module is a set of tables drizzle-kit will
// offer to DROP — and for this module that means dropping the attendance record
// that a participation mark was computed from.
//
// =============================================================================
// WHAT THIS SCHEMA HAS TO ENFORCE
// =============================================================================
//
// 1. ONE ATTENDANCE ROW PER (CLASS, STUDENT). `class_attendance` has a UNIQUE index
//    on that pair, and it is the reason joining a class is an idempotent
//    `INSERT ... ON CONFLICT` rather than a read-then-write race. A student who
//    reloads the tab, or whose connection drops and reconnects, must not appear
//    twice: `attendance_count` would over-report and the participation mark derived
//    from these rows would be wrong in a student's favour with no trace of why.
//    Re-joining UPDATES the existing row (extends `time_present_minutes`); it never
//    inserts a second one.
//
// 2. A TIME RANGE MUST NOT RUN BACKWARDS. `ended_at > started_at` on `live_classes`,
//    `left_at >= joined_at` on `class_attendance`, and the same on the recording
//    window, are CHECKs. An inverted range is not a display bug: durations are
//    computed from these columns, and a negative duration silently subtracts from
//    aggregate attendance minutes.
//
// 3. NO NEGATIVE COUNTERS OR DURATIONS. Every counter here (`attendance_count`,
//    `messages_sent`, `questions_asked`, `upvotes`, `duration_minutes`,
//    `file_size_mb`) is CHECKed `>= 0`. These are incremented by concurrent
//    handlers; a decrement path that double-fires is the normal way a counter goes
//    negative, and a negative count reaching the leaderboard is far more expensive
//    to unpick than an INSERT that fails loudly at the moment of the bug.
//
// 4. STATUS IS A pgEnum, NOT A varchar. `class_status` and `recording_status` drive
//    branching (may a student join? is the recording playable?) rather than display.
//    A typo'd status in a varchar column is a class nobody can join and a query that
//    returns nothing, with no error anywhere. `message_type` is also an enum because
//    the chat renderer switches on it exhaustively.
//
// 5. ONE UPVOTE PER USER IS A PRIMARY KEY, NOT A CODE PATH. `class_qa_votes`
//    exists because `class_qa.upvotes` alone records HOW MANY without recording
//    WHO, and a count with no ledger behind it cannot refuse a second vote from
//    the same student. That was not a hypothetical: both the REST route
//    (src/app/api/classes/[classId]/qa/[questionId]/upvote/route.ts) and the
//    realtime store (services/realtime/src/store/types.ts) declared the
//    one-vote-per-user rule and neither could implement it, so the queue — which
//    orders by `upvotes` — could be climbed by holding down a button. The fix is
//    the same shape as §1: put the pair in a key and let the database refuse the
//    duplicate. See `classQaVotes` and the note there on why the counter stayed.
//
// 6. FLAG/TIMESTAMP PAIRS ARE KEPT CONSISTENT BY A CHECK. `class_qa` already did
//    this with `is_answered`/`answered_at`; `class_chat` now does it with
//    `is_deleted`/`deleted_at`. Two writers share these tables — this app's REST
//    routes and the standalone `services/realtime` socket service, which speaks
//    hand-written SQL and cannot see this file. The REST read model branches on
//    the boolean and the socket wire format carries the timestamp; a CHECK is
//    what stops one writer from setting only the half it happens to care about.
//
// A NOTE ON WHAT IS **NOT** HERE: no per-participant media/session tokens, and no
// Jitsi JWT. `jitsi_password` is the room password an instructor sets, nothing more.
// Credentials that grant access are minted per request and never stored.
//
// Every timestamp is `timestamptz` written by the DATABASE's clock. Metric units
// throughout: durations in minutes, recording length in seconds, file size in
// megabytes (1 MB = 10^6 bytes), all named in the column.
// =============================================================================

import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { lectures, users, weeks } from "./schema";

/** Lifecycle of a scheduled session. See §4 of the file header. */
export const classStatus = pgEnum("class_status", ["scheduled", "active", "ended", "cancelled"]);

/** Lifecycle of the recording of a session. Distinct from the class's own status:
 *  a class can be 'ended' while its recording is still 'processing'. */
export const recordingStatus = pgEnum("recording_status", [
  "not_started",
  "recording",
  "processing",
  "available",
  "failed",
]);

/** Chat message kind. The renderer switches on this exhaustively. */
export const messageType = pgEnum("message_type", ["text", "system", "poll", "announcement"]);

/**
 * A scheduled (then live, then ended) class session.
 *
 * THE SCHEDULE IS THE ROW. A class exists from the moment it is scheduled, which is
 * why `scheduled_at` is NOT NULL while `started_at` and `ended_at` are nullable: the
 * first is a promise to students, the other two are facts about what happened.
 * "Is this class joinable?" is `status = 'active'`, not a comparison against the
 * clock — a session that runs long must not lock its own students out.
 */
export const liveClasses = pgTable(
  "live_classes",
  {
    id: serial("id").primaryKey(),

    weekId: integer("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    /**
     * The lecture this session covers, if any. Nullable and `set null`: an office-hours
     * session belongs to a week without belonging to a lecture, and deleting a lecture
     * must not delete the record of a class that was actually held.
     */
    lectureId: integer("lecture_id").references(() => lectures.id, { onDelete: "set null" }),
    instructorId: integer("instructor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    /** When it is advertised to start. The column the "upcoming classes" list sorts on. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Planned length in MINUTES. CHECKed > 0 — a zero-length class cannot be attended. */
    durationMinutes: integer("duration_minutes").notNull().default(60),

    status: classStatus("status").notNull().default("scheduled"),

    /**
     * The Jitsi room. Nullable because it is minted when the instructor first starts
     * the class, not when they schedule it — a room name published days in advance is
     * a room strangers can be sitting in before the class begins.
     */
    jitsiRoomName: varchar("jitsi_room_name", { length: 255 }),
    jitsiPassword: varchar("jitsi_password", { length: 255 }),
    enableRecording: boolean("enable_recording").notNull().default(true),

    /**
     * DENORMALIZED from `class_recordings`, on purpose: the class list renders a
     * "watch recording" affordance for every row, and without these two columns that
     * list needs a join (or N queries) to answer a question the row can answer itself.
     * `class_recordings` remains the source of truth for everything about the file.
     */
    recordingUrl: varchar("recording_url", { length: 500 }),
    recordingStatus: recordingStatus("recording_status").notNull().default("not_started"),

    /** Hard cap on concurrent participants, if the instructor sets one. */
    maxParticipants: integer("max_participants"),
    allowChat: boolean("allow_chat").notNull().default(true),
    allowQa: boolean("allow_qa").notNull().default(true),
    allowScreenShare: boolean("allow_screen_share").notNull().default(true),

    /**
     * DENORMALIZED count of `class_attendance` rows, maintained at join time. It exists
     * because the instructor's class list shows attendance for every past class and
     * `count(*)` per row does not survive a term's worth of sessions. §1's unique index
     * is what keeps it honest — without it, a reconnecting student would inflate this.
     */
    attendanceCount: integer("attendance_count").notNull().default(0),
    /**
     * 0.00-100.00. `decimal(5,2)` and not a float: it is displayed to two places and
     * compared against thresholds, and binary floating point makes "90.00" fail a
     * `>= 90` test in a way nobody can reproduce on demand.
     */
    engagementScore: decimal("engagement_score", { precision: 5, scale: 2 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    isArchived: boolean("is_archived").notNull().default(false),
  },
  (t) => ({
    /** Serves "the classes for this week", the student's week page. */
    weekIdx: index("live_classes_week_idx").on(t.weekId),
    /** Serves "my classes" for an instructor. */
    instructorIdx: index("live_classes_instructor_idx").on(t.instructorId),
    /** Serves the "is anything live right now?" banner. */
    statusIdx: index("live_classes_status_idx").on(t.status),
    /** Serves the time-range scan behind "upcoming classes". */
    scheduledIdx: index("live_classes_scheduled_idx").on(t.scheduledAt),
    /** Composite for the actual upcoming query: status = 'scheduled' ORDER BY scheduled_at. */
    statusScheduledIdx: index("live_classes_status_scheduled_idx").on(t.status, t.scheduledAt),
    /** Serves "recordings available for this week". */
    recordingStatusIdx: index("live_classes_recording_status_idx").on(t.recordingStatus),

    /** §3. */
    durationPositive: check("live_classes_duration_positive", sql`${t.durationMinutes} > 0`),
    attendanceNonNegative: check(
      "live_classes_attendance_non_negative",
      sql`${t.attendanceCount} >= 0`,
    ),
    maxParticipantsPositive: check(
      "live_classes_max_participants_positive",
      sql`${t.maxParticipants} IS NULL OR ${t.maxParticipants} > 0`,
    ),
    /** §2. Nulls pass: a class that has started but not ended is the normal live state. */
    endsAfterStarts: check(
      "live_classes_ends_after_starts",
      sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.endedAt} > ${t.startedAt}`,
    ),
    engagementInRange: check(
      "live_classes_engagement_in_range",
      sql`${t.engagementScore} IS NULL OR (${t.engagementScore} >= 0 AND ${t.engagementScore} <= 100)`,
    ),
  }),
);

/**
 * "Student S was present at class C." One row per pair, forever — see §1 of the
 * file header, which is the single most important constraint in this module.
 *
 * DISTINCT FROM `attendance` (schema.ts:426), which is per-LECTURE and manually
 * marked. This one is per live SESSION and is written by the join handler. They are
 * not merged because the participation signals differ entirely (there is no
 * "messages sent" for reading a lecture page) and because merging would make the
 * per-lecture table's unique key ambiguous.
 */
export const classAttendance = pgTable(
  "class_attendance",
  {
    id: serial("id").primaryKey(),

    classId: integer("class_id")
      .notNull()
      .references(() => liveClasses.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** First join. Not updated on reconnect — §1: the row is upserted, not replaced. */
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    /**
     * ACCUMULATED presence in MINUTES, not `left_at - joined_at`. The difference
     * matters: a student who drops and rejoins has a wall-clock span far longer than
     * the time they were actually there, and the participation mark must use the
     * latter. Maintained by the leave handler; null until the first leave.
     */
    timePresentMinutes: integer("time_present_minutes"),

    /** Engagement counters, incremented by the chat and Q&A handlers. §3 bounds them. */
    messagesSent: integer("messages_sent").notNull().default(0),
    questionsAsked: integer("questions_asked").notNull().default(0),
    screenShareCount: integer("screen_share_count").notNull().default(0),

    /**
     * The instructor's override. Separate from the existence of this row because the
     * two facts differ: the row says "this account opened the session", the flag says
     * "I count this as attendance". An instructor unticking it must not delete the
     * engagement counters that justify the decision.
     */
    markedPresent: boolean("marked_present").notNull().default(true),
    /** 0-100, CHECKed. Derived from the counters above; stored so it is reproducible. */
    participationScore: integer("participation_score").notNull().default(0),
  },
  (t) => ({
    /** §1. THE constraint of this module, and the ON CONFLICT target for join. */
    classStudentIdx: uniqueIndex("class_attendance_class_student_idx").on(t.classId, t.studentId),
    /** Serves the instructor's attendance roster for one class. */
    classIdx: index("class_attendance_class_idx").on(t.classId),
    /** Serves "which classes has this student attended?" across the term. */
    studentIdx: index("class_attendance_student_idx").on(t.studentId),
    /** Serves the roster ordered by arrival, and the "who is still here?" live view. */
    classJoinedIdx: index("class_attendance_class_joined_idx").on(t.classId, t.joinedAt),

    /** §2. */
    leftAfterJoined: check(
      "class_attendance_left_after_joined",
      sql`${t.leftAt} IS NULL OR ${t.leftAt} >= ${t.joinedAt}`,
    ),
    /** §3. */
    timePresentNonNegative: check(
      "class_attendance_time_present_non_negative",
      sql`${t.timePresentMinutes} IS NULL OR ${t.timePresentMinutes} >= 0`,
    ),
    countersNonNegative: check(
      "class_attendance_counters_non_negative",
      sql`${t.messagesSent} >= 0 AND ${t.questionsAsked} >= 0 AND ${t.screenShareCount} >= 0`,
    ),
    participationInRange: check(
      "class_attendance_participation_in_range",
      sql`${t.participationScore} >= 0 AND ${t.participationScore} <= 100`,
    ),
  }),
);

/**
 * One chat message in a live session.
 *
 * DELETION IS A FLAG, NOT A DELETE. `is_deleted` exists because a moderator removing
 * a message must not destroy the evidence of what was said — a conduct complaint is
 * investigated after the fact, and a hard DELETE leaves the moderator's own action
 * unexplainable. The read model filters on it; nothing purges these rows.
 */
export const classChat = pgTable(
  "class_chat",
  {
    id: serial("id").primaryKey(),

    classId: integer("class_id")
      .notNull()
      .references(() => liveClasses.id, { onDelete: "cascade" }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    message: text("message").notNull(),
    messageType: messageType("message_type").notNull().default("text"),
    isPinned: boolean("is_pinned").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),
    /**
     * WHEN it was removed, beside the flag that says THAT it was removed. The
     * same redundancy `class_qa.is_answered`/`answered_at` already carries, kept
     * honest the same way (`deletedConsistent` below), and for a concrete reason:
     * the realtime service's wire type carries `deletedAt: string | null` while
     * this app's read model branches on `is_deleted`. Storing only the boolean
     * would have forced the socket service to invent a timestamp, and storing
     * only the timestamp would have changed a REST response shape that clients
     * already consume. A moderation trail also wants the time — "this was
     * removed" is a much weaker record than "this was removed at 14:02".
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    /**
     * emoji -> the user ids that reacted with it. `jsonb`, not a `class_chat_reactions`
     * table, and this is a genuine trade rather than the lazy option.
     *
     * FOR the table: a reaction has a natural (message, user, emoji) key, which is
     * the §5 argument applied one level down. AGAINST it, and decisive here: a
     * reaction is never queried independently of its message — the only read is
     * "the reactions on the messages I am already fetching" — so a table buys a
     * join on the single hottest query in the product (the transcript tail) to
     * enforce a uniqueness rule that costs nothing to enforce in the value itself:
     * the socket service's toggle is `jsonb_agg(DISTINCT ...)` in ONE statement,
     * so two concurrent double-taps cannot produce two reactions any more than a
     * unique index would have let them.
     *
     * The column exists at all because the alternative was deleting a feature that
     * is already built end to end — `chat:react` is wired through the service's
     * schemas, handlers, engagement scoring and tests — purely because storage was
     * missing. Bounded by the class roster, so the document cannot grow unboundedly.
     */
    reactions: jsonb("reactions").$type<Record<string, number[]>>().notNull().default({}),

    /**
     * Threaded replies. Self-referencing FK; the `AnyPgColumn` return annotation is
     * required by TypeScript to break the circular inference, not a stylistic choice.
     * NO cascade: deleting a parent must not silently remove replies that quote it —
     * `is_deleted` above is the removal path. One level of threading is intended; the
     * renderer flattens anything deeper.
     */
    parentMessageId: integer("parent_message_id").references((): AnyPgColumn => classChat.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => ({
    /**
     * THE transcript query: messages of one class in time order, which is both the
     * live tail and the after-the-fact replay. Composite because ordering by
     * `created_at` after filtering by `class_id` is the whole access pattern.
     */
    classCreatedIdx: index("class_chat_class_created_idx").on(t.classId, t.createdAt),
    /** Serves moderation: "everything this account has posted". */
    senderIdx: index("class_chat_sender_idx").on(t.senderId),
    /** Serves reply lookup: "the replies to this message" when a thread is expanded. */
    parentIdx: index("class_chat_parent_idx").on(t.parentMessageId),

    /** An edit that predates the message it edits is a clock bug worth failing on. */
    editedAfterCreated: check(
      "class_chat_edited_after_created",
      sql`${t.editedAt} IS NULL OR ${t.editedAt} >= ${t.createdAt}`,
    ),
    /**
     * §6. The flag and the timestamp say the same thing or the write fails. Two
     * writers share this table and only one of them can see this file; without
     * this, the socket service stamping `deleted_at` while leaving `is_deleted`
     * false would produce a message the REST read model happily renders in full.
     */
    deletedConsistent: check(
      "class_chat_deleted_consistent",
      sql`(${t.deletedAt} IS NOT NULL) = ${t.isDeleted}`,
    ),
    deletedAfterCreated: check(
      "class_chat_deleted_after_created",
      sql`${t.deletedAt} IS NULL OR ${t.deletedAt} >= ${t.createdAt}`,
    ),
    /** A reply to itself is an infinite loop in the renderer. */
    noSelfParent: check(
      "class_chat_no_self_parent",
      sql`${t.parentMessageId} IS NULL OR ${t.parentMessageId} <> ${t.id}`,
    ),
  }),
);

/**
 * A question asked during a class, and the answer if one was given.
 *
 * SEPARATE FROM `class_chat` deliberately. A question has a lifecycle (asked ->
 * upvoted -> answered) and chat does not; folding them together would put
 * `is_answered` and `answer` on every "hello everyone" and would make the Q&A queue
 * a filtered scan of the whole transcript.
 */
export const classQa = pgTable(
  "class_qa",
  {
    id: serial("id").primaryKey(),

    classId: integer("class_id")
      .notNull()
      .references(() => liveClasses.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Who answered. `set null` — an instructor leaving must not erase the answer. */
    instructorId: integer("instructor_id").references(() => users.id, { onDelete: "set null" }),

    question: text("question").notNull(),

    /**
     * Redundant with `answered_at IS NOT NULL` and kept anyway, because it is the
     * column the queue filters on and an instructor may mark a question answered
     * verbally without typing an `answer`. `answeredConsistent` below stops the two
     * from disagreeing.
     */
    isAnswered: boolean("is_answered").notNull().default(false),
    answer: text("answer"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),

    /**
     * DENORMALIZED COUNT OF `class_qa_votes`, and it SURVIVED the introduction of
     * that ledger deliberately. The reasoning, since "two representations of one
     * fact will disagree" is the obvious objection:
     *
     *   - `class_qa_class_unanswered_idx` is `(class_id, is_answered, upvotes)`
     *     (SCHEMA_ENHANCEMENT.md:202) and it serves the instructor's working queue,
     *     which is POLLED CONTINUOUSLY for the whole of a live class. Replacing the
     *     column with `count(*)` over the ledger makes that ORDER BY a correlated
     *     subquery per candidate row followed by a sort — the one query in this
     *     module that must not stop being index-served.
     *   - It is a DISPLAY HINT and gates nothing (SCHEMA_ENHANCEMENT.md:325). The
     *     decision "may this user vote?" is answered by `class_qa_votes`' primary
     *     key and never by this number, so the failure mode of a drifted counter is
     *     a queue in a slightly wrong order, not a vote wrongly accepted.
     *   - It is maintained in the SAME TRANSACTION as the ledger insert, and only
     *     when that insert actually inserted a row. Both writers do this: see
     *     src/app/api/classes/[classId]/qa/[questionId]/upvote/route.ts and
     *     services/realtime/src/store/pg.ts.
     *
     * CHECKed >= 0. See §3 — a double-fired downvote is how this goes negative.
     */
    upvotes: integer("upvotes").notNull().default(0),
    isPinned: boolean("is_pinned").notNull().default(false),

    /**
     * An instructor CLOSING a thread, which is not the same fact as `answered_at`.
     * A question can be answered and still open (follow-ups are coming), and it can
     * be closed without an answer (asked twice, off-topic, covered elsewhere).
     * Kept nullable and separate rather than folded into `is_answered` because the
     * Q&A queue orders open-before-closed and would otherwise have to guess.
     */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Serves the Q&A panel: one class, newest or most-upvoted first. */
    classCreatedIdx: index("class_qa_class_created_idx").on(t.classId, t.createdAt),
    /**
     * Serves the instructor's working queue — the unanswered questions of one class,
     * highest-voted first. This is the query the panel runs on every poll.
     */
    classUnansweredIdx: index("class_qa_class_unanswered_idx").on(
      t.classId,
      t.isAnswered,
      t.upvotes,
    ),
    /** Serves "my questions" on the student's own history. */
    studentIdx: index("class_qa_student_idx").on(t.studentId),

    upvotesNonNegative: check("class_qa_upvotes_non_negative", sql`${t.upvotes} >= 0`),
    /**
     * `answered_at` set means answered. Stops the queue from hiding a question whose
     * answer was never recorded, and from showing one that has an answer attached.
     */
    answeredConsistent: check(
      "class_qa_answered_consistent",
      sql`(${t.answeredAt} IS NOT NULL) = ${t.isAnswered}`,
    ),
    answeredAfterAsked: check(
      "class_qa_answered_after_asked",
      sql`${t.answeredAt} IS NULL OR ${t.answeredAt} >= ${t.createdAt}`,
    ),
    resolvedAfterAsked: check(
      "class_qa_resolved_after_asked",
      sql`${t.resolvedAt} IS NULL OR ${t.resolvedAt} >= ${t.createdAt}`,
    ),
  }),
);

/**
 * "User U upvoted question Q." One row per pair, and the pair IS the primary key.
 *
 * THIS TABLE IS THE INVARIANT — see §5 of the file header. `class_qa.upvotes` can
 * only ever say how many; this says who, and a composite primary key on (question,
 * user) means a second vote from the same account is refused by Postgres rather
 * than by whichever of the two writers remembered to check. Before it existed the
 * REST route documented the hole in its own header (a bounded increment with a
 * ceiling of 500) and the socket store promised idempotence it could not deliver;
 * a student could therefore climb the instructor's queue with their own question by
 * pressing one button repeatedly. The peer-review module makes this argument at
 * length (src/db/schema.peer-review.ts §1): an invariant enforced by a constraint is
 * enforced, one enforced by application code is enforced until two callers race.
 *
 * NO SURROGATE `serial` KEY, uniquely in this module and against the house default.
 * A vote has no identity of its own — nothing references one, nothing displays one,
 * and there is no second row for the same pair to distinguish. A `serial id` plus a
 * UNIQUE index would store and index a number no query ever mentions, and would
 * leave the table technically able to hold the duplicate that the UNIQUE index then
 * has to forbid. The pair is the row.
 *
 * NO ANONYMITY REQUIREMENT, unlike peer review: an upvote is a low-stakes public
 * signal, and the instructor being able to see that a cluster of votes came from one
 * study group is useful rather than a leak. So the ids sit on the row plainly.
 *
 * CASCADE ON BOTH SIDES. A deleted question's votes are meaningless, and a deleted
 * account's votes must not keep inflating a counter attributed to nobody.
 */
export const classQaVotes = pgTable(
  "class_qa_votes",
  {
    questionId: integer("question_id")
      .notNull()
      .references(() => classQa.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * Kept even though nothing reads it today. A vote ledger is the evidence for a
     * disputed queue ordering, and "when" is the first question anyone asks of it;
     * it cannot be reconstructed later from a row that never recorded it.
     */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * THE constraint. Also the ON CONFLICT target both writers name, and the index
     * that answers "has this user already voted?" without a scan.
     */
    pk: primaryKey({ columns: [t.questionId, t.userId] }),
    /**
     * Serves "which questions did I vote for?", which the Q&A panel needs to render
     * the button in its already-voted state. Leading on `user_id` because the
     * primary key above already leads on `question_id`, so this is the direction the
     * PK cannot serve.
     */
    userIdx: index("class_qa_votes_user_idx").on(t.userId),
  }),
);

/**
 * The recorded artefact of a class. AT MOST ONE PER CLASS — `class_id` is UNIQUE.
 *
 * A separate table from `live_classes` rather than more columns on it, even though
 * the cardinality is 1:1, because the recording's lifecycle is independent (it
 * appears hours after the class ends, may fail, may be deleted for storage while the
 * class record stays) and because `transcription` is a large TEXT column that would
 * otherwise be dragged into every class-list query.
 */
export const classRecordings = pgTable(
  "class_recordings",
  {
    id: serial("id").primaryKey(),

    classId: integer("class_id")
      .notNull()
      .references(() => liveClasses.id, { onDelete: "cascade" }),

    fileName: varchar("file_name", { length: 500 }),
    filePath: varchar("file_path", { length: 500 }),
    /** Megabytes (1 MB = 10^6 bytes). Metric, per house rule; CHECKed >= 0. */
    fileSizeMb: integer("file_size_mb"),
    /** Seconds — the unit every player API uses. CHECKed >= 0. */
    durationSeconds: integer("duration_seconds"),

    recordingStartedAt: timestamp("recording_started_at", { withTimezone: true }),
    recordingEndedAt: timestamp("recording_ended_at", { withTimezone: true }),

    /** Auto-generated transcript. Large; never selected by the list read model. */
    transcription: text("transcription"),

    /**
     * FALSE by default, and the default is the point: a recording contains students'
     * faces, names and voices. Publishing one is an explicit act, never a fallback.
     */
    isPublic: boolean("is_public").notNull().default(false),
    hlsUrl: varchar("hls_url", { length: 500 }),
    dashUrl: varchar("dash_url", { length: 500 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * SOFT DELETE. The row survives the file so "this class was recorded and the
     * recording has since been removed" is distinguishable from "never recorded" —
     * a question students do ask, and one a hard DELETE makes unanswerable.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    /** At most one recording per class. Also the ON CONFLICT target for the ingest job. */
    classIdx: uniqueIndex("class_recordings_class_idx").on(t.classId),
    /** Serves the public recordings gallery, newest first. */
    publicCreatedIdx: index("class_recordings_public_created_idx").on(t.isPublic, t.createdAt),

    /** §2. */
    endsAfterStarts: check(
      "class_recordings_ends_after_starts",
      sql`${t.recordingEndedAt} IS NULL OR ${t.recordingStartedAt} IS NULL OR ${t.recordingEndedAt} > ${t.recordingStartedAt}`,
    ),
    /** §3. */
    sizeNonNegative: check(
      "class_recordings_size_non_negative",
      sql`${t.fileSizeMb} IS NULL OR ${t.fileSizeMb} >= 0`,
    ),
    durationNonNegative: check(
      "class_recordings_duration_non_negative",
      sql`${t.durationSeconds} IS NULL OR ${t.durationSeconds} >= 0`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const liveClassesRelations = relations(liveClasses, ({ one, many }) => ({
  week: one(weeks, { fields: [liveClasses.weekId], references: [weeks.id] }),
  lecture: one(lectures, { fields: [liveClasses.lectureId], references: [lectures.id] }),
  instructor: one(users, { fields: [liveClasses.instructorId], references: [users.id] }),
  attendance: many(classAttendance),
  chat: many(classChat),
  questions: many(classQa),
  /** 1:1 in practice — `class_recordings.class_id` is UNIQUE. */
  recording: one(classRecordings),
}));

export const classAttendanceRelations = relations(classAttendance, ({ one }) => ({
  liveClass: one(liveClasses, { fields: [classAttendance.classId], references: [liveClasses.id] }),
  student: one(users, { fields: [classAttendance.studentId], references: [users.id] }),
}));

export const classChatRelations = relations(classChat, ({ one, many }) => ({
  liveClass: one(liveClasses, { fields: [classChat.classId], references: [liveClasses.id] }),
  sender: one(users, { fields: [classChat.senderId], references: [users.id] }),
  parent: one(classChat, {
    fields: [classChat.parentMessageId],
    references: [classChat.id],
    relationName: "class_chat_thread",
  }),
  replies: many(classChat, { relationName: "class_chat_thread" }),
}));

export const classQaRelations = relations(classQa, ({ one, many }) => ({
  liveClass: one(liveClasses, { fields: [classQa.classId], references: [liveClasses.id] }),
  student: one(users, { fields: [classQa.studentId], references: [users.id] }),
  instructor: one(users, { fields: [classQa.instructorId], references: [users.id] }),
  votes: many(classQaVotes),
}));

export const classQaVotesRelations = relations(classQaVotes, ({ one }) => ({
  question: one(classQa, { fields: [classQaVotes.questionId], references: [classQa.id] }),
  user: one(users, { fields: [classQaVotes.userId], references: [users.id] }),
}));

export const classRecordingsRelations = relations(classRecordings, ({ one }) => ({
  liveClass: one(liveClasses, { fields: [classRecordings.classId], references: [liveClasses.id] }),
}));

export type LiveClass = typeof liveClasses.$inferSelect;
export type NewLiveClass = typeof liveClasses.$inferInsert;
export type ClassAttendance = typeof classAttendance.$inferSelect;
export type NewClassAttendance = typeof classAttendance.$inferInsert;
export type ClassChatMessage = typeof classChat.$inferSelect;
export type NewClassChatMessage = typeof classChat.$inferInsert;
export type ClassQaEntry = typeof classQa.$inferSelect;
export type NewClassQaEntry = typeof classQa.$inferInsert;
export type ClassQaVote = typeof classQaVotes.$inferSelect;
export type NewClassQaVote = typeof classQaVotes.$inferInsert;
export type ClassRecording = typeof classRecordings.$inferSelect;
export type NewClassRecording = typeof classRecordings.$inferInsert;

/** Enum values as arrays, for exhaustive switches. Mirrors the pgEnums above. */
export const CLASS_STATUSES = ["scheduled", "active", "ended", "cancelled"] as const;
export const RECORDING_STATUSES = [
  "not_started",
  "recording",
  "processing",
  "available",
  "failed",
] as const;
export const MESSAGE_TYPES = ["text", "system", "poll", "announcement"] as const;
