// =============================================================================
// ADMIN CONSOLE DATA LAYER — instructor-admin stream.
// -----------------------------------------------------------------------------
// Reads and writes for quiz/assignment authoring, account management, deadline
// configuration and report export.
//
// THIS MODULE DOES NOT AUTHORIZE. Every function here assumes the caller already
// passed a guard. The guards live in `actions.ts` (`requireAdminAction`) and in
// the route handlers (`apiGuard`), one layer up, so that authorization is a
// visible boundary rather than something scattered through query code. Do not
// import this module from anywhere that has not gated the caller first.
//
// Local Zod schemas are used for these payloads. The frozen
// `@/lib/contracts/validation` deliberately does not define quiz-authoring
// shapes, and adding them there is a seam change; when shared-contracts wants
// them, these move up and this file imports them instead.
// =============================================================================

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  assignments,
  cohorts,
  options,
  penalties,
  penaltySeverity,
  penaltyType,
  questions,
  questionType,
  quizzes,
  submissions,
  userRole,
  users,
  weeks,
} from "@/db/schema";
import { POINTS } from "@/lib/contracts/scoring";
import type { GradeExportRow } from "./csv";
import { STUDENT_COLUMNS } from "./students";

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

export const quizUpsertSchema = z.object({
  id: z.number().int().positive().optional(),
  weekId: z.number().int().positive(),
  title: z.string().min(3).max(255),
  totalQuestions: z.number().int().min(1).max(100),
  passingScore: z.number().int().min(0).max(100), // percent
  attemptsAllowed: z.number().int().min(1).max(10),
  /** Minutes, matching the schema column. Null = untimed. */
  timeLimitMinutes: z.number().int().min(1).max(600).nullable().optional(),
});
export type QuizUpsertInput = z.infer<typeof quizUpsertSchema>;

export const questionUpsertSchema = z.object({
  id: z.number().int().positive().optional(),
  quizId: z.number().int().positive(),
  questionText: z.string().min(3).max(2000),
  type: z.enum(questionType.enumValues),
  explanation: z.string().max(2000).nullable().optional(),
  orderIndex: z.number().int().min(0).max(999).default(0),
  options: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        optionText: z.string().min(1).max(500),
        isCorrect: z.boolean(),
        orderIndex: z.number().int().min(0).max(99).default(0),
      }),
    )
    .min(2)
    .max(10)
    // An MCQ with no correct option is unanswerable and auto-grading would mark
    // every student wrong; refuse it at the door rather than ship a broken quiz.
    .refine((opts) => opts.some((o) => o.isCorrect), {
      message: "At least one option must be marked correct.",
    }),
});
export type QuestionUpsertInput = z.infer<typeof questionUpsertSchema>;

export const assignmentUpsertSchema = z.object({
  id: z.number().int().positive().optional(),
  weekId: z.number().int().positive(),
  title: z.string().min(3).max(255),
  description: z.string().min(3),
  requirements: z.array(z.string().min(1).max(500)).max(30).default([]),
  googleFormUrl: z.string().url().max(500).nullable().optional(),
  googleSheetCsvUrl: z.string().url().max(500).nullable().optional(),
  dueAt: z.coerce.date(),
  latePenaltyPercentPerDay: z.number().int().min(0).max(100).default(10),
});
export type AssignmentUpsertInput = z.infer<typeof assignmentUpsertSchema>;

export const deadlineSchema = z.object({
  weekId: z.number().int().positive(),
  /** Null clears the week deadline. */
  dueAt: z.coerce.date().nullable(),
  /** When true, the week's assignment due date is moved to match. */
  alsoUpdateAssignments: z.boolean().default(true),
});
export type DeadlineInput = z.infer<typeof deadlineSchema>;

export const cohortConfigSchema = z.object({
  cohortId: z.number().int().positive(),
  name: z.string().min(2).max(120).optional(),
  startsAt: z.coerce.date().optional(),
  gracePeriodDays: z.number().int().min(0).max(14).optional(),
  isActive: z.boolean().optional(),
});
export type CohortConfigInput = z.infer<typeof cohortConfigSchema>;

