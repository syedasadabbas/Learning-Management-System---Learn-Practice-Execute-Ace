// =============================================================================
// READ MODEL — a student's assignment/submission history.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// Drives the student-facing pages and is the shape the progress-tracking stream
// can read for `assignmentCompleted`. One row per ASSIGNMENT, not per submission,
// so an assignment the student has not handed in still appears with
// `status: "not_submitted"` instead of being invisible — a missing row is
// indistinguishable from "no assignment set", and that difference is exactly what
// a student checking their standing needs to see.
// =============================================================================

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, cohorts, submissions, users, weeks, type submissionStatus } from "@/db/schema";
import { POINTS } from "@/lib/contracts/scoring";

import { ceilingForSubmission, computeLateness, effectiveDueAt, normaliseGraceDays } from "./lateness";

export type SubmissionState = (typeof submissionStatus.enumValues)[number] | "not_submitted";

export type AssignmentHistoryItem = {
  assignmentId: number;
  assignmentTitle: string;
  description: string;
  requirements: string[];
  weekId: number;
  weekNumber: number;
  weekTitle: string;
  dueAt: Date;
  /** `dueAt` + the cohort's grace days — the deadline lateness is measured from. */
  effectiveDueAt: Date;
  gracePeriodDays: number;
  latePenaltyPercentPerDay: number;

  /**
   * The Google Form the student submits through. NULL in the seeded data — see
   * the TODO(decision) in scripts/seed.ts. The UI must render the "not yet
   * configured" state rather than a dead link.
   */
  googleFormUrl: string | null;
  /** Convenience for the UI so it does not re-derive the null check. */
  formConfigured: boolean;

  submissionId: number | null;
  status: SubmissionState;
  submittedAt: Date | null;
  githubUrl: string | null;
  liveUrl: string | null;
  submissionNotes: string | null;
  isLate: boolean;
  /** Days past the effective deadline. 0 when on time, inside grace, or unsubmitted. */
  daysLate: number;
  /** True when handed in after `dueAt` but inside the grace window. */
  withinGrace: boolean;

  /** Recorded score, 0..40. Null until an instructor grades it. */
  score: number | null;
  /** 1..5. Null until rated. */
  stars: number | null;
  feedback: string | null;
  gradedAt: Date | null;

  /**
   * What the submission would score at a full 3-star rating given its current
   * lateness — i.e. the ceiling the late penalty has already imposed. Shown so a
   * student can see the cost of being late before it is graded. Null when nothing
   * has been submitted.
   */
  provisionalMaxScore: number | null;
  /** POINTS.ASSIGNMENT_MAX, exposed so no UI hardcodes 40. */
  maxScore: number;
};

/**
 * Grace days for one student, from their cohort.
 *
 * A student with no cohort gets 0 — `normaliseGraceDays` is the single place that
 * decision is made, so it is not repeated per call site.
 */
export async function graceDaysForStudent(studentId: number): Promise<number> {
  const [row] = await db
    .select({ gracePeriodDays: cohorts.gracePeriodDays })
    .from(users)
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(eq(users.id, studentId))
    .limit(1);
  return normaliseGraceDays(row?.gracePeriodDays ?? null);
}

/** `assignments.requirements` is jsonb; coerce defensively rather than cast. */
function toRequirements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Every assignment in the course with this student's submission state attached.
 *
 * A LEFT JOIN on `submissions` scoped to this student, so the query returns one
 * row per assignment whether or not there is a submission. Ordered by week then
 * deadline, which is the order the student reads it in.
 */
export async function getAssignmentHistory(studentId: number): Promise<AssignmentHistoryItem[]> {
  const graceDays = await graceDaysForStudent(studentId);

  const rows = await db
    .select({
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      description: assignments.description,
      requirements: assignments.requirements,
      googleFormUrl: assignments.googleFormUrl,
      dueAt: assignments.dueAt,
      latePenaltyPercentPerDay: assignments.latePenaltyPercentPerDay,
      weekId: weeks.id,
      weekNumber: weeks.weekNumber,
      weekTitle: weeks.title,
      submissionId: submissions.id,
      submissionStatusValue: submissions.status,
      submittedAt: submissions.submittedAt,
      githubUrl: submissions.githubUrl,
      liveUrl: submissions.liveUrl,
      submissionNotes: submissions.description,
      isLate: submissions.isLate,
      score: submissions.score,
      stars: submissions.instructorRating,
      feedback: submissions.feedback,
      gradedAt: submissions.gradedAt,
    })
    .from(assignments)
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .leftJoin(
      submissions,
      and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, studentId)),
    )
    .orderBy(asc(weeks.weekNumber), asc(assignments.dueAt));

  return rows.map((row) => toHistoryItem(row, graceDays));
}

