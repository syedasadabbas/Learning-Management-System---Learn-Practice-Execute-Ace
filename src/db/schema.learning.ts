// =============================================================================
// LEARNING-ENHANCEMENT TABLES — TECHNICAL_SPECIFICATION.md §1.1.
// Owner: the lms-complete-enhancement wave (Subagent 1, database architect).
// -----------------------------------------------------------------------------
// WHY A SIBLING MODULE. drizzle.config.ts:9-15 states the rule and
// schema.access.ts, schema.submissions.ts, schema.queue.ts, schema.notifications.ts,
// schema.badges.ts and schema.peer-review.ts are the precedents: `schema.ts` is the
// frozen Wave 0 seam and a stream that needs tables of its own adds a module plus
// ONE line to that config's `schema` array. An unlisted module is worse than a
// missing one — drizzle-kit treats a table it cannot see as a table to DROP.
//
// =============================================================================
// WHAT THIS SCHEMA HAS TO ENFORCE, because the alternative is enforcing it in
// four call sites that can each get it wrong.
// =============================================================================
//
// 1. ORDERING IS A DATABASE FACT, NOT A RENDER-TIME SORT.
//    Every table here is an ORDERED LIST attached to a parent (samples under an
//    assignment, problems and visualisations under a lecture, questions under a
//    lecture or a week). Each carries a UNIQUE(parent, order) constraint, so two
//    admins cannot land two rows at position 3 and leave the surface to pick one
//    arbitrarily — the second INSERT fails and the caller has to decide. Without
//    the constraint "the order of the hints a student sees" would silently depend
//    on physical row order, which changes after any UPDATE.
//
// 2. AN ORDER INDEX IS NEVER NEGATIVE. A CHECK, not a zod refinement, because a
//    seeder script and a hand-written INSERT during content authoring both bypass
//    zod and neither is a code path anyone reviews.
//
// 3. THE ENUM-LIKE COLUMNS REUSE THE EXISTING pgEnums (`proficiency_level`,
//    `execution_mode`) rather than declaring parallel varchar columns. The spec
//    names exactly those two types, they already exist in schema.ts:61,86, and a
//    second spelling of "beginner | intermediate | advanced" is a filter that
//    silently returns nothing the day someone writes 'Beginner'.
//
// 4. `interview_questions` MAY HANG OFF A LECTURE **OR** A WEEK. Both FKs are
//    nullable and exactly one must be set — a PARTIAL unique index per parent
//    plus a CHECK that forbids the neither/both cases. Modelled this way rather
//    than as two tables because every read is "give me the interview questions
//    for this scope" and two tables would double every query for no gain.
//
// PRIMARY KEYS ARE `serial` and FKs are `integer`, matching every table in
// src/db/schema.ts. Every timestamp is `timestamptz` written by the DATABASE's
// clock. Every measurement is metric (durations in minutes, sizes in px).
// =============================================================================

import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { assignments, executionMode, lectures, proficiencyLevel, users, weeks } from "./schema";

/**
 * A worked SAMPLE shown to a student BEFORE they attempt an assignment:
 * "here is what 'done' looks like, and here is the code that produced it".
 *
 * Spec: TECHNICAL_SPECIFICATION.md:26-76. A child table rather than a jsonb blob
 * on `assignments` because a sample is addressable on its own — an instructor
 * edits "Mobile view" without rewriting the desktop one, and the surface deep-links
 * to a single sample.
 */