export const accountUpdateSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(userRole.enumValues).optional(),
  /** Null detaches the account from every cohort. */
  cohortId: z.number().int().positive().nullable().optional(),
  name: z.string().min(2).max(255).optional(),
});
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export const penaltyIssueSchema = z.object({
  studentId: z.number().int().positive(),
  type: z.enum(penaltyType.enumValues),
  severity: z.enum(penaltySeverity.enumValues),
  description: z.string().max(1000).optional(),
  // A single penalty cannot exceed one week's total points; anything larger is a
  // typo, and there is no undo for a leaderboard the student already saw.
  penaltyPoints: z.number().int().min(0).max(POINTS.WEEK_MAX).default(0),
});
export type PenaltyIssueInput = z.infer<typeof penaltyIssueSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface WeekRef {
  id: number;
  weekNumber: number;
  title: string;
  dueAt: Date | null;
}

export async function listWeeks(): Promise<WeekRef[]> {
  return db
    .select({
      id: weeks.id,
      weekNumber: weeks.weekNumber,
      title: weeks.title,
      dueAt: weeks.dueAt,
    })
    .from(weeks)
    .orderBy(asc(weeks.weekNumber));
}

export interface QuizWithCounts {
  id: number;
  weekId: number;
  weekNumber: number;
  title: string;
  totalQuestions: number;
  passingScore: number;
  attemptsAllowed: number;
  timeLimitMinutes: number | null;
  /** Questions actually authored, which may differ from `totalQuestions`. */
  authoredQuestions: number;
  /**
   * Attempts already recorded. Non-zero means editing a question detaches
   * students' recorded answers (answers.selectedOptionId is ON DELETE SET NULL),
   * so the console warns before allowing it.
   */
  attemptCount: number;
}

export async function listQuizzes(): Promise<QuizWithCounts[]> {
  const rows = await db
    .select({
      id: quizzes.id,
      weekId: quizzes.weekId,
      weekNumber: weeks.weekNumber,
      title: quizzes.title,
      totalQuestions: quizzes.totalQuestions,
      passingScore: quizzes.passingScore,
      attemptsAllowed: quizzes.attemptsAllowed,
      timeLimitMinutes: quizzes.timeLimitMinutes,
      authoredQuestions: sql<number>`(
        SELECT COUNT(*)::int FROM questions q WHERE q.quiz_id = ${quizzes.id}
      )`,
      attemptCount: sql<number>`(
        SELECT COUNT(*)::int FROM quiz_attempts qa WHERE qa.quiz_id = ${quizzes.id}
      )`,
    })
    .from(quizzes)
    .innerJoin(weeks, eq(quizzes.weekId, weeks.id))
    .orderBy(asc(weeks.weekNumber));

  return rows.map((r) => ({
    ...r,
    authoredQuestions: Number(r.authoredQuestions) || 0,
    attemptCount: Number(r.attemptCount) || 0,
  }));
}

export interface QuestionWithOptions {
  id: number;
  questionText: string;
  type: (typeof questionType.enumValues)[number];
  explanation: string | null;
  orderIndex: number;
  options: { id: number; optionText: string; isCorrect: boolean; orderIndex: number }[];
}

export async function listQuestions(quizId: number): Promise<QuestionWithOptions[]> {
  const questionRows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      type: questions.type,
      explanation: questions.explanation,
      orderIndex: questions.orderIndex,
    })
    .from(questions)
    .where(eq(questions.quizId, quizId))
    .orderBy(asc(questions.orderIndex), asc(questions.id));

  if (questionRows.length === 0) return [];

  const optionRows = await db
    .select({
      id: options.id,
      questionId: options.questionId,
      optionText: options.optionText,
      isCorrect: options.isCorrect,
      orderIndex: options.orderIndex,
    })
    .from(options)
    .where(inArray(options.questionId, questionRows.map((q) => q.id)))
    .orderBy(asc(options.orderIndex), asc(options.id));

  return questionRows.map((q) => ({
    ...q,
    options: optionRows
      .filter((o) => o.questionId === q.id)
      .map(({ questionId: _questionId, ...rest }) => rest),
  }));
}

export interface AssignmentRow {
  id: number;
  weekId: number;
  weekNumber: number;
  title: string;
  description: string;
  requirements: string[];
  googleFormUrl: string | null;
  googleSheetCsvUrl: string | null;
  dueAt: Date;
  latePenaltyPercentPerDay: number;
  submissionCount: number;
}

