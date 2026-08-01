// =============================================================================
// COHORT ANALYTICS — instructor-admin stream.
// -----------------------------------------------------------------------------
// AGGREGATION HAPPENS IN POSTGRES. Every figure below comes back pre-reduced;
// nothing here fetches a row per student and folds it in Node. At 50-80 students
// either approach "works", which is exactly why the wrong one gets written and
// then discovered at 800.
//
// ZERO DENOMINATORS ARE THE NORMAL FIRST STATE. On a fresh install nobody has
// attempted a quiz and nothing has been ingested (both Google Form URLs are null
// in the seed), so every rate divides by zero. `rate()` returns null in that
// case and `formatRate()` renders "no data" — never NaN%, never Infinity, never
// a thrown error. That is a hard requirement of this stream, tested in
// analytics.test.ts.
// =============================================================================

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  aggregateRate,
  QUIZ_BUCKETS,
  rate,
  toNumberOrNull,
  type Rate,
} from "./rates";

// ---------------------------------------------------------------------------
// Pure rate helpers — implemented in ./rates.ts (no database import, so they are
// unit-testable) and re-exported so callers have one import site.
// ---------------------------------------------------------------------------

export {
  rate,
  formatRate,
  formatAverage,
  toNumberOrNull,
  aggregateRate,
  NO_DATA_LABEL,
  QUIZ_BUCKETS,
  type Rate,
} from "./rates";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface WeekAnalytics {
  weekId: number;
  weekNumber: number;
  title: string;
  dueAt: Date | null;
  studentCount: number;
  quizAttemptedCount: number;
  quizPassedCount: number;
  /** Passed / attempted. `percent: null` when nobody has attempted. */
  quizPassRate: Rate;
  quizAvgBestPercent: number | null;
  submissionCount: number;
  gradedCount: number;
  lateCount: number;
  /** Submissions / enrolled students. */
  submissionRate: Rate;
  /** Graded / submitted. */
  gradedRate: Rate;
  /** Students with quiz AND assignment done / enrolled students. */
  completionRate: Rate;
  avgStars: number | null;
  avgAssignmentScore: number | null;
}

export interface ScoreBucket {
  label: string;
  /** Inclusive lower bound, exclusive upper (upper 100 is inclusive). */
  from: number;
  to: number;
  count: number;
}

export interface AtRiskStudent {
  studentId: number;
  name: string;
  penaltyCount: number;
  penaltyPoints: number;
}

export interface CohortAnalytics {
  cohortId: number | null;
  studentCount: number;
  weeks: WeekAnalytics[];
  /** Distribution of each student's best quiz percentage, cohort-wide. */
  quizDistribution: ScoreBucket[];
  /** Cohort-wide pass rate across all quiz attempts (best per student/week). */
  overallQuizPassRate: Rate;
  /** Cohort-wide graded-submission rate. */
  overallSubmissionRate: Rate;
  atRisk: AtRiskStudent[];
  /** Wall-clock cost of the analytics queries, in milliseconds (metric units). */
  computeMs: number;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * Drizzle's node-postgres `execute` returns a pg QueryResult; some versions
 * return the row array directly. Normalise once so the callers below are not
 * written against a driver detail.
 */
async function rows<T>(query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: unknown };
  return Array.isArray(maybe.rows) ? (maybe.rows as T[]) : [];
}

/**
 * The cohort-scoping CTE shared by every query below: the students under
 * consideration. Staff are excluded — an instructor is not part of their own
 * cohort's pass rate.
 */
function cohortStudentsCte(cohortId: number | null): SQL {
  return sql`
    cohort_students AS (
      SELECT u.id, u.cohort_id
      FROM users u
      WHERE u.role = 'student'
        AND (${cohortId ?? null}::int IS NULL OR u.cohort_id = ${cohortId ?? null}::int)
    )`;
}

interface WeekRow {
  week_id: number;
  week_number: number;
  title: string;
  due_at: string | Date | null;
  student_count: number;
  quiz_attempted: number;
  quiz_passed: number;
  quiz_avg_best: number | string | null;
  submission_count: number;
  graded_count: number;
  late_count: number;
  completed_count: number;
  avg_stars: number | string | null;
  avg_score: number | string | null;
}

/**
 * Per-week analytics for a cohort (or the whole platform when cohortId is null).
 *
 * One round trip. `best_attempt` reduces attempts to the best per student per
 * week first, because "pass rate" means "students who passed", not "attempts
 * that passed" — max 3 attempts per quiz would otherwise let one student count
 * three times.
 */
