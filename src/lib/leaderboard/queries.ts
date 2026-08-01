// =============================================================================
// LEADERBOARD READ MODEL. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// PRIVACY. Every `select()` here lists its columns explicitly. `users.email`,
// `users.passwordHash`, `bio` and the social profile links are never selected —
// a student may read the whole cohort's standings, so the only personal data
// that leaves this module is name + avatar + scores (see ./types.ts).
//
// COHORT SCOPING. A student is pinned to their own cohort; the `cohortId` query
// parameter is ignored for them. Only instructors and admins may choose a
// cohort. `users.role = 'student'` is asserted on every read, so staff never
// appear in a student leaderboard even if a stray leaderboard row exists.
//
// RANKS ON READ. `leaderboard.ranking` is the denormalized column the write path
// maintains, and it is what makes an O(1) "what rank am I" read possible for
// other streams. This module nonetheless re-derives display order through
// `assignRanks` from ./ranking.ts — the same total-order comparator the SQL
// renumber mirrors. Two reasons: a row inserted but not yet renumbered has
// `ranking = null` and would otherwise render blank, and deriving both the table
// and the "you are Nth of M" line from one comparator makes it impossible for
// them to disagree.
//
// PER-WEEK BOARDS are computed on read, not denormalized. The frozen
// `leaderboard` table has no per-week columns and the schema may not be edited
// from a feature stream, so the weekly view reads `progress.overallScore` (the
// progress stream's aggregated week score) and ranks it with the same
// comparator. At 50-80 students per cohort this is one small query, not a
// denormalization candidate.
//
// All durations are milliseconds (house rule 5).
// =============================================================================

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  assignments,
  cohorts,
  leaderboard,
  progress,
  submissions,
  users,
  weeks,
} from "@/db/schema";
import { courseMaxScore, letterGrade } from "@/lib/contracts/scoring";
import type { AuthUser } from "@/lib/guard";
import { assignRanks, type RankableRow } from "./ranking";
import {
  defaultDirectionFor,
  sortEntries,
  sortWeeklyEntries,
} from "./sorting";
import type {
  LeaderboardCohortOption,
  LeaderboardEntry,
  LeaderboardScope,
  LeaderboardSortKey,
  LeaderboardView,
  LeaderboardWeekOption,
  MyStanding,
  SortDirection,
  WeeklyLeaderboardEntry,
} from "./types";

export interface LeaderboardQuery {
  scope: LeaderboardScope;
  /** Ignored for students — they always see their own cohort. */
  cohortId: number | null;
  weekId: number | null;
  sort: LeaderboardSortKey;
  direction: SortDirection | null;
}

/** Staff are not cohort-scoped, so only they may pick a cohort. */
function isStaff(viewer: AuthUser): boolean {
  return viewer.role === "instructor" || viewer.role === "admin";
}

/**
 * `cohort_id IS NULL` vs `cohort_id = n`. Plain equality never matches NULL in
 * SQL, so an unassigned student's rows would silently vanish from every board.
 *
 * `PgColumn` rather than `typeof leaderboard.cohortId`: the same predicate is
 * applied to `leaderboard.cohort_id` (overall board) and `users.cohort_id`
 * (weekly board), and drizzle bakes the table name into the column type.
 */
function cohortPredicate(column: PgColumn, cohortId: number | null) {
  return cohortId === null ? isNull(column) : eq(column, cohortId);
}

// ---------------------------------------------------------------------------
// Submission-derived tie-break inputs
// ---------------------------------------------------------------------------

interface StudentSubmissionStats {
  avgStars: number | null;
  firstSubmittedAtMs: number | null;
}

/**
 * Average instructor stars and earliest submission time per student — tie-break
 * keys 2 and 4 (see the rule in ./ranking.ts).
 *
 * `assignmentWeekId` restricts the aggregate to one week's assignments, which is
 * what the per-week board wants; omit it for the course-wide board.
 */
