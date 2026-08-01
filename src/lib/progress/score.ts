// =============================================================================
// WEEKLY SCORE MATHS — pure, database-free, unit-tested.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// Every number here comes out of `src/lib/contracts/scoring.ts`. Nothing in this
// file re-implements a band, a threshold, a cap or a late penalty: the whole
// point of the scoring contract is that the quizzes, submissions, leaderboard
// and progress streams cannot disagree about a student's total. If a rule needs
// to change, it changes in scoring.ts and every stream moves together.
//
// Kept separate from `query.ts` so the arithmetic is testable without a
// database, which is the only way to assert the boundary cases (exactly 70 vs
// 69.99) cheaply.
// =============================================================================

import {
  POINTS,
  assignmentPoints,
  daysLate as daysLateFrom,
  quizPointsFromPercent,
} from "@/lib/contracts/scoring";

/**
 * One assignment of a week, plus the student's best submission for it (null when
 * they have not submitted). `stars` is the instructor rating, 1..5, null while
 * unrated — `scoring.assignmentPoints` defines null as "not yet rated" and awards
 * NO marks for it, so an ungraded-but-submitted assignment contributes 0 to the
 * week until a human rates it. See `assignmentPointsForWeek` below.
 */
export type AssignmentScoreInput = {
  assignmentId: number;
  /** Assignment deadline. Metric/UTC — the DB stores timestamptz. */
  dueAt: Date;
  /** Percent removed per day late, from `assignments.latePenaltyPercentPerDay`. */
  latePenaltyPercentPerDay: number;
  /** Null when the student has no submission for this assignment. */
  submittedAt: Date | null;
  /** Instructor star rating 1..5, null when unrated or unsubmitted. */
  stars: number | null;
};

/** Everything a week's score is computed from. Deliberately plain data. */
export type WeekScoreInput = {
  /** Best quiz percentage for the week, null when never attempted. */
  quizBestPercent: number | null;
  /** Every assignment of the week (usually exactly one). */
  assignments: AssignmentScoreInput[];
  /** Raw participation points summed from `attendance.participationScore`. */
  participationPointsRaw: number;
};

/** The three components plus the capped total, so the UI can explain the number. */
export type WeekScoreBreakdown = {
  quizPoints: number;
  assignmentPoints: number;
  participationPoints: number;
  /** Sum of the three, capped at `POINTS.WEEK_MAX`. */
  total: number;
};

/**
 * Quiz component. A student with no attempt scores 0 — note that this is NOT
 * the same as calling `quizPointsFromPercent(0)` by accident on a null, which
 * would coincidentally also be 0 today but would silently start awarding points
 * if the lowest band ever moved off zero.
 */
export function quizPointsForWeek(quizBestPercent: number | null): number {
  if (quizBestPercent == null) return 0;
  if (!Number.isFinite(quizBestPercent)) return 0;
  return quizPointsFromPercent(quizBestPercent);
}

/**
 * Assignment component.
 *
 * A week normally has one assignment. When it has several, the per-assignment
 * points (each out of `POINTS.ASSIGNMENT_MAX`) are averaged so the week's
 * assignment ceiling stays at ASSIGNMENT_MAX rather than multiplying with the
 * number of assignments — the syllabus allocates 40% to "weekly assignments",
 * not 40% per artefact.
 *
 * An assignment with no submission contributes 0, and so does one that has been
 * submitted but not yet rated.
 *
 * FIXED 2026-07-31, and this comment used to say the opposite. Submitted-but-unrated
 * contributed the FULL 40, because `scoring.assignmentPoints` started at
 * ASSIGNMENT_MAX and only deducted, and `stars: null` deducted nothing. This file
 * called it a TRADE-OFF and flagged it as a coordinated seam change rather than
 * working around it — correctly. The seam change has now been made: an ungraded
 * submission scores 0, so the mere act of ingesting a row from the response sheet
 * no longer awards a student 40% of the week. The long argument is on
 * `assignmentPoints` in src/lib/contracts/scoring.ts.
 *
 * CONSEQUENCE A READER SHOULD EXPECT: a student's weekly total now RISES when their
 * assignment is marked, where before it could only fall. That is the direction a
 * grade should move.
 */
export function assignmentPointsForWeek(assignments: AssignmentScoreInput[]): number {
  if (assignments.length === 0) return 0;

  const perAssignment = assignments.map((a) => {
    if (!a.submittedAt) return 0;
    return assignmentPoints({
      daysLate: daysLateFrom(a.submittedAt, a.dueAt),
      latePenaltyPercentPerDay: a.latePenaltyPercentPerDay,
      stars: a.stars,
    });
  });

  const sum = perAssignment.reduce((n, p) => n + p, 0);
  return Math.round(sum / assignments.length);
}

/** Participation component, floored at 0 and capped at PARTICIPATION_MAX. */
export function participationPointsForWeek(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(0, Math.round(raw)), POINTS.PARTICIPATION_MAX);
}

/**
 * The aggregated weekly score: quiz + assignment + participation, capped at
 * `POINTS.WEEK_MAX`. The cap matters because the three component maxima
 * (20 + 40 + 10) happen to equal WEEK_MAX today; if a future band pushed a
 * component higher, an uncapped sum would quietly inflate a week past 70.
 */
export function weekScoreBreakdown(input: WeekScoreInput): WeekScoreBreakdown {
  const quiz = quizPointsForWeek(input.quizBestPercent);
  const assignment = assignmentPointsForWeek(input.assignments);
  const participation = participationPointsForWeek(input.participationPointsRaw);
  const total = Math.min(quiz + assignment + participation, POINTS.WEEK_MAX);
  return {
    quizPoints: quiz,
    assignmentPoints: assignment,
    participationPoints: participation,
    total,
  };
}

/** Convenience: just the capped total. */
export function weekScore(input: WeekScoreInput): number {
  return weekScoreBreakdown(input).total;
}

/**
 * Percentage of the coursework ceiling a set of week scores represents.
 *
 * Guards the zero-activity / empty-course cases explicitly: a brand-new student
 * has `total = 0`, and a database with no weeks yet gives `weekCount = 0`. The
 * naive `total / (weekCount * WEEK_MAX)` renders "NaN%" for the second, which is
 * exactly the first thing a new student would see.
 */
export function overallPercent(totalScore: number, weekCount: number): number {
  const max = weekCount * POINTS.WEEK_MAX;
  if (max <= 0) return 0;
  if (!Number.isFinite(totalScore) || totalScore <= 0) return 0;
  return Math.min(100, Math.round((totalScore / max) * 1000) / 10);
}