export async function getWeekAnalytics(
  cohortId: number | null = null,
): Promise<WeekAnalytics[]> {
  const query = sql`
    WITH ${cohortStudentsCte(cohortId)},
    best_attempt AS (
      SELECT qa.student_id,
             q.week_id,
             MAX(qa.percentage)::float8 AS best_percent,
             MAX(q.passing_score)       AS passing_score
      FROM quiz_attempts qa
      JOIN quizzes q ON q.id = qa.quiz_id
      JOIN cohort_students cs ON cs.id = qa.student_id
      WHERE q.kind = 'practice'
      GROUP BY qa.student_id, q.week_id
    ),
    quiz_agg AS (
      SELECT week_id,
             COUNT(*)::int AS quiz_attempted,
             COUNT(*) FILTER (WHERE best_percent >= passing_score)::int AS quiz_passed,
             AVG(best_percent)::float8 AS quiz_avg_best
      FROM best_attempt
      GROUP BY week_id
    ),
    sub_agg AS (
      SELECT a.week_id,
             COUNT(*)::int AS submission_count,
             COUNT(*) FILTER (WHERE s.status = 'graded')::int AS graded_count,
             COUNT(*) FILTER (WHERE s.is_late)::int AS late_count,
             AVG(s.instructor_rating)::float8 AS avg_stars,
             AVG(s.score)::float8 AS avg_score
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN cohort_students cs ON cs.id = s.student_id
      GROUP BY a.week_id
    ),
    prog_agg AS (
      SELECT p.week_id,
             COUNT(*) FILTER (WHERE p.quiz_completed AND p.assignment_completed)::int
               AS completed_count
      FROM progress p
      JOIN cohort_students cs ON cs.id = p.student_id
      GROUP BY p.week_id
    ),
    totals AS (SELECT COUNT(*)::int AS student_count FROM cohort_students)
    SELECT w.id                            AS week_id,
           w.week_number                   AS week_number,
           w.title                         AS title,
           w.due_at                        AS due_at,
           t.student_count                 AS student_count,
           COALESCE(qa.quiz_attempted, 0)  AS quiz_attempted,
           COALESCE(qa.quiz_passed, 0)     AS quiz_passed,
           qa.quiz_avg_best                AS quiz_avg_best,
           COALESCE(sa.submission_count,0) AS submission_count,
           COALESCE(sa.graded_count, 0)    AS graded_count,
           COALESCE(sa.late_count, 0)      AS late_count,
           COALESCE(pa.completed_count, 0) AS completed_count,
           sa.avg_stars                    AS avg_stars,
           sa.avg_score                    AS avg_score
    FROM weeks w
    CROSS JOIN totals t
    LEFT JOIN quiz_agg qa ON qa.week_id = w.id
    LEFT JOIN sub_agg  sa ON sa.week_id = w.id
    LEFT JOIN prog_agg pa ON pa.week_id = w.id
    ORDER BY w.week_number ASC`;

  const raw = await rows<WeekRow>(query);
  return raw.map((r) => {
    const studentCount = Number(r.student_count) || 0;
    return {
      weekId: Number(r.week_id),
      weekNumber: Number(r.week_number),
      title: r.title,
      dueAt: r.due_at ? new Date(r.due_at) : null,
      studentCount,
      quizAttemptedCount: Number(r.quiz_attempted) || 0,
      quizPassedCount: Number(r.quiz_passed) || 0,
      quizPassRate: rate(Number(r.quiz_passed) || 0, Number(r.quiz_attempted) || 0),
      quizAvgBestPercent: toNumberOrNull(r.quiz_avg_best),
      submissionCount: Number(r.submission_count) || 0,
      gradedCount: Number(r.graded_count) || 0,
      lateCount: Number(r.late_count) || 0,
      submissionRate: rate(Number(r.submission_count) || 0, studentCount),
      gradedRate: rate(Number(r.graded_count) || 0, Number(r.submission_count) || 0),
      completionRate: rate(Number(r.completed_count) || 0, studentCount),
      avgStars: toNumberOrNull(r.avg_stars),
      avgAssignmentScore: toNumberOrNull(r.avg_score),
    };
  });
}

interface BucketRow {
  bucket: string;
  n: number;
}

/**
 * Distribution of best quiz percentages across the cohort, bucketed in SQL.
 *
 * Returns every bucket, including empty ones: a histogram with missing bars
 * reads as "no students scored 50-59" only if the bar is there and flat.
 */
