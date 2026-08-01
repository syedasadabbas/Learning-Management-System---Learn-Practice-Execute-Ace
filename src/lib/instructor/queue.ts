// =============================================================================
// GRADING QUEUE READ MODEL — instructor-admin stream.
// -----------------------------------------------------------------------------
// One query returns everything the grading screen shows: the submission, the
// student it belongs to, the assignment's deadline and late-penalty rate (the
// grader needs those to understand the computed score), and the week it sits in.
//
// COLUMN SELECTION IS EXPLICIT AND ALWAYS WILL BE. `users` carries
// `passwordHash`; a `select().from(users)` here would put every instructor's
// view one careless `JSON.stringify` away from leaking the whole credential
// table. The projections below name columns, so the hash is not in the result
// set at all and cannot be serialised by a later edit.
//
// EMPTY IS NORMAL. Both `assignments.googleFormUrl` and `googleSheetCsvUrl` are
// null in seeded data, so nothing has been ingested and the queue is legitimately
// empty on a fresh install. Callers must render that as "nothing to grade", not
// as a failure — see components/instructor/QueueTable.tsx.
// =============================================================================

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  cohorts,
  submissions,
  submissionStatus,
  users,
  weeks,
} from "@/db/schema";
// The submissions stream's composition of `computeLateness` + `assignmentPoints`.
// Used here so the score PREVIEWED in the queue matches the score the grading
// write path will store, grace window included.
import { pointsForSubmission } from "@/lib/submissions/lateness";

export type SubmissionStatus = (typeof submissionStatus.enumValues)[number];

/** The statuses that still need instructor attention. */
export const NEEDS_REVIEW_STATUSES: readonly SubmissionStatus[] = [
  "submitted",
  "under_review",
];

export interface QueueFilter {
  /** Week number (1-based, as the student sees it), not the week row id. */
  weekNumber?: number;
  /** Explicit status filter. Omitted = statuses that need review. */
  status?: SubmissionStatus;
  /** Pass true to list every status, ignoring the needs-review default. */
  allStatuses?: boolean;
  cohortId?: number;
  limit?: number;
}

export interface QueueRow {
  submissionId: number;
  studentId: number;
  studentName: string;
  studentEmail: string;
  cohortId: number | null;
  weekId: number;
  weekNumber: number;
  weekTitle: string;
  assignmentId: number;
  assignmentTitle: string;
  githubUrl: string | null;
  liveUrl: string | null;
  description: string | null;
  submittedAt: Date;
  dueAt: Date;
  latePenaltyPercentPerDay: number;
  /** The student's cohort grace window, in days. 0 when not cohort-scoped. */
  gracePeriodDays: number;
  isLate: boolean;
  /** Days late AFTER the grace window — what the score actually depends on. */
  daysLate: number;
  /** Past the deadline but still inside the grace window. */
  withinGrace: boolean;
  status: SubmissionStatus;
  score: number | null;
  stars: number | null;
  feedback: string | null;
  gradedAt: Date | null;
  /**
   * What `assignmentPoints` would award at the current star rating, so the
   * grader sees the consequence of the rating before saving. Null until rated —
   * a projection, not a stored value.
   */
  projectedScore: number | null;
}

/** Parse an untrusted status string from a query parameter. */
export function parseStatus(raw: string | null | undefined): SubmissionStatus | undefined {
  if (!raw) return undefined;
  return (submissionStatus.enumValues as readonly string[]).includes(raw)
    ? (raw as SubmissionStatus)
    : undefined;
}

/** Parse an untrusted week number from a query parameter. 1..52 or undefined. */
export function parseWeekNumber(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 52) return undefined;
  return n;
}

/**
 * Rows the instructor should look at, newest submission first.
 *
 * Filtering happens in SQL. Pulling the cohort's submissions into Node and
 * filtering there would work at 50-80 students and quietly stop working later.
 */
export async function getGradingQueue(filter: QueueFilter = {}): Promise<QueueRow[]> {
  const conditions: SQL[] = [];

  if (filter.status) {
    conditions.push(eq(submissions.status, filter.status));
  } else if (!filter.allStatuses) {
    conditions.push(inArray(submissions.status, [...NEEDS_REVIEW_STATUSES]));
  }
  if (filter.weekNumber !== undefined) {
    conditions.push(eq(weeks.weekNumber, filter.weekNumber));
  }
  if (filter.cohortId !== undefined) {
    conditions.push(eq(users.cohortId, filter.cohortId));
  }

  const rows = await db
    .select({
      submissionId: submissions.id,
      studentId: submissions.studentId,
      // Explicit user columns. passwordHash is deliberately absent.
      studentName: users.name,
      studentEmail: users.email,
      cohortId: users.cohortId,
      weekId: weeks.id,
      weekNumber: weeks.weekNumber,
      weekTitle: weeks.title,
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      githubUrl: submissions.githubUrl,
      liveUrl: submissions.liveUrl,
      description: submissions.description,
      submittedAt: submissions.submittedAt,
      dueAt: assignments.dueAt,
      latePenaltyPercentPerDay: assignments.latePenaltyPercentPerDay,
      gracePeriodDays: cohorts.gracePeriodDays,
      isLate: submissions.isLate,
      status: submissions.status,
      score: submissions.score,
      stars: submissions.instructorRating,
      feedback: submissions.feedback,
      gradedAt: submissions.gradedAt,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    // LEFT join: a student with no cohort still appears, with no grace window.
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(weeks.weekNumber), desc(submissions.submittedAt))
    .limit(filter.limit ?? 200);

  return rows.map((r) => {
    const graceDays = r.gracePeriodDays ?? 0;
    const { points, lateness } = pointsForSubmission({
      submittedAt: r.submittedAt,
      dueAt: r.dueAt,
      gracePeriodDays: graceDays,
      latePenaltyPercentPerDay: r.latePenaltyPercentPerDay,
      stars: r.stars,
    });
    return {
      ...r,
      gracePeriodDays: graceDays,
      daysLate: lateness.daysLate,
      withinGrace: lateness.withinGrace,
      // Null until rated. Since 2026-07-31 `pointsForSubmission` returns 0 rather
      // than 40 for a null rating, so the guard is no longer load-bearing against a
      // misleading 40 — but it stays, because "not yet rated" and "rated and worth
      // nothing" are different facts and the grader must not see them as one.
      projectedScore: r.stars == null ? null : points,
    };
  });
}

/** One queue row by submission id, or null. Same projection, same guarantees. */
export async function getQueueRow(submissionId: number): Promise<QueueRow | null> {
  const rows = await getGradingQueue({ allStatuses: true, limit: 1000 });
  return rows.find((r) => r.submissionId === submissionId) ?? null;
}

/** Counts per status, computed in SQL, for the queue's filter chips. */
export async function getQueueCounts(
  cohortId?: number,
): Promise<Record<SubmissionStatus, number>> {
  const rows = await db
    .select({ status: submissions.status, n: sql<number>`count(*)::int` })
    .from(submissions)
    .innerJoin(users, eq(submissions.studentId, users.id))
    .where(cohortId === undefined ? undefined : eq(users.cohortId, cohortId))
    .groupBy(submissions.status);

  const counts = Object.fromEntries(
    submissionStatus.enumValues.map((s) => [s, 0]),
  ) as Record<SubmissionStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}
