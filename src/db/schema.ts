// =============================================================================
// LMS DATABASE SCHEMA  (Drizzle ORM + Neon Postgres)
// -----------------------------------------------------------------------------
// This file is the SEAM. Every work-stream skill implements against these
// tables and types. It must be frozen before parallel work begins. Any change
// here is a breaking change and must be coordinated across all streams.
//
// Owner: shared-contracts skill (Wave 0). Do not edit inside feature streams.
// All timestamps are UTC. All measurements/units metric where applicable.
// =============================================================================

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  decimal,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRole = pgEnum("user_role", ["student", "instructor", "admin"]);
export const weekLock = pgEnum("week_lock", ["locked", "unlocked"]);
// `code_write` = free-form code graded by tests; `code_fix` = code correction,
// presented as broken code plus candidate fixes, so it auto-grades like an MCQ.
// Added in the add-on wave; existing rows are all `mcq`.
export const questionType = pgEnum("question_type", [
  "mcq",
  "multiple_select",
  "code_write",
  "code_fix",
]);
export const attemptStatus = pgEnum("attempt_status", ["in_progress", "submitted", "graded"]);
export const submissionStatus = pgEnum("submission_status", ["submitted", "under_review", "graded", "returned"]);
export const penaltyType = pgEnum("penalty_type", ["late_submission", "quiz_failure", "missed_deadline", "low_score"]);
export const penaltySeverity = pgEnum("penalty_severity", ["warning", "notice", "serious"]);

// ---------------------------------------------------------------------------
// Add-on enums (advanced scope). See ADDON_INTEGRATION.md and FREE_STACK.md.
// ---------------------------------------------------------------------------

/**
 * What a quiz IS, which decides how it behaves rather than being decorative:
 *   practice  — the existing MCQ quiz: 3 attempts, best counts, gates unlock.
 *   grand     — the weekly exam: 1 attempt, 120 minutes, mixed question types.
 *   realtime  — an inline ungraded check inside a lecture; no marks at all.
 * Defaults to `practice` so every existing row keeps its current meaning.
 */
export const quizKind = pgEnum("quiz_kind", ["practice", "grand", "realtime"]);

/** Difficulty ladder for the interview bank and the interactive tracks. */
export const proficiencyLevel = pgEnum("proficiency_level", [
  "beginner",
  "intermediate",
  "advanced",
]);

/** What a single-use auth token authorises. */
export const tokenPurpose = pgEnum("token_purpose", ["password_reset", "email_verify"]);

/**
 * A harvested video's review state. `candidate` never renders to a student:
 * nothing reaches a lecture until a human approves it, because an unreviewed
 * video is how a dead or off-topic embed gets in front of a cohort.
 */
export const videoStatus = pgEnum("video_status", ["candidate", "approved", "rejected"]);

/**
 * Where a piece of code runs. Chosen per problem, not globally, because the
 * free stack has two very different runtimes:
 *   browser — Web Worker (JS), Pyodide (Python), sql.js (SQL). Unlimited, free,
 *             but the student's machine holds the tests, so it cannot grade.
 *   piston  — server-side, hidden tests, therefore gradeable. Rate-limited on
 *             the public instance; self-hostable via Docker.
 *   none    — read-and-reason problems with a reference solution, no execution.
 */
export const executionMode = pgEnum("execution_mode", ["browser", "piston", "none"]);

// ---------------------------------------------------------------------------
// Cohorts  (50-80 students each; supports concurrent or sequential cohorts)
// ---------------------------------------------------------------------------
export const cohorts = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  gracePeriodDays: integer("grace_period_days").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRole("role").notNull().default("student"),
    cohortId: integer("cohort_id").references(() => cohorts.id, { onDelete: "set null" }),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    bio: text("bio"),
    githubProfile: varchar("github_profile", { length: 255 }),
    linkedinProfile: varchar("linkedin_profile", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    cohortIdx: index("users_cohort_idx").on(t.cohortId),
  }),
);

// ---------------------------------------------------------------------------
// Course structure: courses -> weeks -> lectures
// ---------------------------------------------------------------------------
export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  durationWeeks: integer("duration_weeks").notNull().default(4),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const weeks = pgTable(
  "weeks",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    // Deadline for this week's assessments; nullable so it can be set per cohort/config.
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    courseWeekIdx: uniqueIndex("weeks_course_week_idx").on(t.courseId, t.weekNumber),
  }),
);