export async function getQuizDistribution(
  cohortId: number | null = null,
): Promise<ScoreBucket[]> {
  const query = sql`
    WITH ${cohortStudentsCte(cohortId)},
    best_attempt AS (
      SELECT qa.student_id, q.week_id, MAX(qa.percentage)::float8 AS best_percent
      FROM quiz_attempts qa
      JOIN quizzes q ON q.id = qa.quiz_id
      JOIN cohort_students cs ON cs.id = qa.student_id
      WHERE q.kind = 'practice'
      GROUP BY qa.student_id, q.week_id
    )
    SELECT CASE
             WHEN best_percent < 50 THEN '0-49'
             WHEN best_percent < 60 THEN '50-59'
             WHEN best_percent < 70 THEN '60-69'
             WHEN best_percent < 80 THEN '70-79'
             WHEN best_percent < 90 THEN '80-89'
             ELSE '90-100'
           END AS bucket,
           COUNT(*)::int AS n
    FROM best_attempt
    GROUP BY bucket`;

  const counts = new Map<string, number>();
  for (const row of await rows<BucketRow>(query)) {
    counts.set(row.bucket, Number(row.n) || 0);
  }
  return QUIZ_BUCKETS.map((b) => ({ ...b, count: counts.get(b.label) ?? 0 }));
}

interface AtRiskRow {
  student_id: number;
  name: string;
  penalty_count: number;
  penalty_points: number;
}

/**
 * Students carrying three or more unresolved penalties.
 *
 * Explicit column list: `users` holds `password_hash` and this result is
 * serialised straight into an API response.
 *
 * DOES NOT SELECT `u.email`, and that is a fix rather than an oversight. It used
 * to, and `AtRiskList` rendered it — so every at-risk student's address was on
 * the instructor overview, both analytics pages, and in the API response body.
 * The analytics stream caught it and redacted at two of those call sites
 * (src/lib/analytics/privacy.ts), but src/app/(staff)/instructor/page.tsx:85
 * passed the rows through unredacted, which is the trouble with defending a leak
 * downstream: the guard has to be remembered at every call site, forever, and it
 * was already missed at one of three.
 *
 * Nothing needs the address. The list identifies students so an instructor can
 * follow up, and a name plus a link is how every other staff surface here does
 * that. If contacting a student from this list is wanted later, add a link to
 * that student's page rather than putting an address in an aggregate payload.
 */
export async function getAtRiskStudents(
  cohortId: number | null = null,
  threshold = 3,
): Promise<AtRiskStudent[]> {
  const query = sql`
    WITH ${cohortStudentsCte(cohortId)}
    SELECT u.id                          AS student_id,
           u.name                        AS name,
           COUNT(p.id)::int              AS penalty_count,
           COALESCE(SUM(p.penalty_points), 0)::int AS penalty_points
    FROM cohort_students cs
    JOIN users u ON u.id = cs.id
    JOIN penalties p ON p.student_id = u.id AND p.resolved = false
    GROUP BY u.id, u.name
    HAVING COUNT(p.id) >= ${threshold}::int
    ORDER BY penalty_count DESC, penalty_points DESC`;

  return (await rows<AtRiskRow>(query)).map((r) => ({
    studentId: Number(r.student_id),
    name: r.name,
    penaltyCount: Number(r.penalty_count) || 0,
    penaltyPoints: Number(r.penalty_points) || 0,
  }));
}

/**
 * Everything the analytics endpoint and page need, in three round trips.
 *
 * `computeMs` is reported in milliseconds. It is cheap to measure and the first
 * question about an analytics page is always "why is it slow".
 */
export async function getCohortAnalytics(
  cohortId: number | null = null,
): Promise<CohortAnalytics> {
  const startedAt = Date.now();
  const [weeks, quizDistribution, atRisk] = await Promise.all([
    getWeekAnalytics(cohortId),
    getQuizDistribution(cohortId),
    getAtRiskStudents(cohortId),
  ]);

  return {
    cohortId,
    studentCount: weeks[0]?.studentCount ?? 0,
    weeks,
    quizDistribution,
    overallQuizPassRate: aggregateRate(weeks.map((w) => w.quizPassRate)),
    overallSubmissionRate: aggregateRate(weeks.map((w) => w.submissionRate)),
    atRisk,
    computeMs: Date.now() - startedAt, // milliseconds
  };
}