/** One week's assignment for one student, or null when the week has none. */
export async function getAssignmentForWeek(
  weekId: number,
  studentId: number,
): Promise<AssignmentHistoryItem | null> {
  const all = await getAssignmentHistory(studentId);
  const match = all.find((item) => item.weekId === weekId);
  return match ?? null;
}

/**
 * The joined row shape `getAssignmentHistory` selects.
 *
 * Written out rather than inferred from the query so that `toHistoryItem` is a
 * pure, directly testable function that does not need a database handle in scope.
 */
export type HistoryRow = {
  assignmentId: number;
  assignmentTitle: string;
  description: string;
  requirements: unknown;
  googleFormUrl: string | null;
  dueAt: Date;
  latePenaltyPercentPerDay: number;
  weekId: number;
  weekNumber: number;
  weekTitle: string;
  submissionId: number | null;
  submissionStatusValue: (typeof submissionStatus.enumValues)[number] | null;
  submittedAt: Date | null;
  githubUrl: string | null;
  liveUrl: string | null;
  submissionNotes: string | null;
  isLate: boolean | null;
  score: number | null;
  stars: number | null;
  feedback: string | null;
  gradedAt: Date | null;
};

export function toHistoryItem(
  row: HistoryRow,
  graceDays: number,
): AssignmentHistoryItem {
  const effective = effectiveDueAt(row.dueAt, graceDays);

  // Lateness is recomputed from the stored timestamp rather than trusted from
  // `submissions.is_late`. The stored flag was written at ingestion time under
  // whatever grace period the cohort had then; recomputing means an adjusted
  // grace window is reflected immediately and consistently everywhere.
  const lateness =
    row.submittedAt != null
      ? computeLateness({
          submittedAt: row.submittedAt,
          dueAt: row.dueAt,
          gracePeriodDays: graceDays,
        })
      : null;

  // The late-penalty CEILING, not a prediction of the grade. This used to be
  // `pointsForSubmission({ stars: null })` and relied on a null rating deducting
  // nothing; `assignmentPoints` now scores an ungraded submission 0 (see its note),
  // so the intent is stated by calling the function that means it.
  const provisional =
    row.submittedAt != null
      ? ceilingForSubmission({
          submittedAt: row.submittedAt,
          dueAt: row.dueAt,
          gracePeriodDays: graceDays,
          latePenaltyPercentPerDay: row.latePenaltyPercentPerDay,
        }).points
      : null;

  return {
    assignmentId: row.assignmentId,
    assignmentTitle: row.assignmentTitle,
    description: row.description,
    requirements: toRequirements(row.requirements),
    weekId: row.weekId,
    weekNumber: row.weekNumber,
    weekTitle: row.weekTitle,
    dueAt: row.dueAt,
    effectiveDueAt: effective,
    gracePeriodDays: graceDays,
    latePenaltyPercentPerDay: row.latePenaltyPercentPerDay,

    googleFormUrl: row.googleFormUrl,
    formConfigured: (row.googleFormUrl ?? "").trim() !== "",

    submissionId: row.submissionId,
    status: row.submissionId == null ? "not_submitted" : (row.submissionStatusValue ?? "submitted"),
    submittedAt: row.submittedAt,
    githubUrl: row.githubUrl,
    liveUrl: row.liveUrl,
    submissionNotes: row.submissionNotes,
    isLate: lateness?.isLate ?? false,
    daysLate: lateness?.daysLate ?? 0,
    withinGrace: lateness?.withinGrace ?? false,

    score: row.score,
    stars: row.stars,
    feedback: row.feedback,
    gradedAt: row.gradedAt,

    provisionalMaxScore: provisional,
    maxScore: POINTS.ASSIGNMENT_MAX,
  };
}