export const assignmentSamples = pgTable(
  "assignment_samples",
  {
    id: serial("id").primaryKey(),

    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),

    /** Human label for the variant: "Desktop View", "Mobile", "Reference". */
    title: varchar("title", { length: 255 }).notNull(),
    /** What this particular sample is meant to demonstrate. */
    description: text("description"),

    /** Position in the sample carousel. See §1 and §2 of the file header. */
    sampleOrder: integer("sample_order").notNull().default(0),

    /**
     * Rendered preview markup. UNTRUSTED BY CONSTRUCTION: it is authored HTML and
     * is intended to be rendered inside a sandboxed iframe, never injected into the
     * app document. Stated here because the column name invites the mistake.
     */
    sampleOutputHtml: text("sample_output_html"),
    /** Static screenshot, for the list view where rendering N iframes is not viable. */
    screenshotUrl: varchar("screenshot_url", { length: 500 }),

    /**
     * `CodeExampleFile[]` — see TECHNICAL_SPECIFICATION.md:311-333 for the shape
     * (filename, language, code, explanation, highlighted_lines, line_explanations).
     *
     * jsonb rather than an `assignment_sample_files` child table: the files of one
     * sample are always read as a whole set by the code viewer, never queried across
     * samples, and a child table would add a join plus its own ordering column to
     * keep in step. The cost is stated: jsonb accepts anything, so the reader must
     * treat a stored blob as untrusted input rather than as a type.
     */
    codeExample: jsonb("code_example"),

    /** A working deployment of the sample, if one exists. */
    liveUrl: varchar("live_url", { length: 500 }),

    /** `string[]` — "Responsive", "Form validation". Shown as chips above the code. */
    features: jsonb("features"),

    /** Optional video walkthrough (YouTube embed url or similar). */
    videoWalkthroughUrl: varchar("video_walkthrough_url", { length: 500 }),

    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Serves "show me the samples for this assignment" — the only read there is. */
    assignmentIdx: index("assignment_samples_assignment_idx").on(t.assignmentId),
    /** Serves the admin console's "recently authored content" listing. */
    createdAtIdx: index("assignment_samples_created_at_idx").on(t.createdAt),
    /** §1: one sample per position. Also the ON CONFLICT target for re-seeding. */
    orderIdx: uniqueIndex("assignment_samples_order_idx").on(t.assignmentId, t.sampleOrder),
    /** §2. */
    orderNonNegative: check("assignment_samples_order_non_negative", sql`${t.sampleOrder} >= 0`),
  }),
);

/**
 * A scaffolded PRACTICE PROBLEM attached to a lecture: context, statement,
 * acceptance criteria, starter code, progressive hints, reference solution.
 *
 * Spec: TECHNICAL_SPECIFICATION.md:80-135.
 *
 * DISTINCT FROM `coding_problems` (schema.ts:648), deliberately. `coding_problems`
 * are standalone, graded, cohort-wide challenges with a `coding_attempts` ledger;
 * these are ungraded, per-lecture, and carry hints and a published solution. Merging
 * them would mean one table where half the columns are null for half the rows and
 * where "is this scored?" becomes a flag every caller must remember to check.
 */
export const practiceProblems = pgTable(
  "practice_problems",
  {
    id: serial("id").primaryKey(),

    lectureId: integer("lecture_id")
      .notNull()
      .references(() => lectures.id, { onDelete: "cascade" }),

    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    /** Reuses the existing `proficiency_level` pgEnum — see §3 of the file header. */
    difficultyLevel: proficiencyLevel("difficulty_level").notNull().default("beginner"),

    /** `string[]` — "Understand flexbox", "Implement responsive layout". */
    learningObjectives: jsonb("learning_objectives"),

    /** WHY this problem matters. Required: a problem with no motivation is a chore. */
    problemContext: text("problem_context").notNull(),
    /** WHAT the student must do. */
    problemStatement: text("problem_statement").notNull(),
    /** `Array<{ criteria: string; how_to_verify: string }>`. */
    acceptanceCriteria: jsonb("acceptance_criteria"),

    starterCode: text("starter_code"),
    /**
     * 'html' | 'css' | 'javascript' | 'python' | ... varchar, not a pgEnum, matching
     * `questions.language` (schema.ts, add-on wave): the language list grows with the
     * curriculum and an unrecognised value must render verbatim rather than crash a page.
     */
    starterLanguage: varchar("starter_language", { length: 32 }),

    /**
     * `Array<{ level: number; text: string }>` — TECHNICAL_SPECIFICATION.md:337-353.
     * NOT NULL: the progressive-hint ladder is the whole point of a "scaffolded"
     * problem, and a null here would render a hint button that opens nothing. An
     * empty array is the way to say "no hints" explicitly.
     */
    hints: jsonb("hints").notNull(),

    solutionCode: text("solution_code"),
    solutionExplanation: text("solution_explanation"),
    solutionScreenshotUrl: varchar("solution_screenshot_url", { length: 500 }),

    /** `Array<{ name: string; input: string; expected: string }>`. */
    testCases: jsonb("test_cases"),

    /** Reuses the existing `execution_mode` pgEnum — see §3. */
    execution: executionMode("execution_mode").notNull().default("browser"),

    /** Position in the lecture's problem set. See §1 and §2. */
    problemOrder: integer("problem_order").notNull().default(0),

    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Serves "the practice set for this lecture". */
    lectureIdx: index("practice_problems_lecture_idx").on(t.lectureId),
    /** Serves the "practice by difficulty" filter on the practice hub. */
    difficultyIdx: index("practice_problems_difficulty_idx").on(t.difficultyLevel),
    /** §1: one problem per position within a lecture. */
    orderIdx: uniqueIndex("practice_problems_order_idx").on(t.lectureId, t.problemOrder),
    /** §2. */
    orderNonNegative: check("practice_problems_order_non_negative", sql`${t.problemOrder} >= 0`),
  }),
);