export const lectures = pgTable(
  "lectures",
  {
    id: serial("id").primaryKey(),
    weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
    lectureNumber: integer("lecture_number").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    // Rich content (markdown/HTML) rendered in the lecture view.
    content: text("content"),
    // Embedded YouTube video id or full url; renderer extracts the id.
    youtubeUrl: varchar("youtube_url", { length: 500 }),
    // External practice links (e.g. W3Schools Tryit) + embedded exercise specs.
    // Shape: Array<{ title: string; type: "link" | "sandpack"; url?: string; starterCode?: object }>
    resources: jsonb("resources"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // --- add-on wave -------------------------------------------------------
    /**
     * Stable slug for the CONCEPT this lecture teaches ("css-flexbox",
     * "js-closures"), used to attach harvested videos and learning modules.
     *
     * Deliberately not the lecture id: ids are serial values reassigned by every
     * reseed, so curated video mappings keyed on them would silently attach the
     * wrong video after a reseed. Deliberately not the title either — titles get
     * copy-edited. Null until an admin sets it; nothing breaks while it is null.
     */
    topicKey: varchar("topic_key", { length: 120 }),

    // --- learning-enhancement wave ----------------------------------------
    // TECHNICAL_SPECIFICATION.md:244-259. Added HERE rather than in a sibling
    // module because a column cannot live outside the table it belongs to; the
    // sibling-module rule applies to new TABLES. These are purely ADDITIVE and
    // NULLABLE (or defaulted), so no existing query, insert or type breaks and the
    // frozen seam's contract with the other streams is unchanged.
    /** Markdown list of what the student will be able to do afterwards. */
    learningObjectives: text("learning_objectives"),
    /** Time to work through the lecture, in MINUTES. Advisory, shown as "~20 min". */
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    /** Reuses the existing `proficiency_level` enum rather than a parallel varchar. */
    difficultyLevel: proficiencyLevel("difficulty_level").default("beginner"),
    /**
     * DENORMALIZED counts of `lecture_visualizations` / `practice_problems`
     * (schema.learning.ts). They exist so the week's lecture list can show "3 visuals,
     * 2 problems" per row without two correlated subqueries per lecture. Maintained by
     * the content-authoring path; they are a display hint, never an authorization or
     * completeness input, so drift degrades a badge and nothing else.
     */
    visualizationsCount: integer("visualizations_count").notNull().default(0),
    practiceProblemsCount: integer("practice_problems_count").notNull().default(0),
    /** Content-quality flag: has this lecture been through the enhancement pass? */
    isEnhanced: boolean("is_enhanced").notNull().default(false),
  },
  (t) => ({
    weekIdx: index("lectures_week_idx").on(t.weekId),
    /** Serves the admin's "which lectures still need enhancing?" worklist. */
    enhancedIdx: index("lectures_enhanced_idx").on(t.isEnhanced),
    topicIdx: index("lectures_topic_idx").on(t.topicKey),
  }),
);

// ---------------------------------------------------------------------------
// Quizzes: quizzes -> questions -> options ; attempts -> answers
// ---------------------------------------------------------------------------
export const quizzes = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  totalQuestions: integer("total_questions").notNull().default(10),
  passingScore: integer("passing_score").notNull().default(70), // percent
  attemptsAllowed: integer("attempts_allowed").notNull().default(3),
  timeLimitMinutes: integer("time_limit_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // --- add-on wave -------------------------------------------------------
  // A grand quiz is just `kind = 'grand'` with attemptsAllowed = 1 and
  // timeLimitMinutes = 120; no separate table, so it reuses the whole
  // questions/options/attempts/answers chain and every existing read model.
  // NOT derived from attemptsAllowed: a practice quiz could legitimately be
  // configured to one attempt without becoming an exam, and the realtime kind
  // has no marks at all. The distinction is editorial, so it is stored.
  kind: quizKind("kind").notNull().default("practice"),

  /**
   * Optional narrowing of a quiz from a whole week down to one lecture.
   *
   * Added after the realtime-quiz stream reported the gap: `week_id` alone means
   * an inline knowledge check renders identically on every lecture in its week,
   * which is wrong for a check meant to follow one specific lesson. The stream
   * offered a positional-index workaround and correctly declined to change the
   * schema itself.
   *
   * NULLABLE and unused by the existing quizzes, so practice and grand quizzes
   * stay week-scoped exactly as before — a grand exam covers a week, not a
   * lecture. Only `kind = 'realtime'` is expected to set it.
   */
  lectureId: integer("lecture_id").references(() => lectures.id, { onDelete: "cascade" }),
});

