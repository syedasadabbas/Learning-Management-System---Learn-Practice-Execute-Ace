// =============================================================================
// PRESENTATIONS — LIVE_CLASSES_AND_PRESENTATIONS_STRATEGY.md §3.4.
// Owner: the lms-complete-enhancement wave (Subagent 1, database architect).
// -----------------------------------------------------------------------------
// WHY A SIBLING MODULE: drizzle.config.ts:9-15, same rule as every other module in
// src/db/. An unlisted module is a set of tables drizzle-kit will offer to DROP, and
// here that means dropping student-authored slide decks that exist nowhere else.
//
// =============================================================================
// WHAT THIS SCHEMA HAS TO ENFORCE
// =============================================================================
//
// 1. ONE SLIDE NUMBER PER PRESENTATION. `presentation_slides` has a UNIQUE index on
//    (presentation_id, slide_number). Without it two concurrent "insert slide at 4"
//    calls both succeed and the deck's order becomes whatever Postgres returns,
//    which is not stable across an UPDATE. Slide numbers are 1-based and CHECKed > 0
//    because "slide 0" has no meaning to a presenter reading a slide counter.
//
// 2. `slides_json` AND `presentation_slides` ARE NOT TWO SOURCES OF TRUTH, and the
//    reason is worth stating because the shape invites the opposite reading.
//    `presentations.slides_json` is the EDITOR DOCUMENT: what the builder loads, what
//    reveal.js renders, saved and read as one atomic blob (the spec requires it —
//    STRATEGY.md:709). `presentation_slides` is the QUERYABLE PROJECTION of that same
//    document, written by the save handler, and it exists so that per-slide artefacts
//    — a comment on slide 7, a thumbnail, a per-slide edit — are addressable rows
//    rather than paths into a blob. If they ever disagree, `slides_json` wins; that
//    rule lives here and at the save call site, not in a reader's assumption.
//
// 3. A RATING IS BOUNDED. `presentation_feedback.rating` is 1-5 and
//    `presentation_submissions.score` is 0-100, both CHECKed. A 6-star rating is not
//    a validation error someone will notice; it is a star renderer that overflows its
//    row and an average that nobody can explain.
//
// 4. THE SUBMISSION STATUS REUSES THE EXISTING `submission_status` pgEnum
//    (schema.ts:43). The spec asks for submitted | under_review | graded, which is
//    that enum minus 'returned'. Declaring a second three-valued enum with the same
//    labels would give the instructor queue two spellings of "graded" to filter on
//    and one of them would eventually be wrong. Prefer what exists. 'returned' is
//    simply unused by this surface.
//
// 5. GRADING IS CONSISTENT WITH ITSELF. `graded_at`, `graded_by` and `score` either
//    all describe a graded submission or none of them do — CHECKed, so a partially
//    written grade cannot sit in the table looking like a finished one.
//
// Every timestamp is `timestamptz` written by the DATABASE's clock. Durations are in
// seconds and named in the column.
// =============================================================================

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
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

import { liveClasses } from "./schema.live-classes";
import { assignments, submissionStatus, users } from "./schema";

/** How a presentation was delivered for assessment. */
export const presentationSubmissionType = pgEnum("presentation_submission_type", [
  "recorded",
  "live",
  "document",
]);

/** Who the feedback came from. Drives both the label and who may read it. */
export const presentationFeedbackType = pgEnum("presentation_feedback_type", [
  "peer",
  "instructor",
  "self",
]);

/**
 * A slide deck. Authored by a student (an assignment deliverable) or by an
 * instructor (teaching material, possibly a reusable template).
 */