/**
 * An INTERVIEW QUESTION woven into the curriculum: the question, a model answer,
 * the mistakes candidates actually make, and where to go next.
 *
 * Spec: TECHNICAL_SPECIFICATION.md:139-195. See §4 of the file header for why the
 * lecture/week duality is one table with two nullable parents and a CHECK.
 */
export const interviewQuestions = pgTable(
  "interview_questions",
  {
    id: serial("id").primaryKey(),

    /** Exactly one of `lectureId` / `weekId` is set — enforced by `exactlyOneParent`. */
    lectureId: integer("lecture_id").references(() => lectures.id, { onDelete: "cascade" }),
    weekId: integer("week_id").references(() => weeks.id, { onDelete: "cascade" }),

    title: varchar("title", { length: 255 }).notNull(),
    /** Reuses the existing `proficiency_level` pgEnum — see §3. */
    difficultyLevel: proficiencyLevel("difficulty_level").notNull().default("intermediate"),
    /** 'Technical' | 'Behavioral' | 'Design'. varchar for the same reason as `starter_language`. */
    category: varchar("category", { length: 50 }),
    questionText: text("question_text").notNull(),

    /** Why an interviewer asks this — the part that makes the answer memorable. */
    context: text("context"),

    /**
     * NOT NULL. A question with no model answer is a quiz item, not interview prep;
     * the surface has nothing to render behind "Show answer" and the student is left
     * worse off than before they clicked.
     */
    sampleAnswer: text("sample_answer").notNull(),
    answerExplanation: text("answer_explanation"),

    /**
     * `Array<{ mistake, why_wrong, correction }>` — TECHNICAL_SPECIFICATION.md:357-366.
     */
    commonMistakes: jsonb("common_mistakes"),
    /** `string[]` — what the interviewer asks next. */
    followUpQuestions: jsonb("follow_up_questions"),

    /** Authored SVG/HTML diagram. Same sandboxing caveat as `sample_output_html`. */
    visualWalkthroughHtml: text("visual_walkthrough_html"),
    codeExample: text("code_example"),

    /** `string[]` — concept names, used to cross-link lectures. */
    relatedConcepts: jsonb("related_concepts"),
    /**
     * "Now go practise it." `set null` rather than `cascade`: deleting a practice
     * problem must not silently delete curated interview content that merely pointed
     * at it.
     */
    relatedPracticeId: integer("related_practice_id").references(() => practiceProblems.id, {
      onDelete: "set null",
    }),

    questionOrder: integer("question_order").notNull().default(0),

    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lectureIdx: index("interview_questions_lecture_idx").on(t.lectureId),
    weekIdx: index("interview_questions_week_idx").on(t.weekId),
    /** Serves the "interview prep by difficulty" filter. */
    difficultyIdx: index("interview_questions_difficulty_idx").on(t.difficultyLevel),

    /**
     * PARTIAL unique indexes, one per parent. A plain UNIQUE(lecture_id, order) would
     * not constrain the week-scoped rows at all, because in Postgres every NULL is
     * distinct and (NULL, 0) never conflicts with (NULL, 0). The `where` clause is
     * what makes each of these an actual constraint on its half of the table.
     */
    lectureOrderIdx: uniqueIndex("interview_questions_lecture_order_idx")
      .on(t.lectureId, t.questionOrder)
      .where(sql`${t.lectureId} IS NOT NULL`),
    weekOrderIdx: uniqueIndex("interview_questions_week_order_idx")
      .on(t.weekId, t.questionOrder)
      .where(sql`${t.weekId} IS NOT NULL`),

    /**
     * §4. Neither parent set = an orphan nothing can ever list. Both set = a row that
     * appears twice, under a lecture and under its week, with no way for the reader to
     * know it is the same row. Postgres refuses both.
     */
    exactlyOneParent: check(
      "interview_questions_exactly_one_parent",
      sql`(${t.lectureId} IS NULL) <> (${t.weekId} IS NULL)`,
    ),
    orderNonNegative: check("interview_questions_order_non_negative", sql`${t.questionOrder} >= 0`),
  }),
);

/**
 * A VISUALISATION for a concept in a lecture: an SVG diagram, an animation spec, or
 * the config for an interactive component.
 *
 * Spec: TECHNICAL_SPECIFICATION.md:199-238.
 */
