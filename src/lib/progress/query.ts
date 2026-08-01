// =============================================================================
// PROGRESS AGGREGATE QUERY — one round trip, no N+1.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// WHY ONE STATEMENT
// The obvious implementation is "fetch the weeks, then for each week fetch its
// lectures, quiz attempts and submissions". At 4 weeks x 50-80 students that is
// fast enough to look fine in development and it is still the wrong shape: the
// dashboard is the first page every student loads, the week count is configurable
// (appConfig.course.durationWeeks), and a per-week query inside a loop is 1 + 4n
// round trips over the network to Neon. This module issues exactly ONE statement
// and returns one row per week, already aggregated.
//
// WHY RAW SQL RATHER THAN THE DRIZZLE QUERY BUILDER
// The aggregation needs: a per-quiz best attempt (a group-wise maximum), a
// per-assignment best submission (DISTINCT ON), lecture counts, attendance sums,
// and a JSON side-channel carrying the per-assignment rows that the scoring
// contract has to see in JavaScript. Expressing that in the typed builder costs
// more legibility than the type safety buys back. The trade-off is stated
// plainly (house rule 7): this file must be revisited if src/db/schema.ts renames
// a column. Every column it touches is named in the comments below.
//
// SCORING IS NOT DONE HERE. SQL returns facts; `score.ts` turns them into points
// via the scoring contract. Points arithmetic in SQL would be a second
// implementation of scoring.ts, which is exactly what the contract forbids.
// =============================================================================

import { sql } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { appConfig } from "@/lib/config/app.config";

/** One assignment of a week plus the student's best submission for it. */
export type AssignmentAggregate = {
  assignmentId: number;
  /** ISO-8601 UTC string as returned by json_build_object. */
  dueAt: string;
  latePenaltyPercentPerDay: number;
  /** Null when this student has no submission for the assignment. */
  submittedAt: string | null;
  status: string | null;
  /** Instructor star rating 1..5, null when unrated. */
  stars: number | null;
  isLate: boolean | null;
};

/** One row per week of the student's course, everything already aggregated. */
export type WeekAggregateRow = {
  weekId: number;
  weekNumber: number;
  title: string;
  /** Week deadline from `weeks.dueAt`; null when not scheduled yet. */
  dueAt: Date | null;
  lectureTotal: number;
  lecturesCompleted: number;
  /** Best quiz percentage for the week, null when never attempted. */
  quizBestPercent: number | null;
  quizCount: number;
  attemptedQuizCount: number;
  attemptCount: number;
  /** Mirrors `progress.quizCompleted`, written by the quizzes stream. */
  quizCompletedFlag: boolean;
  assignmentCount: number;
  submittedAssignmentCount: number;
  gradedAssignmentCount: number;
  /** Mirrors `progress.assignmentCompleted`, written by the submissions stream. */
  assignmentCompletedFlag: boolean;
  assignments: AssignmentAggregate[];
  participationPointsRaw: number;
};

/**
 * Shape of a raw row coming back from pg. Numerics arrive as strings unless cast,
 * so every numeric expression in the statement below is cast to int/float8 and
 * still defensively coerced here.
 */
type RawRow = Record<string, unknown>;

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function toAssignments(value: unknown): AssignmentAggregate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      assignmentId: toInt(a.assignmentId),
      dueAt: String(a.dueAt ?? ""),
      latePenaltyPercentPerDay: toInt(a.latePenaltyPercentPerDay),
      submittedAt: a.submittedAt == null ? null : String(a.submittedAt),
      status: a.status == null ? null : String(a.status),
      stars: toNumberOrNull(a.stars),
      isLate: a.isLate == null ? null : toBool(a.isLate),
    }));
}

/**
 * Fetch one aggregated row per week for `studentId`, ordered by week number
 * ascending. Read-only: this stream never writes progress (quizzes and
 * submissions own the writes).
 *
 * COURSE RESOLUTION CAVEAT: `src/db/schema.ts` has no cohort -> course link, so
 * "the student's course" cannot be derived from `users.cohortId`. The course
 * whose title matches `appConfig.course.title` is preferred, falling back to the
 * lowest course id. With the single-course curriculum this app ships that is
 * exact. It becomes wrong the day a second course exists.
 * TODO(shared-contracts): a `cohorts.courseId` (or `enrolments`) column would
 * make this deterministic. Flagged rather than worked around — the schema is the
 * frozen seam and this stream must not edit it.
 */