export const questions = pgTable(
  "questions",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    type: questionType("type").notNull().default("mcq"),
    explanation: text("explanation"),
    orderIndex: integer("order_index").notNull().default(0),

    // --- add-on wave -----------------------------------------------------
    /** Language for code questions ("javascript", "python", "cpp", ...). Null for MCQ. */
    language: varchar("language", { length: 32 }),
    /** Pre-filled editor contents: a skeleton for code_write, broken code for code_fix. */
    starterCode: text("starter_code"),
    /**
     * Marks this question is worth. Defaults to 1 so every existing MCQ keeps
     * its current weight and a 10-question practice quiz still totals 10.
     * A 50-question grand quiz weights code questions above MCQs, which is why
     * the score cannot be a simple correct-answer count.
     */
    points: integer("points").notNull().default(1),
    /**
     * Hidden test cases for a `code_write` question, run server-side by Piston.
     * Shape: Array<{ name: string; input: string; expected: string }>.
     * jsonb rather than a child table: tests are always read and written as a
     * whole set with their question, never queried across questions, and this
     * keeps the answer-key barrier to one column to strip instead of a join to
     * remember. NEVER include this in a student-facing payload.
     */
    tests: jsonb("tests"),

    // --- learning-enhancement wave ---------------------------------------
    // TECHNICAL_SPECIFICATION.md:290-304. Additive and nullable/defaulted; see the
    // note on `lectures` above for why these are here and not in a sibling module.
    // EVERY COLUMN IN THIS BLOCK IS ANSWER-KEY MATERIAL and must be stripped from
    // any payload sent before the attempt is submitted — the same barrier that
    // already applies to `tests` and to `options.is_correct`.
    /** Rich HTML post-answer explanation, with diagrams. Sandboxed on render. */
    explanationHtml: text("explanation_html"),
    /** `{ why_correct: string; visual_explanation?: string }`. */
    correctBreakdown: jsonb("correct_breakdown"),
    /** `Array<{ option: string; why_wrong: string; visual?: string }>` — per-distractor. */
    incorrectAnalysis: jsonb("incorrect_analysis"),
    /** `{ concepts?: string[]; video_url?: string; practice_link?: string }` — where to go next. */
    deeperLearningResources: jsonb("deeper_learning_resources"),
    /** Content-quality flag: has this question been through the enhancement pass? */
    isEnhanced: boolean("is_enhanced").notNull().default(false),
  },
  (t) => ({ quizIdx: index("questions_quiz_idx").on(t.quizId) }),
);

export const options = pgTable(
  "options",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    optionText: text("option_text").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
    orderIndex: integer("order_index").notNull().default(0),
  },
  (t) => ({ questionIdx: index("options_question_idx").on(t.questionId) }),
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    quizId: integer("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    totalPossible: integer("total_possible").notNull().default(0),
    percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull().default("0"),
    status: attemptStatus("status").notNull().default("submitted"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    // --- add-on wave -----------------------------------------------------
    /**
     * When this attempt expires, computed server-side at start as
     * `started_at + quizzes.time_limit_minutes` and then NEVER updated.
     * Invariant I2: this column is the only authority on remaining time. A
     * client-sent countdown is presentation; a skewed device clock changes
     * nothing. Null for untimed practice quizzes.
     */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    /**
     * True when the attempt was closed by expiry rather than by the student
     * pressing Submit. Recorded because it changes how a result should be read
     * (and because "did the timer take it from me?" is the first thing a
     * student asks), not because it changes the score.
     */
    autoSubmitted: boolean("auto_submitted").notNull().default(false),
  },
  (t) => ({
    studentIdx: index("attempts_student_idx").on(t.studentId, t.quizId),
    /**
     * Invariant I1 — one attempt per student per grand quiz, as a database
     * constraint rather than a convention. Two concurrent Start requests both
     * computing attempt_number = 1 cannot both commit; the loser gets a unique
     * violation and is handed the existing attempt.
     * Verified safe against existing rows by scripts/precheck-migration.ts.
     */
    studentQuizAttemptIdx: uniqueIndex("attempts_student_quiz_number_idx").on(
      t.studentId,
      t.quizId,
      t.attemptNumber,
    ),
  }),
);

