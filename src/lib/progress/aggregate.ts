// =============================================================================
// PROGRESS AGGREGATION — raw week facts -> WeekProgress rows.
// Owner: progress-tracking stream (named in .claude/skills/progress-tracking).
// -----------------------------------------------------------------------------
// `buildWeekProgress` is PURE: rows in, WeekProgress out. That is what makes the
// unlock chain and the weekly-score arithmetic testable without a database, and
// it is why `query.ts` (SQL) and `score.ts` (maths) are separate files.
//
// Scoring comes exclusively from src/lib/contracts/scoring.ts via score.ts.
// Nothing here re-implements a threshold or a band.
// =============================================================================

import type { WeekProgress } from "@/lib/contracts/events";
import { POINTS } from "@/lib/contracts/scoring";

import { fetchWeekAggregates, type WeekAggregateRow } from "./query";
import {
  weekScoreBreakdown,
  overallPercent,
  type AssignmentScoreInput,
  type WeekScoreBreakdown,
} from "./score";
import type { CurriculumSection } from "@/components/course/sections";

import { deriveUnlocked } from "./unlock";

/** `WeekProgress` plus the extras the dashboard needs and the frozen type omits. */
export type WeekProgressDetail = WeekProgress & {
  /** Week deadline from `weeks.dueAt`; null when unscheduled. */
  dueAt: Date | null;
  /** Component points behind `overallScore`, so the UI can explain the number. */
  breakdown: WeekScoreBreakdown;
  /** How many quizzes the week has (0 when the week has none). */
  quizCount: number;
  /** Total submitted/graded attempts across the week's quizzes. */
  attemptCount: number;
  assignmentCount: number;
  submittedAssignmentCount: number;
  gradedAssignmentCount: number;
};

/** Assignment JSON from SQL -> the shape `score.ts` scores. */
function toAssignmentScoreInputs(row: WeekAggregateRow): AssignmentScoreInput[] {
  return row.assignments.map((a) => ({
    assignmentId: a.assignmentId,
    dueAt: new Date(a.dueAt),
    latePenaltyPercentPerDay: a.latePenaltyPercentPerDay,
    submittedAt: a.submittedAt ? new Date(a.submittedAt) : null,
    stars: a.stars,
  }));
}

/**
 * Turn aggregated week rows into the frozen `WeekProgress` shape, with the extra
 * dashboard fields attached.
 *
 * `quizCompleted` is true when every quiz in the week has at least one graded or
 * submitted attempt, OR when the quizzes stream has already set
 * `progress.quizCompleted`. A week with no quiz at all is not "completed" —
 * there was nothing to complete, and claiming otherwise inflates the
 * completion count on a half-authored course.
 *
 * `assignmentCompleted` means "delivered", not "graded": the student has done
 * their part. Grading state is visible separately via `gradedAssignmentCount`.
 *
 * `overallScore` is DERIVED here rather than read from `progress.overallScore`.
 * The stored column is a denormalised cache written by other streams; deriving
 * it means the dashboard can never show a score that the scoring contract
 * disagrees with.
 */
export function buildWeekProgress(
  rows: readonly WeekAggregateRow[],
  // Injectable ONLY so tests can pin which subjects are open while exercising
  // the progression chain; production callers omit it and get the configured
  // sections. See tests/support/curriculum-sections.ts for why that matters.
  sections?: readonly CurriculumSection[],
): WeekProgressDetail[] {
  const unlocked = deriveUnlocked(rows, sections);

  return rows.map((row, i) => {
    const breakdown = weekScoreBreakdown({
      quizBestPercent: row.quizBestPercent,
      assignments: toAssignmentScoreInputs(row),
      participationPointsRaw: row.participationPointsRaw,
    });

    const quizCompleted =
      row.quizCompletedFlag ||
      (row.quizCount > 0 && row.attemptedQuizCount >= row.quizCount);

    const assignmentCompleted =
      row.assignmentCompletedFlag ||
      (row.assignmentCount > 0 && row.submittedAssignmentCount >= row.assignmentCount);

    return {
      weekId: row.weekId,
      weekNumber: row.weekNumber,
      title: row.title,
      unlocked: unlocked[i] ?? false,
      lecturesCompleted: row.lecturesCompleted,
      lectureTotal: row.lectureTotal,
      quizCompleted,
      quizBestPercent: row.quizBestPercent,
      assignmentCompleted,
      overallScore: breakdown.total,
      dueAt: row.dueAt,
      breakdown,
      quizCount: row.quizCount,
      attemptCount: row.attemptCount,
      assignmentCount: row.assignmentCount,
      submittedAssignmentCount: row.submittedAssignmentCount,
      gradedAssignmentCount: row.gradedAssignmentCount,
    };
  });
}

/** Course-wide totals derived from week rows. Pure; safe on an empty array. */
export function totalsFrom(weeks: readonly WeekProgress[]): {
  totalScore: number;
  maxScore: number;
  percent: number;
} {
  const totalScore = weeks.reduce((n, w) => n + w.overallScore, 0);
  return {
    totalScore,
    maxScore: weeks.length * POINTS.WEEK_MAX,
    percent: overallPercent(totalScore, weeks.length),
  };
}

/**
 * Aggregated score for ONE week — the `getWeeklyScore(studentId, weekId)`
 * contract from the skill definition.
 *
 * Implemented on top of the same single-statement aggregate as the dashboard
 * rather than a bespoke per-week query: one code path means the number a caller
 * sees here can never differ from the number on the dashboard. Returns 0 when
 * the week does not belong to the student's course.
 */
export async function getWeeklyScore(studentId: number, weekId: number): Promise<number> {
  const rows = await fetchWeekAggregates(studentId);
  const week = buildWeekProgress(rows).find((w) => w.weekId === weekId);
  return week?.overallScore ?? 0;
}

/** Component breakdown for one week, or null when the week is not in scope. */
export async function getWeeklyScoreBreakdown(
  studentId: number,
  weekId: number,
): Promise<WeekScoreBreakdown | null> {
  const rows = await fetchWeekAggregates(studentId);
  const week = buildWeekProgress(rows).find((w) => w.weekId === weekId);
  return week?.breakdown ?? null;
}