export async function listAssignments(): Promise<AssignmentRow[]> {
  const rows = await db
    .select({
      id: assignments.id,
      weekId: assignments.weekId,
      weekNumber: weeks.weekNumber,
      title: assignments.title,
      description: assignments.description,
      requirements: assignments.requirements,
      googleFormUrl: assignments.googleFormUrl,
      googleSheetCsvUrl: assignments.googleSheetCsvUrl,
      dueAt: assignments.dueAt,
      latePenaltyPercentPerDay: assignments.latePenaltyPercentPerDay,
      submissionCount: sql<number>`(
        SELECT COUNT(*)::int FROM submissions s WHERE s.assignment_id = ${assignments.id}
      )`,
    })
    .from(assignments)
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .orderBy(asc(weeks.weekNumber));

  return rows.map((r) => ({
    ...r,
    requirements: Array.isArray(r.requirements) ? (r.requirements as string[]) : [],
    submissionCount: Number(r.submissionCount) || 0,
  }));
}

export interface CohortRow {
  id: number;
  name: string;
  startsAt: Date;
  gracePeriodDays: number;
  isActive: boolean;
  studentCount: number;
}

export async function listCohorts(): Promise<CohortRow[]> {
  const rows = await db
    .select({
      id: cohorts.id,
      name: cohorts.name,
      startsAt: cohorts.startsAt,
      gracePeriodDays: cohorts.gracePeriodDays,
      isActive: cohorts.isActive,
      studentCount: sql<number>`(
        SELECT COUNT(*)::int FROM users u
        WHERE u.cohort_id = ${cohorts.id} AND u.role = 'student'
      )`,
    })
    .from(cohorts)
    .orderBy(desc(cohorts.startsAt));

  return rows.map((r) => ({ ...r, studentCount: Number(r.studentCount) || 0 }));
}

/**
 * Every account, for the admin account manager. Uses the shared
 * `STUDENT_COLUMNS` projection, so no password hash can reach the page.
 */
export async function listAccounts(): Promise<
  { id: number; name: string; email: string; role: string; cohortId: number | null; cohortName: string | null; createdAt: Date }[]
> {
  const rows = await db
    .select({
      id: STUDENT_COLUMNS.id,
      name: STUDENT_COLUMNS.name,
      email: STUDENT_COLUMNS.email,
      role: STUDENT_COLUMNS.role,
      cohortId: STUDENT_COLUMNS.cohortId,
      createdAt: STUDENT_COLUMNS.createdAt,
      cohortName: cohorts.name,
    })
    .from(users)
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .orderBy(asc(users.role), asc(users.name));

  return rows.map((r) => ({ ...r, cohortName: r.cohortName ?? null }));
}

/**
 * Rows for the CSV grade export. Explicit projection; the instructor's name is
 * fetched by a scalar subquery rather than by selecting the whole users row.
 */