export const answers = pgTable(
  "answers",
  {
    id: serial("id").primaryKey(),
    attemptId: integer("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: integer("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    selectedOptionId: integer("selected_option_id").references(() => options.id, { onDelete: "set null" }),
    isCorrect: boolean("is_correct").notNull().default(false),

    // --- add-on wave -----------------------------------------------------
    /** The student's submitted source for a code_write question. Null otherwise. */
    codeAnswer: text("code_answer"),
    /**
     * Marks actually awarded, and the ceiling for this question copied from
     * `questions.points` at grade time.
     *
     * Invariant I5: the grader clamps to [0, maxPoints], so no answer can
     * subtract marks (no negative marking) and none can exceed its own weight.
     * The attempt score is the SUM of `awarded` — derived, never incremented
     * into a running total that could drift from its parts.
     *
     * `max_points` is copied rather than joined so a later edit to a question's
     * weight cannot silently restate an exam already sat.
     */
    awarded: integer("awarded").notNull().default(0),
    maxPoints: integer("max_points").notNull().default(0),
  },
  (t) => ({
    /**
     * Invariant I3/I4 — makes autosave an idempotent UPSERT: a student editing
     * question 7 five times updates one row rather than accumulating five, and
     * the submit path can insert a zero-scored row for every unanswered
     * question with ON CONFLICT DO NOTHING without disturbing saved work.
     * Verified safe against existing rows by scripts/precheck-migration.ts.
     */
    attemptQuestionIdx: uniqueIndex("answers_attempt_question_idx").on(t.attemptId, t.questionId),
  }),
);

// ---------------------------------------------------------------------------
// Assignments + submissions (Google Form / Sheet ingestion model)
// ---------------------------------------------------------------------------
export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  // Array<string> of requirement lines shown to the student.
  requirements: jsonb("requirements"),
  // The Google Form students submit through, and the linked Sheet we ingest from.
  googleFormUrl: varchar("google_form_url", { length: 500 }),
  googleSheetCsvUrl: varchar("google_sheet_csv_url", { length: 500 }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  latePenaltyPercentPerDay: integer("late_penalty_percent_per_day").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // --- learning-enhancement wave ------------------------------------------
  // TECHNICAL_SPECIFICATION.md:264-285. Additive and nullable/defaulted; see the
  // note on `lectures` above for why these are here and not in a sibling module.
  /**
   * DENORMALIZED count of `assignment_samples` (schema.learning.ts), so the
   * assignment card can say "3 worked examples" without a correlated subquery.
   * Display hint only.
   */
  samplesCount: integer("samples_count").notNull().default(0),
  /** `Array<{ requirement: string; screenshot_url?: string }>` — requirements with pictures. */
  functionalRequirements: jsonb("functional_requirements"),
  /** `Array<{ criteria: string; image_url?: string }>` — the visual "done" checklist. */
  acceptanceCriteriaVisual: jsonb("acceptance_criteria_visual"),
  /**
   * `Array<{ criteria: string; weight: number; examples: unknown[] }>` — a rubric that
   * SHOWS what each band looks like. Kept as jsonb on the assignment rather than
   * pointed at `grading_rubrics` (schema.peer-review.ts) on purpose: that table is
   * versioned-by-insert because peer-review SCORES reference it, whereas this is
   * illustrative guidance an instructor edits in place with no stored scores to
   * reinterpret. Merging them would force in-place edits to become new rows.
   */
  rubricWithExamples: jsonb("rubric_with_examples"),
  /** `string[]` of preview image urls shown above the brief. */
  sampleScreenshots: jsonb("sample_screenshots"),
  /** Content-quality flag: has this assignment been through the enhancement pass? */
  isEnhanced: boolean("is_enhanced").notNull().default(false),
});

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignmentId: integer("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
    // Captured from the Google Sheet row (submission link, github url, etc.)
    githubUrl: varchar("github_url", { length: 500 }),
    liveUrl: varchar("live_url", { length: 500 }),
    sheetRowRef: varchar("sheet_row_ref", { length: 120 }), // idempotency key from the sheet
    description: text("description"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    isLate: boolean("is_late").notNull().default(false),
    status: submissionStatus("status").notNull().default("submitted"),
    score: integer("score"),
    feedback: text("feedback"),
    instructorRating: integer("instructor_rating"), // 1..5 stars
    instructorId: integer("instructor_id").references(() => users.id, { onDelete: "set null" }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (t) => ({
    studentIdx: index("submissions_student_idx").on(t.studentId),
    assignmentIdx: index("submissions_assignment_idx").on(t.assignmentId),
    // Prevent duplicate ingestion of the same sheet row.
    rowRefIdx: uniqueIndex("submissions_row_ref_idx").on(t.assignmentId, t.sheetRowRef),
  }),
);

// ---------------------------------------------------------------------------
// Progress, attendance, penalties, leaderboard
// ---------------------------------------------------------------------------
export const progress = pgTable(
  "progress",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
    lecturesCompleted: integer("lectures_completed").notNull().default(0),
    quizCompleted: boolean("quiz_completed").notNull().default(false),
    assignmentCompleted: boolean("assignment_completed").notNull().default(false),
    overallScore: integer("overall_score").notNull().default(0),
    weekUnlocked: boolean("week_unlocked").notNull().default(false),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ studentWeekIdx: uniqueIndex("progress_student_week_idx").on(t.studentId, t.weekId) }),
);