export const lectureVisualizations = pgTable(
  "lecture_visualizations",
  {
    id: serial("id").primaryKey(),

    lectureId: integer("lecture_id")
      .notNull()
      .references(() => lectures.id, { onDelete: "cascade" }),

    /**
     * DENORMALIZED, on purpose: the stable concept slug from `lectures.topic_key`
     * (schema.ts, add-on wave). It is copied here so a visualisation can be looked up
     * by concept WITHOUT a join, which is what the "show me every diagram that
     * explains css-flexbox" cross-lecture query needs; the lecture-scoped read uses
     * `lectureId` and ignores this column. Nullable because `lectures.topic_key` is.
     * NOT a source of truth — `lectures.topic_key` is.
     */
    topicKey: varchar("topic_key", { length: 120 }),

    /**
     * 'diagram' | 'animation' | 'interactive'. varchar rather than a pgEnum: the
     * renderer registry grows faster than a migration cadence, and an unrecognised
     * type must fall back to "unsupported visualisation" rather than crash the lecture.
     */
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    /** Authored SVG. Same sandboxing caveat as `sample_output_html`. */
    svgMarkup: text("svg_markup"),
    /** Framer-Motion-shaped animation spec. */
    animationSpec: jsonb("animation_spec"),
    /** Props for the interactive component named by `type`. */
    interactiveData: jsonb("interactive_data"),

    explanation: text("explanation"),
    /** The single concept this visual teaches — the caption under the figure. */
    learningPoint: text("learning_point"),

    /** Suggested intrinsic size. Pixels; CHECKed positive so a 0-height figure cannot ship. */
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),

    isInteractive: boolean("is_interactive").notNull().default(false),

    orderIndex: integer("order_index").notNull().default(0),

    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Serves "render the figures for this lecture", in order. */
    lectureIdx: index("lecture_visualizations_lecture_idx").on(t.lectureId, t.orderIndex),
    /** Serves the cross-lecture "every diagram for this concept" query — see `topicKey`. */
    topicIdx: index("lecture_visualizations_topic_idx").on(t.topicKey),
    /** §1. */
    orderIdx: uniqueIndex("lecture_visualizations_order_idx").on(t.lectureId, t.orderIndex),
    /** §2. */
    orderNonNegative: check("lecture_visualizations_order_non_negative", sql`${t.orderIndex} >= 0`),
    /** A figure with a zero or negative dimension is a layout bug shipped as data. */
    sizePositive: check(
      "lecture_visualizations_size_positive",
      sql`(${t.widthPx} IS NULL OR ${t.widthPx} > 0) AND (${t.heightPx} IS NULL OR ${t.heightPx} > 0)`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Relations. Declared for every table in this module so the relational query
// builder (`db.query.*.findMany({ with: ... })`) can traverse them; without these
// the tables are reachable only through hand-written joins.
// ---------------------------------------------------------------------------

export const assignmentSamplesRelations = relations(assignmentSamples, ({ one }) => ({
  assignment: one(assignments, {
    fields: [assignmentSamples.assignmentId],
    references: [assignments.id],
  }),
  author: one(users, { fields: [assignmentSamples.createdBy], references: [users.id] }),
}));

export const practiceProblemsRelations = relations(practiceProblems, ({ one, many }) => ({
  lecture: one(lectures, { fields: [practiceProblems.lectureId], references: [lectures.id] }),
  author: one(users, { fields: [practiceProblems.createdBy], references: [users.id] }),
  /** The interview questions that point here via `related_practice_id`. */
  interviewQuestions: many(interviewQuestions),
}));

export const interviewQuestionsRelations = relations(interviewQuestions, ({ one }) => ({
  lecture: one(lectures, { fields: [interviewQuestions.lectureId], references: [lectures.id] }),
  week: one(weeks, { fields: [interviewQuestions.weekId], references: [weeks.id] }),
  relatedPractice: one(practiceProblems, {
    fields: [interviewQuestions.relatedPracticeId],
    references: [practiceProblems.id],
  }),
  author: one(users, { fields: [interviewQuestions.createdBy], references: [users.id] }),
}));

export const lectureVisualizationsRelations = relations(lectureVisualizations, ({ one }) => ({
  lecture: one(lectures, { fields: [lectureVisualizations.lectureId], references: [lectures.id] }),
  author: one(users, { fields: [lectureVisualizations.createdBy], references: [users.id] }),
}));

export type AssignmentSample = typeof assignmentSamples.$inferSelect;
export type NewAssignmentSample = typeof assignmentSamples.$inferInsert;
export type PracticeProblem = typeof practiceProblems.$inferSelect;
export type NewPracticeProblem = typeof practiceProblems.$inferInsert;
export type InterviewQuestion = typeof interviewQuestions.$inferSelect;
export type NewInterviewQuestion = typeof interviewQuestions.$inferInsert;
export type LectureVisualization = typeof lectureVisualizations.$inferSelect;
export type NewLectureVisualization = typeof lectureVisualizations.$inferInsert;
