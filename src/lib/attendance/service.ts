// =============================================================================
// ATTENDANCE PERSISTENCE — owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// Per-lecture attendance records plus the weekly participation roll-up.
//
// NO HTTP ROUTES: the frozen `ROUTES` map has no attendance endpoints and a
// feature stream must not add one, so these are server functions. The instructor
// UI calls them through the server actions in ./actions.ts.
//
// AUTHORIZATION is the caller's job — every mutating function takes the acting
// instructor id, which a caller can only have obtained via requireRole().
//
// UNITS: `recordedAt` is a UTC timestamp; all durations in this stream are
// milliseconds (see rules.MS_PER_DAY). Metric throughout.
// =============================================================================

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { attendance, lectures, users, weeks } from "@/db/schema";
import { onScoringEvent } from "@/lib/leaderboard/on-scoring-event";

import {
  participationForWeek,
  type AttendanceRecord,
  type ParticipationResult,
} from "./participation";

export type AttendanceRow = typeof attendance.$inferSelect;

export type RecordAttendanceInput = {
  studentId: number;
  lectureId: number;
  attended: boolean;
  /** 0..POINTS.PARTICIPATION_MAX. Defaults to 0 for a bare presence tick. */
  participationScore?: number;
};

/**
 * Record (or re-record) one student's attendance for one lecture.
 *
 * `attendance` has a unique index on (studentId, lectureId), so a second call
 * for the same pair MUST update rather than fail — an instructor correcting a
 * mis-click is the normal case, not an error. Implemented as a single
 * `INSERT ... ON CONFLICT DO UPDATE`, which is also race-safe: two instructors
 * saving the same row concurrently produces one row, last write winning, instead
 * of one of them getting a unique-violation 500.
 */
export async function recordAttendance(
  input: RecordAttendanceInput,
): Promise<AttendanceRow> {
  const participationScore = normaliseScore(input.participationScore);

  const rows = await db
    .insert(attendance)
    .values({
      studentId: input.studentId,
      lectureId: input.lectureId,
      attended: input.attended,
      participationScore,
    })
    .onConflictDoUpdate({
      target: [attendance.studentId, attendance.lectureId],
      set: {
        attended: input.attended,
        participationScore,
        recordedAt: new Date(),
      },
    })
    .returning();

  return rows[0];
}

/** Record a whole roster for one lecture. Each row upserts independently. */
export async function recordAttendanceBatch(
  inputs: readonly RecordAttendanceInput[],
): Promise<AttendanceRow[]> {
  const out: AttendanceRow[] = [];
  for (const input of inputs) {
    out.push(await recordAttendance(input));
  }
  return out;
}