export const attendance = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    lectureId: integer("lecture_id").notNull().references(() => lectures.id, { onDelete: "cascade" }),
    attended: boolean("attended").notNull().default(false),
    participationScore: integer("participation_score").notNull().default(0),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ studentLectureIdx: uniqueIndex("attendance_student_lecture_idx").on(t.studentId, t.lectureId) }),
);

export const penalties = pgTable(
  "penalties",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: penaltyType("type").notNull(),
    severity: penaltySeverity("severity").notNull().default("warning"),
    description: text("description"),
    penaltyPoints: integer("penalty_points").notNull().default(0),
    issuedBy: integer("issued_by").references(() => users.id, { onDelete: "set null" }),
    resolved: boolean("resolved").notNull().default(false),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({ studentIdx: index("penalties_student_idx").on(t.studentId) }),
);

// Denormalized leaderboard for O(1) rank reads. Rebuilt on grading events.
export const leaderboard = pgTable(
  "leaderboard",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    cohortId: integer("cohort_id").references(() => cohorts.id, { onDelete: "cascade" }),
    totalScore: integer("total_score").notNull().default(0),
    quizScore: integer("quiz_score").notNull().default(0),
    assignmentScore: integer("assignment_score").notNull().default(0),
    participationScore: integer("participation_score").notNull().default(0),
    finalProjectScore: integer("final_project_score").notNull().default(0),
    ranking: integer("ranking"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    studentIdx: uniqueIndex("leaderboard_student_idx").on(t.studentId),
    scoreIdx: index("leaderboard_score_idx").on(t.cohortId, t.totalScore),
  }),
);

// ===========================================================================
// ADD-ON TABLES (advanced scope)
// ---------------------------------------------------------------------------
// All new. Nothing above is replaced, so every existing read model keeps
// working. See ADDON_INTEGRATION.md for which skill owns which table.
// ===========================================================================

// ---------------------------------------------------------------------------
// Single-use auth tokens — password reset / email verification
// ---------------------------------------------------------------------------
/**
 * Owner: `account` skill.
 *
 * ONLY A HASH IS STORED. `token_hash` holds sha256(raw token); the raw value
 * exists once, in the email. A stolen database backup therefore yields no usable
 * reset links, which is the entire point of hashing something that is already
 * random and short-lived.
 *
 * Single-use is enforced by `used_at`: the consuming transaction sets it and
 * refuses a token that already has it, so a reset link forwarded or replayed
 * from a mailbox cannot be redeemed twice.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: tokenPurpose("purpose").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: uniqueIndex("auth_tokens_hash_idx").on(t.tokenHash),
    // Supports "invalidate this user's outstanding reset tokens" on success.
    userPurposeIdx: index("auth_tokens_user_purpose_idx").on(t.userId, t.purpose),
  }),
);

// ---------------------------------------------------------------------------
// Harvested topic videos (keyless: curated ids + channel RSS, oEmbed-validated)
// ---------------------------------------------------------------------------
/**
 * Owner: `video-ingestion` skill.
 *
 * A candidate pool, not a live mapping. Rows land as `candidate` and only an
 * approved row is ever rendered, because no automated match should put a video
 * in front of a cohort unreviewed — the earlier waves refused to invent video
 * ids for exactly this reason.
 *
 * No Google API key: ids come from a curated list or a channel RSS feed, and
 * each is validated through YouTube's keyless oEmbed endpoint, which also
 * proves the id actually resolves. `title`/`channel_title`/`duration_seconds`
 * are cached from that response so the review screen shows what it is choosing
 * between without re-fetching.
 */
