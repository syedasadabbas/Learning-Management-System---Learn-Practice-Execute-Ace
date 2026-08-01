// =============================================================================
// STUDENT MANAGEMENT READ MODEL — instructor-admin stream.
// -----------------------------------------------------------------------------
// NO PASSWORD HASHES, EVER. `users.passwordHash` is `notNull`, so every row
// Drizzle hands back from a `select().from(users)` carries a live bcrypt hash.
// This file therefore never does that: `STUDENT_COLUMNS` below is the single
// projection used by the listing, the detail view AND the CSV export, so there is
// one place to audit rather than three.
//
// Per-student progress comes from `getWeekProgress` in
// `@/lib/progress/read-model` (progress-tracking's contract). This stream does
// not recompute unlock state or week scores — a second implementation would drift
// from the student's own dashboard, and "the instructor sees a different number
// than the student" is the bug that follows.
// =============================================================================

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  attendance,
  cohorts,
  lectures,
  penalties,
  penaltySeverity,
  penaltyType,
  users,
  weeks,
} from "@/db/schema";
import type { WeekProgress } from "@/lib/contracts/events";
import { getWeekProgress } from "@/lib/progress/read-model";

export type PenaltyType = (typeof penaltyType.enumValues)[number];
export type PenaltySeverity = (typeof penaltySeverity.enumValues)[number];

/**
 * The ONLY user projection this stream uses. Deliberately explicit and
 * deliberately shared: `passwordHash` is absent by construction, not by
 * remembering to delete it before serialising.
 */
export const STUDENT_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  cohortId: users.cohortId,
  avatarUrl: users.avatarUrl,
  githubProfile: users.githubProfile,
  linkedinProfile: users.linkedinProfile,
  createdAt: users.createdAt,
} as const;

export interface StudentSummary {
  id: number;
  name: string;
  email: string;
  cohortId: number | null;
  cohortName: string | null;
  avatarUrl: string | null;
  /** Unresolved penalties. >= 3 is the at-risk threshold. */
  openPenaltyCount: number;
  penaltyPoints: number;
  /** Leaderboard total, 0 when the student has no row yet. */
  totalScore: number;
  submissionCount: number;
  gradedSubmissionCount: number;
  lateSubmissionCount: number;
  attendedLectureCount: number;
}

export interface PenaltyRecord {
  id: number;
  type: PenaltyType;
  severity: PenaltySeverity;
  description: string | null;
  penaltyPoints: number;
  resolved: boolean;
  issuedAt: Date;
  issuedByName: string | null;
}

export interface AttendanceRecord {
  lectureId: number;
  lectureTitle: string;
  weekNumber: number;
  attended: boolean;
  participationScore: number;
  recordedAt: Date;
}

export interface StudentDetail {
  id: number;
  name: string;
  email: string;
  cohortId: number | null;
  cohortName: string | null;
  avatarUrl: string | null;
  githubProfile: string | null;
  linkedinProfile: string | null;
  createdAt: Date;
  weekProgress: WeekProgress[];
  penalties: PenaltyRecord[];
  attendance: AttendanceRecord[];
  attendedCount: number;
  lectureTotal: number;
}

/**
 * Students with their headline counters. Every counter is a SQL scalar
 * subquery — one round trip for the whole roster, not one per student.
 */