// MEMOISED PER REQUEST (React `cache`). This one statement is the most-repeated
// read in the app: `getWeekProgress` and `getWeekProgressDetail` both call it,
// and `getWeekList` -> `deriveWeekLockStates` pulls it in on every gated page —
// so /weeks/:id was paying for it twice and the dashboard-plus-gate paths three
// times. At ~250 ms per Neon round trip that is a quarter-second of pure waste
// per duplicate. The memo key is `studentId` and its lifetime is one request, so
// no student can observe another's rows and a submitted quiz is visible on the
// very next request. It is NOT a cross-request cache — progress must never be
// stale, which is why `unstable_cache` is deliberately not used here.
export const fetchWeekAggregates = cache(async function fetchWeekAggregates(
  studentId: number,
): Promise<WeekAggregateRow[]> {
  // A non-positive id can only come from a broken session; short-circuit rather
  // than issuing a query that can never match.
  if (!Number.isInteger(studentId) || studentId <= 0) return [];

  const courseTitle = appConfig.course.title;

  const result = await db.execute(sql`
    WITH picked_course AS (
      SELECT c.id
      FROM courses c
      ORDER BY (c.title = ${courseTitle}) DESC, c.id ASC
      LIMIT 1
    ),
    wk AS (
      SELECT w.id, w.week_number, w.title, w.due_at
      FROM weeks w
      JOIN picked_course pc ON w.course_id = pc.id
    ),
    -- lectures.weekId -> how many lectures the week has (the lectureTotal the
    -- read-model docstring promises, so no caller needs a second query).
    lect AS (
      SELECT l.week_id, COUNT(*)::int AS lecture_total
      FROM lectures l
      JOIN wk ON l.week_id = wk.id
      GROUP BY l.week_id
    ),
    -- BEST attempt per quiz (not latest). in_progress attempts are excluded:
    -- an abandoned attempt is not a result.
    --
    -- PRACTICE QUIZZES ONLY. The q.kind = 'practice' predicate below is
    -- load-bearing, not tidying.
    -- (No backticks anywhere in this comment: they would close the sql template.)
    -- The add-on wave introduced two more kinds into this same table, and without
    -- this filter both corrupt the weekly percentage that drives WEEK UNLOCK:
    --
    --   * 'grand' (the 50-question exam). quiz_week below averages the per-quiz
    --     bests, so a student who scored 100% on the practice quiz and 60% on the
    --     exam would show 80% for the week. Because src/lib/progress/unlock.ts
    --     deliberately DERIVES unlock rather than reading the stored
    --     progress.week_unlocked flag, that average dropping below the threshold
    --     would RE-LOCK a week the student had already earned — and sitting an
    --     exam you cannot retake would be the thing that took it away.
    --   * 'realtime' (inline lecture checks). Ungraded by design, unlimited
    --     attempts, no marks anywhere. Counting them would let a throwaway
    --     knowledge check move a student's week score.
    --
    -- Both kinds are scored and surfaced by their own streams. This read model is
    -- the unlock gate, and the unlock gate is about the practice quiz — which is
    -- exactly the behaviour the existing four weeks already have, and which must
    -- not change under them.
    best_per_quiz AS (
      SELECT q.week_id,
             q.id AS quiz_id,
             MAX(a.percentage)::float8 AS best_percent,
             COUNT(a.id)::int AS attempt_count
      FROM quizzes q
      JOIN wk ON q.week_id = wk.id
      LEFT JOIN quiz_attempts a
             ON a.quiz_id = q.id
            AND a.student_id = ${studentId}
            AND a.status IN ('submitted', 'graded')
      WHERE q.kind = 'practice'
      GROUP BY q.week_id, q.id
    ),
    -- A week normally has one quiz. With several, the week's percentage is the
    -- mean of the per-quiz bests so the unlock gate stays a single percentage.
    quiz_week AS (
      SELECT week_id,
             AVG(best_percent)::float8 AS best_percent,
             COUNT(*)::int AS quiz_count,
             COUNT(best_percent)::int AS attempted_quiz_count,
             COALESCE(SUM(attempt_count), 0)::int AS attempt_count
      FROM best_per_quiz
      GROUP BY week_id
    ),
    asg AS (
      SELECT a.id, a.week_id, a.due_at, a.late_penalty_percent_per_day
      FROM assignments a
      JOIN wk ON a.week_id = wk.id
    ),
    -- BEST submission per assignment: graded beats ungraded, then highest score,
    -- then most recent. Mirrors "best attempt, not latest" on the quiz side.
    best_sub AS (
      SELECT DISTINCT ON (s.assignment_id)
             s.assignment_id, s.submitted_at, s.status, s.score,
             s.instructor_rating, s.is_late
      FROM submissions s
      JOIN asg ON s.assignment_id = asg.id
      WHERE s.student_id = ${studentId}
      ORDER BY s.assignment_id,
               (s.status = 'graded') DESC,
               s.score DESC NULLS LAST,
               s.submitted_at DESC
    ),
    -- The JSON side-channel: scoring.assignmentPoints() must run in JS, so the
    -- per-assignment facts travel out rather than being scored in SQL.
    asg_week AS (
      SELECT asg.week_id,
             COUNT(*)::int AS assignment_count,
             COUNT(bs.assignment_id)::int AS submitted_count,
             -- Parenthesised before the cast: an aggregate with a FILTER clause
             -- followed directly by ::int is easy to misread, and the explicit
             -- grouping removes any doubt about what the cast applies to.
             -- NOTE: no backticks in this template literal -- they would close it.
             (COUNT(*) FILTER (WHERE bs.status = 'graded'))::int AS graded_count,
             COALESCE(
               json_agg(
                 json_build_object(
                   'assignmentId', asg.id,
                   'dueAt', asg.due_at,
                   'latePenaltyPercentPerDay', asg.late_penalty_percent_per_day,
                   'submittedAt', bs.submitted_at,
                   'status', bs.status,
                   'stars', bs.instructor_rating,
                   'isLate', bs.is_late
                 )
                 ORDER BY asg.id
               ),
               '[]'::json
             ) AS assignments
      FROM asg
      LEFT JOIN best_sub bs ON bs.assignment_id = asg.id
      GROUP BY asg.week_id
    ),
    part AS (
      SELECT l.week_id,
             COALESCE(SUM(att.participation_score), 0)::int AS participation_points,
             (COUNT(att.id) FILTER (WHERE att.attended))::int AS attended_count
      FROM lectures l
      JOIN wk ON l.week_id = wk.id
      LEFT JOIN attendance att
             ON att.lecture_id = l.id
            AND att.student_id = ${studentId}
      GROUP BY l.week_id
    ),
    prog AS (
      SELECT p.week_id, p.lectures_completed, p.quiz_completed, p.assignment_completed
      FROM progress p
      JOIN wk ON p.week_id = wk.id
      WHERE p.student_id = ${studentId}
    )
    SELECT
      wk.id                                    AS "weekId",
      wk.week_number                            AS "weekNumber",
      wk.title                                  AS "title",
      wk.due_at                                 AS "dueAt",
      COALESCE(lect.lecture_total, 0)           AS "lectureTotal",
      -- Two sources record "watched a lecture": the progress row (course-content
      -- stream) and attendance (penalties-attendance stream). Take the higher and
      -- cap at the number of lectures that exist, so "5 of 3 lectures" is
      -- impossible however the writers drift.
      LEAST(
        GREATEST(COALESCE(prog.lectures_completed, 0), COALESCE(part.attended_count, 0)),
        COALESCE(lect.lecture_total, 0)
      )                                         AS "lecturesCompleted",
      quiz_week.best_percent                    AS "quizBestPercent",
      COALESCE(quiz_week.quiz_count, 0)         AS "quizCount",
      COALESCE(quiz_week.attempted_quiz_count, 0) AS "attemptedQuizCount",
      COALESCE(quiz_week.attempt_count, 0)      AS "attemptCount",
      COALESCE(prog.quiz_completed, false)      AS "quizCompletedFlag",
      COALESCE(asg_week.assignment_count, 0)    AS "assignmentCount",
      COALESCE(asg_week.submitted_count, 0)     AS "submittedAssignmentCount",
      COALESCE(asg_week.graded_count, 0)        AS "gradedAssignmentCount",
      COALESCE(prog.assignment_completed, false) AS "assignmentCompletedFlag",
      COALESCE(asg_week.assignments, '[]'::json) AS "assignments",
      COALESCE(part.participation_points, 0)    AS "participationPointsRaw"
    FROM wk
    LEFT JOIN lect      ON lect.week_id = wk.id
    LEFT JOIN quiz_week ON quiz_week.week_id = wk.id
    LEFT JOIN asg_week  ON asg_week.week_id = wk.id
    LEFT JOIN part      ON part.week_id = wk.id
    LEFT JOIN prog      ON prog.week_id = wk.id
    ORDER BY wk.week_number ASC
  `);

  // drizzle/node-postgres returns a pg QueryResult; drizzle/neon-http returns the
  // rows directly. Handle both so a future driver swap in src/db/index.ts does
  // not silently yield an empty dashboard.
  const rows: RawRow[] = Array.isArray(result)
    ? (result as RawRow[])
    : ((result as { rows?: RawRow[] }).rows ?? []);

  return rows.map((r) => ({
    weekId: toInt(r.weekId),
    weekNumber: toInt(r.weekNumber),
    title: String(r.title ?? ""),
    dueAt: toDateOrNull(r.dueAt),
    lectureTotal: toInt(r.lectureTotal),
    lecturesCompleted: toInt(r.lecturesCompleted),
    quizBestPercent: toNumberOrNull(r.quizBestPercent),
    quizCount: toInt(r.quizCount),
    attemptedQuizCount: toInt(r.attemptedQuizCount),
    attemptCount: toInt(r.attemptCount),
    quizCompletedFlag: toBool(r.quizCompletedFlag),
    assignmentCount: toInt(r.assignmentCount),
    submittedAssignmentCount: toInt(r.submittedAssignmentCount),
    gradedAssignmentCount: toInt(r.gradedAssignmentCount),
    assignmentCompletedFlag: toBool(r.assignmentCompletedFlag),
    assignments: toAssignments(r.assignments),
    participationPointsRaw: toInt(r.participationPointsRaw),
  }));
});