export const presentations = pgTable(
  "presentations",
  {
    id: serial("id").primaryKey(),

    creatorId: integer("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The assignment this deck answers, if any. `set null`, not `cascade`: deleting
     * an assignment must not destroy the student's work — the deck stays in their
     * library, merely unattached.
     */
    assignmentId: integer("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),

    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    /** reveal.js theme key. varchar: themes are added without a migration. */
    theme: varchar("theme", { length: 50 }).notNull().default("default"),
    isPublished: boolean("is_published").notNull().default(false),
    /** A published deck other users may clone as a starting point. */
    isTemplate: boolean("is_template").notNull().default(false),

    /**
     * THE EDITOR DOCUMENT — see §2 of the file header, which explains why this
     * coexists with `presentation_slides` and which of the two wins.
     * Shape: `{ version: number; slides: Slide[]; metadata: {...} }`
     * (STRATEGY.md:709-717). NOT NULL: a deck with no document cannot be opened, and
     * an empty deck is `{ version: 1, slides: [] }`, said explicitly.
     */
    slidesJson: jsonb("slides_json").notNull(),

    showSpeakerNotes: boolean("show_speaker_notes").notNull().default(true),
    showSlideNumbers: boolean("show_slide_numbers").notNull().default(true),
    allowExport: boolean("allow_export").notNull().default(true),

    /**
     * FALSE by default. A student deck may contain personal work and coursework in
     * progress; publishing it beyond the cohort is an explicit act, never a default.
     */
    isPublic: boolean("is_public").notNull().default(false),
    /** `UserRole[]` — e.g. ["student","instructor"]. Null means "not shared by role". */
    sharedWithRoles: jsonb("shared_with_roles"),

    /**
     * The live class this deck was presented in. `set null` — a deck outlives the
     * session it was shown in, and archiving a class must not orphan teaching material.
     */
    relatedClassId: integer("related_class_id").references(() => liveClasses.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set when `is_published` first flips true. Kept as its own column rather than
     * inferred from `updated_at`, because every subsequent save moves `updated_at` and
     * "when did this become visible to others?" is an access question, not an edit one.
     */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /** Denormalized counters, incremented by the view and present handlers. CHECKed >= 0. */
    viewCount: integer("view_count").notNull().default(0),
    presentationCount: integer("presentation_count").notNull().default(0),
  },
  (t) => ({
    /** Serves "my presentations". */
    creatorIdx: index("presentations_creator_idx").on(t.creatorId),
    /** Serves the instructor's "decks submitted for this assignment". */
    assignmentIdx: index("presentations_assignment_idx").on(t.assignmentId),
    /** Serves the published gallery. */
    publishedIdx: index("presentations_published_idx").on(t.isPublished),
    /** Serves the template picker in the builder. */
    templateIdx: index("presentations_template_idx").on(t.isTemplate),
    /** Serves "the decks shown in this class", on the class recap page. */
    relatedClassIdx: index("presentations_related_class_idx").on(t.relatedClassId),
    /** Serves the gallery's default ordering: published, newest first. */
    publishedAtIdx: index("presentations_published_at_idx").on(t.isPublished, t.publishedAt),

    countersNonNegative: check(
      "presentations_counters_non_negative",
      sql`${t.viewCount} >= 0 AND ${t.presentationCount} >= 0`,
    ),
    /**
     * A published deck has a publication time and an unpublished one does not. Without
     * this the gallery can hold rows it cannot date, and `publishedAt` stops being a
     * usable sort key.
     */
    publishedConsistent: check(
      "presentations_published_consistent",
      sql`(${t.publishedAt} IS NOT NULL) = ${t.isPublished}`,
    ),
  }),
);

/**
 * One slide, as a queryable row. See §2 of the file header for its relationship to
 * `presentations.slides_json` — this table is the projection, not the original.
 */
export const presentationSlides = pgTable(
  "presentation_slides",
  {
    id: serial("id").primaryKey(),

    presentationId: integer("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),

    /** 1-based position. See §1: UNIQUE per presentation and CHECKed > 0. */
    slideNumber: integer("slide_number").notNull(),

    /** 'title' | 'content' | 'image' | 'code' | 'chart' | ... varchar: the slide-type
     *  registry grows with the builder and an unknown type must degrade to a plain
     *  content slide rather than break the deck. */
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }),
    body: text("body"),
    /** Presenter-only. MUST NOT be included in any audience-facing projection. */
    speakerNotes: text("speaker_notes"),

    /** Type-specific payload: `{ code, language }`, `{ url, alt, caption }`, chart data. */
    contentJson: jsonb("content_json"),

    /** 'default' | 'two-column' | 'centered'. */
    layout: varchar("layout", { length: 50 }),

    /** Hex colours, `#rrggbb`. Length 7 is the format, and the CHECK is the guard:
     *  an unvalidated colour string lands in a `style` attribute. */
    backgroundColor: varchar("background_color", { length: 7 }),
    backgroundImageUrl: varchar("background_image_url", { length: 500 }),
    textColor: varchar("text_color", { length: 7 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** §1. Also the ON CONFLICT target for the save handler's per-slide upsert. */
    numberIdx: uniqueIndex("presentation_slides_number_idx").on(t.presentationId, t.slideNumber),
    /** Serves "load the deck in order" — the only read of this table that is not by key. */
    presentationIdx: index("presentation_slides_presentation_idx").on(t.presentationId),

    slideNumberPositive: check("presentation_slides_number_positive", sql`${t.slideNumber} > 0`),
    /**
     * Colours are `#rrggbb` or nothing. Enforced by Postgres because these strings are
     * interpolated into inline styles, and a value that is neither a colour nor null is
     * the shape of that problem.
     */
    hexColors: check(
      "presentation_slides_hex_colors",
      sql`(${t.backgroundColor} IS NULL OR ${t.backgroundColor} ~ '^#[0-9A-Fa-f]{6}$') AND (${t.textColor} IS NULL OR ${t.textColor} ~ '^#[0-9A-Fa-f]{6}$')`,
    ),
  }),
);

/**
 * "Student S submitted presentation P for assignment A", plus its grade.
 *
 * SEPARATE FROM `submissions` (schema.ts:378), which ingests Google-Form rows and
 * carries no presentation columns. Merging would put `video_duration_seconds` and
 * `audience_count` on every ordinary assignment submission, and would make the
 * ingest job's unique key ambiguous. The two share the `submission_status` enum
 * (§4) so the instructor queue can filter both the same way.
 */
export const presentationSubmissions = pgTable(
  "presentation_submissions",
  {
    id: serial("id").primaryKey(),

    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    presentationId: integer("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),
    /**
     * DENORMALIZED author. It is reachable via `presentations.creator_id`, and it is
     * copied here anyway for the same reason `peer_review_allocations.reviewee_id`
     * exists (schema.peer-review.ts §1): the "one submission per (assignment, student)"
     * unique index below cannot be expressed across a join. The redundancy IS the
     * constraint.
     */
    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    submissionType: presentationSubmissionType("submission_type").notNull().default("recorded"),

    /** Recorded delivery. Seconds, CHECKed >= 0. */
    videoUrl: varchar("video_url", { length: 500 }),
    videoDurationSeconds: integer("video_duration_seconds"),

    /** Live delivery: when it was given and how many were in the room. */
    presentationDate: timestamp("presentation_date", { withTimezone: true }),
    audienceCount: integer("audience_count"),

    /** 0-100, CHECKed. See §3 and §5. */
    score: integer("score"),
    feedback: text("feedback"),
    /** `Record<criterionKey, number>` — same convention as `peer_reviews.rubric_scores`. */
    rubricScores: jsonb("rubric_scores"),
    gradedBy: integer("graded_by").references(() => users.id, { onDelete: "set null" }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),

    /** Reuses the existing `submission_status` pgEnum — §4. */
    status: submissionStatus("status").notNull().default("submitted"),
  },
  (t) => ({
    /**
     * ONE SUBMISSION PER (ASSIGNMENT, STUDENT) — the reason `studentId` is
     * denormalized onto this row. Resubmitting REPLACES the deck reference on the
     * existing row; it does not create a second submission the instructor would have
     * to choose between.
     */
    assignmentStudentIdx: uniqueIndex("presentation_submissions_assignment_student_idx").on(
      t.assignmentId,
      t.studentId,
    ),
    /** Serves "my submissions". */
    studentIdx: index("presentation_submissions_student_idx").on(t.studentId),
    /** Serves the grading queue for one assignment. */
    assignmentIdx: index("presentation_submissions_assignment_idx").on(t.assignmentId),
    /** Serves the queue's actual filter: this assignment, still ungraded, oldest first. */
    assignmentStatusIdx: index("presentation_submissions_assignment_status_idx").on(
      t.assignmentId,
      t.status,
      t.submittedAt,
    ),
    /** Serves the reverse lookup "has this deck been submitted anywhere?". */
    presentationIdx: index("presentation_submissions_presentation_idx").on(t.presentationId),

    /** §3. */
    scoreInRange: check(
      "presentation_submissions_score_in_range",
      sql`${t.score} IS NULL OR (${t.score} >= 0 AND ${t.score} <= 100)`,
    ),
    durationNonNegative: check(
      "presentation_submissions_duration_non_negative",
      sql`${t.videoDurationSeconds} IS NULL OR ${t.videoDurationSeconds} >= 0`,
    ),
    audienceNonNegative: check(
      "presentation_submissions_audience_non_negative",
      sql`${t.audienceCount} IS NULL OR ${t.audienceCount} >= 0`,
    ),
    /** §5: a grade is whole or absent, never half-written. */
    gradeConsistent: check(
      "presentation_submissions_grade_consistent",
      sql`(${t.gradedAt} IS NULL AND ${t.score} IS NULL) OR (${t.gradedAt} IS NOT NULL AND ${t.score} IS NOT NULL)`,
    ),
    gradedAfterSubmitted: check(
      "presentation_submissions_graded_after_submitted",
      sql`${t.gradedAt} IS NULL OR ${t.gradedAt} >= ${t.submittedAt}`,
    ),
  }),
);

/**
 * EVERY GRADE EVER GIVEN TO A PRESENTATION SUBMISSION, append-only.
 *
 * WHY THIS TABLE EXISTS. `presentation_submissions` carries exactly ONE grade: a
 * regrade overwrites `score`, `feedback`, `rubric_scores`, `graded_by` and
 * `graded_at` in place. That is fine when the grader corrects their own typo and it
 * is not fine in the case the security review recorded (Finding 2,
 * SECURITY_REVIEW_ADDON_WAVE.md:160): `assignments` has no owning-instructor column,
 * so `apiGuard("instructor")` admits every instructor to every submission, and one
 * instructor overwriting a colleague's mark left NO trace of the mark that was there
 * before — not even who gave it. Grades feed the leaderboard, so that is a silent,
 * unattributable change to a student's standing.
 *
 * WHAT IT DOES AND DOES NOT FIX. It does NOT restore owner-scoping; that needs an
 * owning-instructor column on `assignments`, which is a shared-contracts seam change
 * and is deliberately out of scope. What it makes true is weaker and still worth
 * having: a regrade is no longer DESTRUCTIVE, and it is ATTRIBUTABLE. The prior grade
 * is still on this table, with the id of the instructor who gave it and the instant
 * they gave it, so a disputed mark can be reconstructed and an overwrite can be
 * noticed. Detection where prevention is unavailable.
 *
 * APPEND-ONLY IS ENFORCED BY THE ABSENCE OF AN UPDATE PATH, the same way
 * `peer_reviews` makes a submitted review immutable (schema.peer-review.ts §3): there
 * is no `updated_at`, nothing in src/ issues an UPDATE or a DELETE against it, and the
 * grade handler only ever INSERTs. A database-level guarantee would need a rule or a
 * trigger, which this schema uses nowhere else; the invariant is stated here so that a
 * future writer has to break it deliberately.
 *
 * ONE ROW PER GRADING EVENT, INCLUDING THE FIRST. Recording only supersessions would
 * mean the very first grade — the one a dispute is most often about — is the one grade
 * with no history row, and "no row" would then be ambiguous between "never regraded"
 * and "never graded".
 */
export const presentationGradeEvents = pgTable(
  "presentation_grade_events",
  {
    id: serial("id").primaryKey(),

    submissionId: integer("submission_id")
      .notNull()
      .references(() => presentationSubmissions.id, { onDelete: "cascade" }),

    /**
     * The grade AS GIVEN at this event — a snapshot, not a diff. A diff would have to
     * be replayed from the beginning to answer "what did the student see in March?",
     * and one missing row makes every later answer wrong.
     */
    score: integer("score").notNull(),
    feedback: text("feedback"),
    rubricScores: jsonb("rubric_scores"),

    /**
     * Who graded, from the SESSION at the time — never from a payload, for the reason
     * the grade route's header gives.
     *
     * NULLABLE with ON DELETE SET NULL, matching `presentation_submissions.graded_by`.
     * A compromise, and named as one: for an audit trail the ideal is that deleting a
     * user cannot erase their authorship, but RESTRICT would make an audit row block an
     * account deletion the LMS otherwise allows, and this table must never be the
     * reason another operation fails. The event, its score and its timestamp survive
     * the deletion; only the name attached to it does not.
     */
    gradedBy: integer("graded_by").references(() => users.id, { onDelete: "set null" }),

    /**
     * The instant this grade took effect — the same value written to
     * `presentation_submissions.graded_at` in the same transaction, so the two tables
     * can be reconciled and the current grade identified in the history without
     * guessing.
     */
    gradedAt: timestamp("graded_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    /**
     * THE ONLY QUERY THIS TABLE SERVES: "the grade history of one submission, newest
     * first". Composite rather than a bare `submission_id` index because the order is
     * part of the question — reading a history in an unspecified order is how the wrong
     * grade comes to be called the current one.
     */
    submissionGradedAtIdx: index("presentation_grade_events_submission_graded_at_idx").on(
      t.submissionId,
      t.gradedAt,
    ),
    /** The same 0-100 bound as `presentation_submissions.score` — see §3. */
    scoreInRange: check(
      "presentation_grade_events_score_in_range",
      sql`${t.score} >= 0 AND ${t.score} <= 100`,
    ),
  }),
);

/**
 * A comment on a presentation, from a peer, an instructor, or the author themself.
 *
 * BOTH ENDPOINTS ARE STORED. `to_user_id` is the deck's author at the time the
 * feedback was written, denormalized from `presentations.creator_id` so the
 * "feedback addressed to me" inbox is a single-column index lookup rather than a
 * join, and so the CHECK below can see both parties on one row.
 */
export const presentationFeedback = pgTable(
  "presentation_feedback",
  {
    id: serial("id").primaryKey(),

    presentationId: integer("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),
    fromUserId: integer("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: integer("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    feedbackType: presentationFeedbackType("feedback_type").notNull().default("peer"),
    comment: text("comment").notNull(),
    /** 1-5 stars. Nullable — a written comment without a rating is valid. §3 bounds it. */
    rating: integer("rating"),

    /** 'content' | 'design' | 'delivery'. varchar: the category list is editorial. */
    category: varchar("category", { length: 50 }),
    improvementSuggestions: text("improvement_suggestions"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Serves the feedback panel on a deck, newest first. */
    presentationCreatedIdx: index("presentation_feedback_presentation_created_idx").on(
      t.presentationId,
      t.createdAt,
    ),
    /** Serves "feedback I have received". */
    toUserIdx: index("presentation_feedback_to_user_idx").on(t.toUserId),
    /** Serves "feedback I have given", and the moderator's per-author view. */
    fromUserIdx: index("presentation_feedback_from_user_idx").on(t.fromUserId),
    /** Serves the "instructor feedback only" filter students ask for first. */
    typeIdx: index("presentation_feedback_type_idx").on(t.feedbackType),

    /** §3. */
    ratingInRange: check(
      "presentation_feedback_rating_in_range",
      sql`${t.rating} IS NULL OR (${t.rating} >= 1 AND ${t.rating} <= 5)`,
    ),
    /**
     * Self-feedback is a REFLECTION and must say so. Without this, a student rating
     * their own deck five stars is indistinguishable from a peer doing it, and the
     * average shown on the gallery card becomes unusable.
     */
    selfFeedbackTyped: check(
      "presentation_feedback_self_typed",
      sql`(${t.fromUserId} = ${t.toUserId}) = (${t.feedbackType} = 'self')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const presentationsRelations = relations(presentations, ({ one, many }) => ({
  creator: one(users, { fields: [presentations.creatorId], references: [users.id] }),
  assignment: one(assignments, {
    fields: [presentations.assignmentId],
    references: [assignments.id],
  }),
  relatedClass: one(liveClasses, {
    fields: [presentations.relatedClassId],
    references: [liveClasses.id],
  }),
  slides: many(presentationSlides),
  submissions: many(presentationSubmissions),
  feedback: many(presentationFeedback),
}));

export const presentationSlidesRelations = relations(presentationSlides, ({ one }) => ({
  presentation: one(presentations, {
    fields: [presentationSlides.presentationId],
    references: [presentations.id],
  }),
}));

export const presentationSubmissionsRelations = relations(
  presentationSubmissions,
  ({ one, many }) => ({
    assignment: one(assignments, {
      fields: [presentationSubmissions.assignmentId],
      references: [assignments.id],
    }),
    presentation: one(presentations, {
      fields: [presentationSubmissions.presentationId],
      references: [presentations.id],
    }),
    student: one(users, {
      fields: [presentationSubmissions.studentId],
      references: [users.id],
      relationName: "presentation_submission_student",
    }),
    grader: one(users, {
      fields: [presentationSubmissions.gradedBy],
      references: [users.id],
      relationName: "presentation_submission_grader",
    }),
    /** Every grade this submission has ever carried. Append-only; see the table. */
    gradeEvents: many(presentationGradeEvents),
  }),
);

export const presentationGradeEventsRelations = relations(presentationGradeEvents, ({ one }) => ({
  submission: one(presentationSubmissions, {
    fields: [presentationGradeEvents.submissionId],
    references: [presentationSubmissions.id],
  }),
  grader: one(users, {
    fields: [presentationGradeEvents.gradedBy],
    references: [users.id],
    relationName: "presentation_grade_event_grader",
  }),
}));

export const presentationFeedbackRelations = relations(presentationFeedback, ({ one }) => ({
  presentation: one(presentations, {
    fields: [presentationFeedback.presentationId],
    references: [presentations.id],
  }),
  fromUser: one(users, {
    fields: [presentationFeedback.fromUserId],
    references: [users.id],
    relationName: "presentation_feedback_author",
  }),
  toUser: one(users, {
    fields: [presentationFeedback.toUserId],
    references: [users.id],
    relationName: "presentation_feedback_recipient",
  }),
}));

export type Presentation = typeof presentations.$inferSelect;
export type NewPresentation = typeof presentations.$inferInsert;
export type PresentationSlide = typeof presentationSlides.$inferSelect;
export type NewPresentationSlide = typeof presentationSlides.$inferInsert;
export type PresentationSubmission = typeof presentationSubmissions.$inferSelect;
export type NewPresentationSubmission = typeof presentationSubmissions.$inferInsert;
export type PresentationGradeEvent = typeof presentationGradeEvents.$inferSelect;
export type NewPresentationGradeEvent = typeof presentationGradeEvents.$inferInsert;
export type PresentationFeedback = typeof presentationFeedback.$inferSelect;
export type NewPresentationFeedback = typeof presentationFeedback.$inferInsert;

/** Enum values as arrays, for exhaustive switches. Mirrors the pgEnums above. */
export const PRESENTATION_SUBMISSION_TYPES = ["recorded", "live", "document"] as const;
export const PRESENTATION_FEEDBACK_TYPES = ["peer", "instructor", "self"] as const;