export async function getGradeExportRows(cohortId?: number): Promise<GradeExportRow[]> {
  const rows = await db
    .select({
      studentName: users.name,
      studentEmail: users.email,
      cohortName: cohorts.name,
      weekNumber: weeks.weekNumber,
      assignmentTitle: assignments.title,
      status: submissions.status,
      score: submissions.score,
      stars: submissions.instructorRating,
      isLate: submissions.isLate,
      submittedAt: submissions.submittedAt,
      gradedAt: submissions.gradedAt,
      instructorName: sql<string | null>`(
        SELECT iu.name FROM users iu WHERE iu.id = ${submissions.instructorId}
      )`,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.studentId, users.id))
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(cohortId === undefined ? undefined : eq(users.cohortId, cohortId))
    .orderBy(asc(weeks.weekNumber), asc(users.name));

  return rows.map((r) => ({
    ...r,
    cohortName: r.cohortName ?? null,
    instructorName: r.instructorName ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function upsertQuiz(input: QuizUpsertInput): Promise<number> {
  const values = {
    weekId: input.weekId,
    title: input.title,
    totalQuestions: input.totalQuestions,
    passingScore: input.passingScore,
    attemptsAllowed: input.attemptsAllowed,
    timeLimitMinutes: input.timeLimitMinutes ?? null,
  };

  if (input.id) {
    await db.update(quizzes).set(values).where(eq(quizzes.id, input.id));
    return input.id;
  }
  const [created] = await db.insert(quizzes).values(values).returning({ id: quizzes.id });
  return created.id;
}

/**
 * Create or replace a question and its option set in one transaction.
 *
 * Options are replaced wholesale rather than diffed. `answers.selectedOptionId`
 * is ON DELETE SET NULL, so replacing options on a quiz students have already
 * attempted detaches their recorded answers — which is why the console warns
 * before editing a quiz with attempts (see admin/quizzes page). Editing a live
 * quiz is a deliberate act with a stated consequence, not a silent one.
 */
export async function upsertQuestion(input: QuestionUpsertInput): Promise<number> {
  return db.transaction(async (tx) => {
    let questionId = input.id;

    if (questionId) {
      await tx
        .update(questions)
        .set({
          questionText: input.questionText,
          type: input.type,
          explanation: input.explanation ?? null,
          orderIndex: input.orderIndex,
        })
        .where(eq(questions.id, questionId));
      await tx.delete(options).where(eq(options.questionId, questionId));
    } else {
      const [created] = await tx
        .insert(questions)
        .values({
          quizId: input.quizId,
          questionText: input.questionText,
          type: input.type,
          explanation: input.explanation ?? null,
          orderIndex: input.orderIndex,
        })
        .returning({ id: questions.id });
      questionId = created.id;
    }

    await tx.insert(options).values(
      input.options.map((o, i) => ({
        questionId: questionId as number,
        optionText: o.optionText,
        isCorrect: o.isCorrect,
        orderIndex: o.orderIndex ?? i,
      })),
    );

    return questionId;
  });
}

export async function deleteQuestion(questionId: number): Promise<void> {
  // Options cascade from the FK; no manual cleanup needed.
  await db.delete(questions).where(eq(questions.id, questionId));
}

export async function upsertAssignment(input: AssignmentUpsertInput): Promise<number> {
  const values = {
    weekId: input.weekId,
    title: input.title,
    description: input.description,
    requirements: input.requirements,
    googleFormUrl: input.googleFormUrl ?? null,
    googleSheetCsvUrl: input.googleSheetCsvUrl ?? null,
    dueAt: input.dueAt,
    latePenaltyPercentPerDay: input.latePenaltyPercentPerDay,
  };

  if (input.id) {
    await db.update(assignments).set(values).where(eq(assignments.id, input.id));
    return input.id;
  }
  const [created] = await db
    .insert(assignments)
    .values(values)
    .returning({ id: assignments.id });
  return created.id;
}

/**
 * Set a week's deadline, and by default the deadline of every assignment in it.
 *
 * `weeks.dueAt` is what the student dashboard reads, and
 * `assignments.dueAt` is what the late-penalty maths reads. Moving one without
 * the other means the dashboard shows a date the penalty calculation disagrees
 * with, so they are moved together inside one transaction.
 */
export async function setWeekDeadline(input: DeadlineInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(weeks).set({ dueAt: input.dueAt }).where(eq(weeks.id, input.weekId));

    if (input.alsoUpdateAssignments && input.dueAt) {
      await tx
        .update(assignments)
        .set({ dueAt: input.dueAt })
        .where(eq(assignments.weekId, input.weekId));
    }
  });
}

export async function updateCohortConfig(input: CohortConfigInput): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
  if (input.gracePeriodDays !== undefined) patch.gracePeriodDays = input.gracePeriodDays;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (Object.keys(patch).length === 0) return;

  await db.update(cohorts).set(patch).where(eq(cohorts.id, input.cohortId));
}

/**
 * Change an account's role, cohort or display name.
 *
 * Does NOT touch `passwordHash` or `email`: a password change belongs to the auth
 * stream's own flow (it owns the hashing), and letting an admin rewrite an email
 * silently reassigns someone's login identity.
 */
export async function updateAccount(input: AccountUpdateInput): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.role !== undefined) patch.role = input.role;
  if (input.cohortId !== undefined) patch.cohortId = input.cohortId;
  if (input.name !== undefined) patch.name = input.name;

  await db.update(users).set(patch).where(eq(users.id, input.userId));
}

/** Record a penalty/warning against a student. Returns the new row id. */
export async function issuePenalty(
  input: PenaltyIssueInput,
  issuedBy: number,
): Promise<number> {
  const [created] = await db
    .insert(penalties)
    .values({
      studentId: input.studentId,
      type: input.type,
      severity: input.severity,
      description: input.description ?? null,
      penaltyPoints: input.penaltyPoints,
      issuedBy,
    })
    .returning({ id: penalties.id });
  return created.id;
}

/** Mark a penalty resolved (an appeal upheld, or the work made good). */
export async function resolvePenalty(penaltyId: number): Promise<void> {
  await db
    .update(penalties)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(and(eq(penalties.id, penaltyId), eq(penalties.resolved, false)));
}