export const topicVideos = pgTable(
  "topic_videos",
  {
    id: serial("id").primaryKey(),
    /** Matches `lectures.topic_key`. Not a foreign key: a topic may be harvested before any lecture claims it. */
    topicKey: varchar("topic_key", { length: 120 }).notNull(),
    youtubeId: varchar("youtube_id", { length: 32 }).notNull(),
    title: varchar("title", { length: 500 }),
    channelTitle: varchar("channel_title", { length: 255 }),
    durationSeconds: integer("duration_seconds"),
    status: videoStatus("status").notNull().default("candidate"),
    /** "curated" (supplied by staff) or "rss" (harvested from a channel feed). */
    source: varchar("source", { length: 16 }).notNull().default("curated"),
    orderIndex: integer("order_index").notNull().default(0),
    reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Re-running the harvester must not duplicate a candidate.
    topicVideoIdx: uniqueIndex("topic_videos_topic_video_idx").on(t.topicKey, t.youtubeId),
    topicStatusIdx: index("topic_videos_topic_status_idx").on(t.topicKey, t.status),
  }),
);

// ---------------------------------------------------------------------------
// Interactive learning tracks (OOP, DBMS, DSA, prompt engineering, crypto, ...)
// ---------------------------------------------------------------------------
/**
 * Owner: `interactive-learning` skill.
 *
 * Modules are content, steps are the lesson, and completion is per step so a
 * half-finished module survives a closed tab. Kept separate from
 * weeks/lectures: these tracks are self-paced and carry no marks, so putting
 * them in the graded course structure would drag them into unlock rules,
 * weekly scores and the leaderboard, none of which should apply.
 */
export const learningModules = pgTable(
  "learning_modules",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    /** Track grouping: "oop", "dbms", "dsa", "prompt-engineering", "cryptography", "cybersecurity", ... */
    track: varchar("track", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary"),
    level: proficiencyLevel("level").notNull().default("beginner"),
    estimatedMinutes: integer("estimated_minutes"),
    orderIndex: integer("order_index").notNull().default(0),
    /** Unpublished modules are invisible to students, so content can land before it is ready. */
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("learning_modules_slug_idx").on(t.slug),
    trackIdx: index("learning_modules_track_idx").on(t.track, t.level, t.orderIndex),
  }),
);

export const learningSteps = pgTable(
  "learning_steps",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull().references(() => learningModules.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    /** "explain" (prose + diagram), "lab" (try-it editor), "check" (inline question). */
    kind: varchar("kind", { length: 24 }).notNull().default("explain"),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    /** Lab steps only: editor seed, its language, and how it runs. */
    starterCode: text("starter_code"),
    language: varchar("language", { length: 32 }),
    execution: executionMode("execution").notNull().default("none"),
    /**
     * What the step is checking, when it checks anything.
     * Shape depends on `kind`; validated on read, never trusted, exactly like
     * `lectures.resources`.
     */
    expectation: jsonb("expectation"),
  },
  (t) => ({
    moduleStepIdx: uniqueIndex("learning_steps_module_step_idx").on(t.moduleId, t.stepNumber),
  }),
);

export const learningProgress = pgTable(
  "learning_progress",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    stepId: integer("step_id").notNull().references(() => learningSteps.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Completing a step twice is a no-op, not a second row.
    studentStepIdx: uniqueIndex("learning_progress_student_step_idx").on(t.studentId, t.stepId),
  }),
);

// ---------------------------------------------------------------------------
// Coding problems: practice bank + interview bank
// ---------------------------------------------------------------------------
/**
 * Owner: `coding-problems` skill.
 *
 * ORIGINAL STATEMENTS ONLY. `DECISIONS.md` is explicit: do not paste
 * proprietary LeetCode/HackerRank text. Problems here restate classic PATTERNS
 * (two-pointer, sliding window, hash-map counting) in our own words. The pattern
 * is not ownable; the prose is.
 *
 * One table for both banks, separated by `is_interview`, because they are the
 * same object with the same executor and the same completion rule — two tables
 * would mean two of everything downstream.
 */