function normaliseScore(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

/** Lecture ids belonging to a week, in teaching order. */
export async function lectureIdsForWeek(weekId: number): Promise<number[]> {
  const rows = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(eq(lectures.weekId, weekId));
  return rows.map((r) => r.id);
}

/**
 * One student's attendance rows for a week, alongside the week's lecture count.
 *
 * The lecture count comes from `lectures`, not from the attendance rows: an
 * unrecorded lecture counts as an absence, so inferring the denominator from the
 * rows would inflate the rate of a student whose absences were never entered.
 */
export async function weekAttendance(
  studentId: number,
  weekId: number,
): Promise<{ records: AttendanceRecord[]; lectureTotal: number }> {
  const ids = await lectureIdsForWeek(weekId);
  if (ids.length === 0) return { records: [], lectureTotal: 0 };

  const rows = await db
    .select({
      lectureId: attendance.lectureId,
      attended: attendance.attended,
      participationScore: attendance.participationScore,
    })
    .from(attendance)
    .where(and(eq(attendance.studentId, studentId), inArray(attendance.lectureId, ids)));

  return { records: rows, lectureTotal: ids.length };
}

/** Participation points a student has earned for a week. Read-only. */
export async function weekParticipation(
  studentId: number,
  weekId: number,
): Promise<ParticipationResult> {
  const { records, lectureTotal } = await weekAttendance(studentId, weekId);
  return participationForWeek(records, lectureTotal);
}

/**
 * Recompute a student's weekly participation and push it to the leaderboard.
 *
 * The scoring event is fired OUTSIDE any transaction and its rejection is
 * swallowed: a leaderboard refresh failing must never undo a recorded
 * attendance. `onScoringEvent` is currently a no-op stub owned by the
 * leaderboard stream; this call site is what makes it live once that lands.
 */
export async function syncWeekParticipation(
  studentId: number,
  weekId: number,
): Promise<ParticipationResult> {
  const result = await weekParticipation(studentId, weekId);

  const cohortRows = await db
    .select({ cohortId: users.cohortId })
    .from(users)
    .where(eq(users.id, studentId));
  const cohortId = cohortRows[0]?.cohortId ?? null;

  try {
    await onScoringEvent({
      studentId,
      cohortId,
      source: "participation",
      weekId,
      points: result.points,
    });
  } catch {
    // Deliberately swallowed — see the doc comment. The attendance row is
    // already committed and is the source of truth; the leaderboard is a
    // derived read model that its own stream can rebuild.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Read models for the instructor UI
// ---------------------------------------------------------------------------

export type WeekOption = { id: number; weekNumber: number; title: string };

/** Weeks, in order, for the attendance page's week picker. */
export async function listWeeks(): Promise<WeekOption[]> {
  return db
    .select({ id: weeks.id, weekNumber: weeks.weekNumber, title: weeks.title })
    .from(weeks)
    .orderBy(asc(weeks.weekNumber));
}

export type AttendanceGridStudent = {
  studentId: number;
  name: string;
  email: string;
  /** lectureId -> recorded state. Absent key = nothing recorded yet. */
  marks: Record<number, { attended: boolean; participationScore: number }>;
  participation: ParticipationResult;
};

export type AttendanceGrid = {
  weekId: number;
  lectures: { id: number; lectureNumber: number; title: string }[];
  students: AttendanceGridStudent[];
};

/**
 * Everything the instructor attendance table needs for one week: the week's
 * lectures, the roster, and each student's current marks and participation.
 *
 * `cohortId` narrows the roster; passing null lists every student, which is what
 * a single-cohort deployment wants (appConfig.course.concurrentCohorts = false).
 */
export async function attendanceGridForWeek(
  weekId: number,
  cohortId: number | null = null,
): Promise<AttendanceGrid> {
  const lectureRows = await db
    .select({
      id: lectures.id,
      lectureNumber: lectures.lectureNumber,
      title: lectures.title,
    })
    .from(lectures)
    .where(eq(lectures.weekId, weekId))
    .orderBy(asc(lectures.orderIndex), asc(lectures.lectureNumber));

  const studentRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      cohortId == null
        ? eq(users.role, "student")
        : and(eq(users.role, "student"), eq(users.cohortId, cohortId)),
    )
    .orderBy(asc(users.name));

  const lectureIds = lectureRows.map((l) => l.id);
  const markRows =
    lectureIds.length === 0
      ? []
      : await db
          .select({
            studentId: attendance.studentId,
            lectureId: attendance.lectureId,
            attended: attendance.attended,
            participationScore: attendance.participationScore,
          })
          .from(attendance)
          .where(inArray(attendance.lectureId, lectureIds));

  const students: AttendanceGridStudent[] = studentRows.map((s) => {
    const own = markRows.filter((m) => m.studentId === s.id);
    const marks: AttendanceGridStudent["marks"] = {};
    for (const m of own) {
      marks[m.lectureId] = {
        attended: m.attended,
        participationScore: m.participationScore,
      };
    }
    return {
      studentId: s.id,
      name: s.name,
      email: s.email,
      marks,
      participation: participationForWeek(own, lectureIds.length),
    };
  });

  return { weekId, lectures: lectureRows, students };
}

/**
 * Mark attendance and immediately refresh that week's participation.
 *
 * The write and the roll-up are two statements, not one transaction: the roll-up
 * is derived data that can be recomputed from the attendance rows at any time,
 * so wrapping them together would only widen the lock for no integrity gain.
 */
export async function recordAttendanceAndSync(
  input: RecordAttendanceInput & { weekId: number },
): Promise<{ row: AttendanceRow; participation: ParticipationResult }> {
  const row = await recordAttendance(input);
  const participation = await syncWeekParticipation(input.studentId, input.weekId);
  return { row, participation };
}