async function fetchSubmissionStats(
  studentIds: readonly number[],
  assignmentWeekId?: number,
): Promise<Map<number, StudentSubmissionStats>> {
  const stats = new Map<number, StudentSubmissionStats>();
  if (studentIds.length === 0) return stats;

  const base = db
    .select({
      studentId: submissions.studentId,
      // ::float8 — `avg()` on an integer column returns numeric, which
      // node-postgres hands back as a STRING to preserve precision. Casting in
      // SQL is cheaper than remembering to Number() it at three call sites.
      avgStars: sql<number | null>`avg(${submissions.instructorRating})::float8`,
      firstSubmittedAt: sql<Date | null>`min(${submissions.submittedAt})`,
    })
    .from(submissions);

  const rows = await (assignmentWeekId === undefined
    ? base
        .where(inArray(submissions.studentId, [...studentIds]))
        .groupBy(submissions.studentId)
    : base
        .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
        .where(
          and(
            inArray(submissions.studentId, [...studentIds]),
            eq(assignments.weekId, assignmentWeekId),
          ),
        )
        .groupBy(submissions.studentId));

  for (const row of rows) {
    stats.set(row.studentId, {
      avgStars: row.avgStars === null ? null : Number(row.avgStars),
      firstSubmittedAtMs: row.firstSubmittedAt
        ? new Date(row.firstSubmittedAt).getTime()
        : null,
    });
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

async function fetchWeekOptions(): Promise<LeaderboardWeekOption[]> {
  const rows = await db
    .select({ weekId: weeks.id, weekNumber: weeks.weekNumber, title: weeks.title })
    .from(weeks)
    .orderBy(weeks.weekNumber);
  return rows;
}

async function fetchCohortOptions(viewer: AuthUser): Promise<LeaderboardCohortOption[]> {
  // A student has no cohort picker: showing them the list of other cohorts is
  // both useless and a small information leak about the organisation's roster.
  if (!isStaff(viewer)) return [];
  const rows = await db
    .select({ cohortId: cohorts.id, name: cohorts.name })
    .from(cohorts)
    .orderBy(desc(cohorts.startsAt));
  return rows;
}

async function fetchCohortName(cohortId: number | null): Promise<string | null> {
  if (cohortId === null) return null;
  const [row] = await db
    .select({ name: cohorts.name })
    .from(cohorts)
    .where(eq(cohorts.id, cohortId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Which cohort this request is actually about.
 * Students: always their own. Staff: the requested one, else their most recent
 * active cohort, else null (which reads as the unassigned board).
 */
export async function resolveCohortId(
  viewer: AuthUser,
  requested: number | null,
): Promise<number | null> {
  if (!isStaff(viewer)) return viewer.cohortId;
  if (requested !== null && Number.isInteger(requested)) return requested;

  const [row] = await db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(eq(cohorts.isActive, true))
    .orderBy(desc(cohorts.startsAt))
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Overall board
// ---------------------------------------------------------------------------

/**
 * Every ranked student in `cohortId`, in canonical rank order.
 * Returns `[]` for a cohort with no leaderboard rows yet — a fresh cohort is a
 * normal state and the caller renders an empty state, not an error.
 */
export async function getCohortEntries(
  cohortId: number | null,
  currentUserId: number,
): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select({
      studentId: leaderboard.studentId,
      name: users.name,
      avatarUrl: users.avatarUrl,
      totalScore: leaderboard.totalScore,
      quizScore: leaderboard.quizScore,
      assignmentScore: leaderboard.assignmentScore,
      participationScore: leaderboard.participationScore,
      finalProjectScore: leaderboard.finalProjectScore,
    })
    .from(leaderboard)
    .innerJoin(users, eq(users.id, leaderboard.studentId))
    .where(
      and(
        cohortPredicate(leaderboard.cohortId, cohortId),
        // Second barrier: the renumber pass also filters on this.
        eq(users.role, "student"),
      ),
    );

  if (rows.length === 0) return [];

  const stats = await fetchSubmissionStats(rows.map((r) => r.studentId));
  const maxScore = courseMaxScore();

  const rankable = rows.map((row) => ({
    ...row,
    avgStars: stats.get(row.studentId)?.avgStars ?? null,
    firstSubmittedAtMs: stats.get(row.studentId)?.firstSubmittedAtMs ?? null,
  }));

  return assignRanks(rankable).map((row) => ({
    studentId: row.studentId,
    name: row.name,
    avatarUrl: row.avatarUrl,
    totalScore: row.totalScore,
    quizScore: row.quizScore,
    assignmentScore: row.assignmentScore,
    participationScore: row.participationScore,
    finalProjectScore: row.finalProjectScore,
    ranking: row.ranking,
    avgStars: row.avgStars,
    letterGrade: letterGrade(row.totalScore, maxScore),
    isCurrentUser: row.studentId === currentUserId,
  }));
}

// ---------------------------------------------------------------------------
// Per-week board
// ---------------------------------------------------------------------------

/**
 * The cohort ranked by one week's score.
 *
 * Driven from `users` LEFT JOIN `progress`, not from `progress` alone: a student
 * with no progress row for the week must still appear (at 0) rather than vanish
 * from the standings, which is what an inner join would do for the whole cohort
 * in week 1 before anyone has opened a lecture.
 */
export async function getWeeklyEntries(
  cohortId: number | null,
  weekId: number,
  currentUserId: number,
): Promise<WeeklyLeaderboardEntry[]> {
  const rows = await db
    .select({
      studentId: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      weekScore: progress.overallScore,
      lecturesCompleted: progress.lecturesCompleted,
      quizCompleted: progress.quizCompleted,
      assignmentCompleted: progress.assignmentCompleted,
    })
    .from(users)
    .leftJoin(
      progress,
      and(eq(progress.studentId, users.id), eq(progress.weekId, weekId)),
    )
    .where(and(cohortPredicate(users.cohortId, cohortId), eq(users.role, "student")));

  if (rows.length === 0) return [];

  const stats = await fetchSubmissionStats(
    rows.map((r) => r.studentId),
    weekId,
  );

  const rankable = rows.map((row) => ({
    ...row,
    weekScore: row.weekScore ?? 0,
    lecturesCompleted: row.lecturesCompleted ?? 0,
    quizCompleted: row.quizCompleted ?? false,
    assignmentCompleted: row.assignmentCompleted ?? false,
    avgStars: stats.get(row.studentId)?.avgStars ?? null,
    firstSubmittedAtMs: stats.get(row.studentId)?.firstSubmittedAtMs ?? null,
  }));

  // Weekly boards have no final-project component, so tie-break key 3 is a
  // constant here and the order falls through to earliest submission, then id.
  const ranked = assignRanks(
    rankable.map<RankableRow & (typeof rankable)[number]>((row) => ({
      ...row,
      totalScore: row.weekScore,
      finalProjectScore: 0,
    })),
  );

  return ranked.map((row) => ({
    studentId: row.studentId,
    name: row.name,
    avatarUrl: row.avatarUrl,
    ranking: row.ranking,
    weekScore: row.weekScore,
    avgStars: row.avgStars,
    lecturesCompleted: row.lecturesCompleted,
    quizCompleted: row.quizCompleted,
    assignmentCompleted: row.assignmentCompleted,
    isCurrentUser: row.studentId === currentUserId,
  }));
}

// ---------------------------------------------------------------------------
// Composed view (used by the page and by GET /api/leaderboard)
// ---------------------------------------------------------------------------

export async function getLeaderboardView(
  viewer: AuthUser,
  query: LeaderboardQuery,
): Promise<LeaderboardView> {
  const cohortId = await resolveCohortId(viewer, query.cohortId);
  const direction = query.direction ?? defaultDirectionFor(query.sort);

  const [weekOptions, cohortOptions, cohortName, entries] = await Promise.all([
    fetchWeekOptions(),
    fetchCohortOptions(viewer),
    fetchCohortName(cohortId),
    getCohortEntries(cohortId, viewer.id),
  ]);

  // Default the week tab to week 1 rather than erroring on a missing weekId.
  const weekId =
    query.scope === "week"
      ? (query.weekId ?? weekOptions[0]?.weekId ?? null)
      : null;

  const weeklyEntries =
    query.scope === "week" && weekId !== null
      ? await getWeeklyEntries(cohortId, weekId, viewer.id)
      : [];

  const mine = entries.find((e) => e.isCurrentUser) ?? null;

  return {
    scope: query.scope,
    cohortId,
    cohortName,
    weekId,
    sort: query.sort,
    direction,
    maxScore: courseMaxScore(),
    entries: sortEntries(entries, query.sort, direction),
    weeklyEntries: sortWeeklyEntries(weeklyEntries, query.sort, direction),
    weeks: weekOptions,
    cohorts: cohortOptions,
    studentCount: entries.length,
    me: mine
      ? {
          studentId: mine.studentId,
          name: mine.name,
          cohortId,
          cohortName,
          ranking: mine.ranking,
          studentCount: entries.length,
          totalScore: mine.totalScore,
          maxScore: courseMaxScore(),
          letterGrade: mine.letterGrade,
          avgStars: mine.avgStars,
          quizScore: mine.quizScore,
          assignmentScore: mine.assignmentScore,
          participationScore: mine.participationScore,
          finalProjectScore: mine.finalProjectScore,
          staleForMs: null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/leaderboard/me
// ---------------------------------------------------------------------------

/**
 * The viewer's own standing.
 *
 * Derived from the same `getCohortEntries` path as the table, so the rank shown
 * here can never contradict the rank shown on the board. `staleForMs` reports
 * how long ago the denormalized row was last rebuilt, in milliseconds — useful
 * for spotting a rebuild that silently stopped firing.
 *
 * Returns null when the viewer has no leaderboard row: staff always, and a
 * student who has not been graded yet. Callers render "not ranked yet", never a
 * zeroed row that looks like a real last place.
 */
export async function getMyStanding(viewer: AuthUser): Promise<MyStanding | null> {
  const cohortId = viewer.cohortId;
  const [entries, cohortName, freshness] = await Promise.all([
    getCohortEntries(cohortId, viewer.id),
    fetchCohortName(cohortId),
    db
      .select({ updatedAt: leaderboard.updatedAt })
      .from(leaderboard)
      .where(eq(leaderboard.studentId, viewer.id))
      .limit(1),
  ]);

  const mine = entries.find((e) => e.studentId === viewer.id);
  if (!mine) return null;

  const updatedAt = freshness[0]?.updatedAt;

  return {
    studentId: mine.studentId,
    name: mine.name,
    cohortId,
    cohortName,
    ranking: mine.ranking,
    studentCount: entries.length,
    totalScore: mine.totalScore,
    maxScore: courseMaxScore(),
    letterGrade: mine.letterGrade,
    avgStars: mine.avgStars,
    quizScore: mine.quizScore,
    assignmentScore: mine.assignmentScore,
    participationScore: mine.participationScore,
    finalProjectScore: mine.finalProjectScore,
    staleForMs: updatedAt ? Date.now() - new Date(updatedAt).getTime() : null,
  };
}