export const codingProblems = pgTable(
  "coding_problems",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    /** Markdown. Original prose. */
    statement: text("statement").notNull(),
    /** "javascript" | "python" | "cpp" | "html" | "css" | "sql" | "agentic" | ... */
    track: varchar("track", { length: 64 }).notNull(),
    level: proficiencyLevel("level").notNull().default("beginner"),
    /** Interview drills vs. syllabus practice. Same machinery, different surface. */
    isInterview: boolean("is_interview").notNull().default(false),
    language: varchar("language", { length: 32 }).notNull(),
    starterCode: text("starter_code"),
    referenceSolution: text("reference_solution"),
    /** Array<string>, revealed one at a time so a hint is a choice, not a spoiler. */
    hints: jsonb("hints"),
    /** Array<string> for filtering: ["arrays","two-pointer"]. */
    tags: jsonb("tags"),
    execution: executionMode("execution").notNull().default("browser"),
    /** Wall-clock ceiling for one run, in milliseconds (house rule 5: metric). */
    timeLimitMs: integer("time_limit_ms").notNull().default(5000),
    published: boolean("published").notNull().default(false),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("coding_problems_slug_idx").on(t.slug),
    browseIdx: index("coding_problems_browse_idx").on(t.track, t.level, t.isInterview, t.orderIndex),
  }),
);

export const codingProblemTests = pgTable(
  "coding_problem_tests",
  {
    id: serial("id").primaryKey(),
    problemId: integer("problem_id").notNull().references(() => codingProblems.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    input: text("input"),
    expectedOutput: text("expected_output"),
    /**
     * Hidden tests decide the grade and must never be serialised to the client.
     * Visible ones are examples the student is meant to read. A child table
     * rather than jsonb here (unlike `questions.tests`) because the visible
     * subset is queried on its own for every problem view.
     */
    hidden: boolean("hidden").notNull().default(true),
    orderIndex: integer("order_index").notNull().default(0),
  },
  (t) => ({ problemIdx: index("coding_problem_tests_problem_idx").on(t.problemId, t.hidden) }),
);

/**
 * One row per RUN, not per problem: the history is the useful artefact for a
 * student practising, and "solved" is derived from it
 * (`exists(passed_count = total_count)`) rather than stored.
 *
 * That derivation is deliberate and follows the precedent set by
 * `src/lib/progress/unlock.ts`, which refuses to read a stored mirror of a
 * computed fact: a denormalized `solved` flag is a second source of truth, and
 * the failure mode is a flag that says solved when no passing run exists.
 */
export const codingAttempts = pgTable(
  "coding_attempts",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    problemId: integer("problem_id").notNull().references(() => codingProblems.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    language: varchar("language", { length: 32 }).notNull(),
    passedCount: integer("passed_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    /** Where it ran, so a browser run is never mistaken for a graded one. */
    execution: executionMode("execution").notNull().default("browser"),
    runtimeMs: integer("runtime_ms"),
    /** Compiler/runtime output, truncated by the caller. Null on a clean pass. */
    stderr: text("stderr"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    studentProblemIdx: index("coding_attempts_student_problem_idx").on(t.studentId, t.problemId),
  }),
);

// ---------------------------------------------------------------------------
// Relations (used by Drizzle query API)
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ one, many }) => ({
  cohort: one(cohorts, { fields: [users.cohortId], references: [cohorts.id] }),
  attempts: many(quizAttempts),
  submissions: many(submissions),
  progress: many(progress),
}));

export const weeksRelations = relations(weeks, ({ one, many }) => ({
  course: one(courses, { fields: [weeks.courseId], references: [courses.id] }),
  lectures: many(lectures),
  quizzes: many(quizzes),
  assignments: many(assignments),
}));

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  week: one(weeks, { fields: [quizzes.weekId], references: [weeks.id] }),
  questions: many(questions),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  quiz: one(quizzes, { fields: [questions.quizId], references: [quizzes.id] }),
  options: many(options),
}));

// Inferred types — import these in every stream instead of redefining row shapes.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Week = typeof weeks.$inferSelect;
export type Lecture = typeof lectures.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Option = typeof options.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Progress = typeof progress.$inferSelect;
export type Penalty = typeof penalties.$inferSelect;
export type LeaderboardRow = typeof leaderboard.$inferSelect;