export async function listStudents(cohortId?: number): Promise<StudentSummary[]> {
  const conditions = [eq(users.role, "student")];
  if (cohortId !== undefined) conditions.push(eq(users.cohortId, cohortId));

  const rows = await db
    .select({
      id: STUDENT_COLUMNS.id,
      name: STUDENT_COLUMNS.name,
      email: STUDENT_COLUMNS.email,
      cohortId: STUDENT_COLUMNS.cohortId,
      avatarUrl: STUDENT_COLUMNS.avatarUrl,
      cohortName: cohorts.name,
      openPenaltyCount: sql<number>`(
        SELECT COUNT(*)::int FROM penalties p
        WHERE p.student_id = ${users.id} AND p.resolved = false
      )`,
      penaltyPoints: sql<number>`(
        SELECT COALESCE(SUM(p.penalty_points), 0)::int FROM penalties p
        WHERE p.student_id = ${users.id} AND p.resolved = false
      )`,
      totalScore: sql<number>`(
        SELECT COALESCE(MAX(l.total_score), 0)::int FROM leaderboard l
        WHERE l.student_id = ${users.id}
      )`,
      submissionCount: sql<number>`(
        SELECT COUNT(*)::int FROM submissions s WHERE s.student_id = ${users.id}
      )`,
      gradedSubmissionCount: sql<number>`(
        SELECT COUNT(*)::int FROM submissions s
        WHERE s.student_id = ${users.id} AND s.status = 'graded'
      )`,
      lateSubmissionCount: sql<number>`(
        SELECT COUNT(*)::int FROM submissions s
        WHERE s.student_id = ${users.id} AND s.is_late = true
      )`,
      attendedLectureCount: sql<number>`(
        SELECT COUNT(*)::int FROM attendance a
        WHERE a.student_id = ${users.id} AND a.attended = true
      )`,
    })
    .from(users)
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(and(...conditions))
    .orderBy(asc(users.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    cohortId: r.cohortId,
    cohortName: r.cohortName ?? null,
    avatarUrl: r.avatarUrl,
    openPenaltyCount: Number(r.openPenaltyCount) || 0,
    penaltyPoints: Number(r.penaltyPoints) || 0,
    totalScore: Number(r.totalScore) || 0,
    submissionCount: Number(r.submissionCount) || 0,
    gradedSubmissionCount: Number(r.gradedSubmissionCount) || 0,
    lateSubmissionCount: Number(r.lateSubmissionCount) || 0,
    attendedLectureCount: Number(r.attendedLectureCount) || 0,
  }));
}

/** Penalty history for one student, newest first. */
export async function getStudentPenalties(studentId: number): Promise<PenaltyRecord[]> {
  const rows = await db
    .select({
      id: penalties.id,
      type: penalties.type,
      severity: penalties.severity,
      description: penalties.description,
      penaltyPoints: penalties.penaltyPoints,
      resolved: penalties.resolved,
      issuedAt: penalties.issuedAt,
      // Self-join on users for the issuer's NAME only.
      issuedByName: sql<string | null>`(
        SELECT iu.name FROM users iu WHERE iu.id = ${penalties.issuedBy}
      )`,
    })
    .from(penalties)
    .where(eq(penalties.studentId, studentId))
    .orderBy(desc(penalties.issuedAt));

  return rows.map((r) => ({ ...r, issuedByName: r.issuedByName ?? null }));
}

/** Attendance per lecture for one student, in course order. */
export async function getStudentAttendance(
  studentId: number,
): Promise<AttendanceRecord[]> {
  return db
    .select({
      lectureId: lectures.id,
      lectureTitle: lectures.title,
      weekNumber: weeks.weekNumber,
      attended: attendance.attended,
      participationScore: attendance.participationScore,
      recordedAt: attendance.recordedAt,
    })
    .from(attendance)
    .innerJoin(lectures, eq(attendance.lectureId, lectures.id))
    .innerJoin(weeks, eq(lectures.weekId, weeks.id))
    .where(eq(attendance.studentId, studentId))
    .orderBy(asc(weeks.weekNumber), asc(lectures.lectureNumber));
}

/** Full student record for the detail drawer. Never includes the hash. */
export async function getStudentDetail(
  studentId: number,
): Promise<StudentDetail | null> {
  const [row] = await db
    .select({ ...STUDENT_COLUMNS, cohortName: cohorts.name })
    .from(users)
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(eq(users.id, studentId))
    .limit(1);

  if (!row) return null;

  const [weekProgress, penaltyRows, attendanceRows, lectureTotal] = await Promise.all([
    // progress-tracking's read model. Returns [] while that stream is a stub —
    // the UI must render an empty progress list without complaining.
    getWeekProgress(studentId),
    getStudentPenalties(studentId),
    getStudentAttendance(studentId),
    countLectures(),
  ]);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    cohortId: row.cohortId,
    cohortName: row.cohortName ?? null,
    avatarUrl: row.avatarUrl,
    githubProfile: row.githubProfile,
    linkedinProfile: row.linkedinProfile,
    createdAt: row.createdAt,
    weekProgress,
    penalties: penaltyRows,
    attendance: attendanceRows,
    attendedCount: attendanceRows.filter((a) => a.attended).length,
    lectureTotal,
  };
}

async function countLectures(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(lectures);
  return Number(row?.n ?? 0);
}
