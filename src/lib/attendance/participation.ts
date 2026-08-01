// =============================================================================
// PARTICIPATION SCORING — pure. Owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// Participation is 10% of the course (POINTS.PARTICIPATION_MAX = 10, from the
// frozen scoring contract). This module turns per-lecture attendance rows into
// the weekly participation points that the leaderboard and the weekly score
// consume. It performs no I/O, so the thresholds are testable without a database.
//
// UNITS: durations in milliseconds where any appear. Rates are fractions 0..1;
// percentages are 0..100 and always named `...Percent`.
// =============================================================================

import { POINTS } from "@/lib/contracts/scoring";

/**
 * Attendance rate below which a week earns ZERO participation points.
 *
 * The acceptance criterion is explicit: "attendance below 80% in a week yields
 * zero participation points that week". It is a cliff, not a slope — turning up
 * to one lecture in three is not worth a third of the participation mark.
 */
export const MIN_ATTENDANCE_PERCENT = 80;

/** The subset of an `attendance` row participation scoring needs. */
export type AttendanceRecord = {
  lectureId: number;
  attended: boolean;
  /** Instructor's 0..PARTICIPATION_MAX judgement for that lecture. */
  participationScore: number;
};

export type ParticipationResult = {
  lectureTotal: number;
  lecturesAttended: number;
  /** 0..100, rounded to one decimal for display. 0 when there are no lectures. */
  attendanceRatePercent: number;
  /** True when the 80% cliff was cleared. */
  meetsMinimumAttendance: boolean;
  /** 0..POINTS.PARTICIPATION_MAX, integer. */
  points: number;
  /** Plain-language explanation, shown to the student on the notices page. */
  rationale: string;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(POINTS.PARTICIPATION_MAX, value);
}

/**
 * Weekly participation points from a week's attendance rows.
 *
 * @param records   one row per lecture in the week that has been recorded
 * @param lectureTotal how many lectures the week actually has. Passed in rather
 *   than inferred from `records.length`, because an unrecorded lecture is an
 *   absence for scoring purposes — inferring it would silently reward a student
 *   whose absences were simply never entered. Defaults to `records.length` for
 *   callers that have already materialised a row per lecture.
 *
 * Scoring, in order:
 *   1. attendanceRate = attended / lectureTotal.
 *   2. Below MIN_ATTENDANCE_PERCENT (80) -> 0 points. Hard cliff.
 *   3. At or above it, prefer the instructor's own per-lecture
 *      `participationScore` values when any were entered: averaging their
 *      judgement over the attended lectures is finer-grained than a head count.
 *   4. If no instructor scores were entered, fall back to
 *      round(PARTICIPATION_MAX * attendanceRate) — attendance alone.
 *   Result is clamped to 0..PARTICIPATION_MAX and rounded to an integer, because
 *   `attendance.participationScore` and the weekly score columns are integers.
 */
export function participationForWeek(
  records: readonly AttendanceRecord[],
  lectureTotal: number = records.length,
): ParticipationResult {
  const total = Number.isFinite(lectureTotal) ? Math.max(0, Math.trunc(lectureTotal)) : 0;
  const attendedRecords = records.filter((r) => r.attended);
  const lecturesAttended = Math.min(attendedRecords.length, total || attendedRecords.length);

  if (total === 0) {
    return {
      lectureTotal: 0,
      lecturesAttended: 0,
      attendanceRatePercent: 0,
      meetsMinimumAttendance: false,
      points: 0,
      rationale: "No lectures scheduled for this week yet.",
    };
  }

  const rate = lecturesAttended / total;
  const attendanceRatePercent = Math.round(rate * 1000) / 10;
  const meetsMinimumAttendance = attendanceRatePercent >= MIN_ATTENDANCE_PERCENT;

  if (!meetsMinimumAttendance) {
    return {
      lectureTotal: total,
      lecturesAttended,
      attendanceRatePercent,
      meetsMinimumAttendance: false,
      points: 0,
      rationale:
        `Attended ${lecturesAttended} of ${total} lectures (${attendanceRatePercent}%), ` +
        `below the ${MIN_ATTENDANCE_PERCENT}% minimum — no participation points this week.`,
    };
  }

  const scored = attendedRecords.filter(
    (r) => Number.isFinite(r.participationScore) && r.participationScore > 0,
  );

  let points: number;
  let rationale: string;
  if (scored.length > 0) {
    const mean =
      scored.reduce((sum, r) => sum + clampScore(r.participationScore), 0) / scored.length;
    points = Math.round(clampScore(mean));
    rationale =
      `Attended ${lecturesAttended} of ${total} lectures (${attendanceRatePercent}%); ` +
      `instructor participation average ${points}/${POINTS.PARTICIPATION_MAX}.`;
  } else {
    points = Math.round(clampScore(POINTS.PARTICIPATION_MAX * rate));
    rationale =
      `Attended ${lecturesAttended} of ${total} lectures (${attendanceRatePercent}%); ` +
      `${points}/${POINTS.PARTICIPATION_MAX} participation points from attendance.`;
  }

  return {
    lectureTotal: total,
    lecturesAttended,
    attendanceRatePercent,
    meetsMinimumAttendance: true,
    points,
    rationale,
  };
}