// Add-on wave.
export type Answer = typeof answers.$inferSelect;
export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;
export type TopicVideo = typeof topicVideos.$inferSelect;
export type NewTopicVideo = typeof topicVideos.$inferInsert;
export type LearningModule = typeof learningModules.$inferSelect;
export type LearningStep = typeof learningSteps.$inferSelect;
export type LearningProgressRow = typeof learningProgress.$inferSelect;
export type CodingProblem = typeof codingProblems.$inferSelect;
export type NewCodingProblem = typeof codingProblems.$inferInsert;
export type CodingProblemTest = typeof codingProblemTests.$inferSelect;
export type CodingAttempt = typeof codingAttempts.$inferSelect;
export type NewCodingAttempt = typeof codingAttempts.$inferInsert;

/** Quiz kinds as a value, for exhaustive switches. Mirrors the pgEnum. */
export const QUIZ_KINDS = ["practice", "grand", "realtime"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const PROFICIENCY_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const EXECUTION_MODES = ["browser", "piston", "none"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

// ---------------------------------------------------------------------------
// ASYNC JOB QUEUE (async-queues stream). See src/lib/queue/types.ts for WHY
// this exists and, more importantly, for the three candidates that were
// rejected as not needing a queue.
// ---------------------------------------------------------------------------

/** Lifecycle of a queued job. Mirrored as a value union in src/lib/queue/types.ts. */
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "dead"]);

/**
 * One unit of deferred work.
 *
 * THE UNIQUE INDEX ON `idempotency_key` IS THE POINT OF THIS TABLE. It is not a
 * performance index and it is not a convenience: it is the only thing in the
 * system that can resolve a race between two concurrent serverless invocations
 * trying to enqueue the same job. An application-level `SELECT` first cannot —
 * under READ COMMITTED both readers see nothing and both insert. Producers call
 * `enqueueJob` (src/lib/queue/store.ts), which INSERTs with
 * `ON CONFLICT (idempotency_key) DO NOTHING` and reports whether it was the
 * caller who actually created the row. Removing this index does not degrade the
 * queue; it removes the guarantee entirely.
 *
 * It is a SINGLE-column index deliberately. `ON CONFLICT` needs a single unique
 * constraint to name as its arbiter, so the job kind is folded into the key
 * string instead of being a second index column — see src/lib/queue/keys.ts.
 *
 * NO FOREIGN KEY to the entity a job is about. A job's payload names rows in
 * other tables, but the reference is deliberately loose: cascading a submission
 * delete into the queue would silently drop the notification about it, and a job
 * whose target has vanished should dead-letter with a readable reason rather
 * than disappear. The handlers re-read their targets and report
 * `target_missing` as a permanent failure.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    /**
     * Routed against the handler registry. `varchar`, not a pgEnum: adding a job
     * kind is a code change in one stream, and making it also an enum migration
     * on this shared file is friction with no safety benefit — an unknown kind
     * is already handled (dead-lettered on the first attempt, never retried).
     */
    kind: varchar("kind", { length: 64 }).notNull(),
    /** See the table comment. Length must equal KEY_MAX_CHARS in src/lib/queue/keys.ts. */
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    /** Handler input. A POINTER to rows, not a snapshot of them — see the handlers. */
    payload: jsonb("payload").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    /** Incremented when the job is CLAIMED, not when it completes, so a worker killed mid-run still burns an attempt. */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** Earliest moment this job may be claimed. Backoff is written here. */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the current claim expires. A `running` row past this moment is
     * reclaimable — the only recovery path for a serverless function that was
     * terminated between claiming a job and reporting on it.
     */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /** Which drain invocation holds the lease. Diagnostic only; never authoritative. */
    lockedBy: varchar("locked_by", { length: 64 }),
    /** Truncated to ~1 kB by the queue before it is written. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set on `succeeded` and on `dead`. Null means the job is still in flight. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    /** THE IDEMPOTENCY GUARANTEE. Read the table comment before touching this. */
    idempotencyIdx: uniqueIndex("jobs_idempotency_key_idx").on(t.idempotencyKey),
    /** Serves the claim query's `status = 'queued' and run_after <= now()` scan. */
    claimIdx: index("jobs_claim_idx").on(t.status, t.runAfter),
    /** Serves both the lease-reclaim scan and the dead-letter listing. */
    leaseIdx: index("jobs_lease_idx").on(t.status, t.leaseExpiresAt),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export const JOB_STATUSES = ["queued", "running", "succeeded", "dead"] as const;
export type JobStatusValue = (typeof JOB_STATUSES)[number];
