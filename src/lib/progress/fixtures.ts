// =============================================================================
// TEST FIXTURES for the progress read model. Imported only by *.test.ts files.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// Lives in src/ rather than tests/ because `tests/` is shared territory owned by
// the devops-testing stream, and because the factory has to stay in step with
// `WeekAggregateRow` — putting it next to the type means a schema change breaks
// the fixture at compile time instead of at assertion time.
// =============================================================================

import type { AssignmentAggregate, WeekAggregateRow } from "./query";

/** A week with nothing recorded: exactly what a new student's rows look like. */
export function emptyWeekRow(weekNumber: number, overrides: Partial<WeekAggregateRow> = {}): WeekAggregateRow {
  return {
    weekId: 100 + weekNumber,
    weekNumber,
    title: `Week ${weekNumber} title`,
    dueAt: null,
    lectureTotal: 3,
    lecturesCompleted: 0,
    quizBestPercent: null,
    quizCount: 1,
    attemptedQuizCount: 0,
    attemptCount: 0,
    quizCompletedFlag: false,
    assignmentCount: 1,
    submittedAssignmentCount: 0,
    gradedAssignmentCount: 0,
    assignmentCompletedFlag: false,
    assignments: [unsubmittedAssignment(weekNumber)],
    participationPointsRaw: 0,
    ...overrides,
  };
}

/** An assignment the student has not submitted. */
export function unsubmittedAssignment(weekNumber: number): AssignmentAggregate {
  return {
    assignmentId: 900 + weekNumber,
    dueAt: `2026-09-${String(7 * weekNumber).padStart(2, "0")}T00:00:00.000Z`,
    latePenaltyPercentPerDay: 10,
    submittedAt: null,
    status: null,
    stars: null,
    isLate: null,
  };
}

/** An on-time, graded submission with the given star rating. */
export function gradedAssignment(
  weekNumber: number,
  stars: number | null,
  overrides: Partial<AssignmentAggregate> = {},
): AssignmentAggregate {
  const base = unsubmittedAssignment(weekNumber);
  return {
    ...base,
    submittedAt: base.dueAt, // exactly on the deadline -> daysLate 0
    status: "graded",
    stars,
    isLate: false,
    ...overrides,
  };
}

/** A fully completed week: lectures watched, quiz passed, assignment graded. */
export function completedWeekRow(
  weekNumber: number,
  quizPercent = 90,
  overrides: Partial<WeekAggregateRow> = {},
): WeekAggregateRow {
  return emptyWeekRow(weekNumber, {
    lecturesCompleted: 3,
    quizBestPercent: quizPercent,
    attemptedQuizCount: 1,
    attemptCount: 1,
    quizCompletedFlag: true,
    submittedAssignmentCount: 1,
    gradedAssignmentCount: 1,
    assignmentCompletedFlag: true,
    assignments: [gradedAssignment(weekNumber, 5)],
    participationPointsRaw: 10,
    ...overrides,
  });
}
