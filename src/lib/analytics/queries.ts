// =============================================================================
// ADVANCED ANALYTICS — ONE STATEMENT. Extension of the instructor-admin
// analytics surface (IMPLEMENTATION_ROADMAP.md, Phase 2 feature 7).
// -----------------------------------------------------------------------------
// THIS IS NOT A SECOND ANALYTICS PAGE, AND NOT A SECOND SOURCE OF TRUTH.
//
// `/instructor/analytics` and `/admin/analytics` already ship. Pass rates, the
// quiz score histogram, per-week submission/completion rates and the penalty-based
// at-risk list all come from `getCohortAnalytics`
// (src/lib/instructor/analytics.ts) and STILL DO — those pages were extended, not
// replaced, and this module deliberately computes none of those figures again.
// Two analytics pages quoting different pass rates for one cohort is worse than
// one page, which is why the roadmap's suggested `/instructor/analytics-v2` route
// was not created.
//
// WHAT THIS ADDS is the part of feature 7 that no existing read model can answer,
// and for each one the reason it cannot:
//
//   * ACTIVITY HEATMAP (roadmap: "time-on-task heatmaps"). No read model records
//     WHEN work happens. `src/lib/progress/query.ts` returns per-week counts and
//     flags; `submissions` rows carry `submitted_at` but nothing aggregates it by
//     clock time. Nothing in the schema records dwell time either — there is no
//     session or page-view table — so this is honestly an ACTIVITY heatmap
//     (events per weekday x 4-hour block) and is labelled that way in the UI
//     rather than being passed off as time-on-task.
//   * ENGAGEMENT (roadmap: "login frequency, submission patterns"). There is no
//     login/audit table in this schema (activity logs are Phase 1 feature 4 and
//     not built), so "login frequency" is not answerable and is not faked. What
//     IS answerable is active-student counts over 7/30 days across the four event
//     tables that do carry timestamps, plus the daily series behind them.
//   * PROBLEM DIFFICULTY (roadmap: "problem difficulty analysis").
//     `src/lib/problems/service.ts:listProblems` is per-student browse data; it
//     answers "has THIS student solved it", never "how hard is it for the cohort".
//   * GRADE DISTRIBUTION (roadmap: "student performance distribution"). Reuses
//     `leaderboard.total_score` — the denormalised totals the leaderboard stream
//     writes through the scoring contract — and buckets them by calling
//     `letterGrade` from src/lib/contracts/scoring.ts. See ./distribution.ts for
//     why not one line of that arithmetic is repeated here.
//   * PREDICTIVE RISK (roadmap: "predictive alerts for at-risk students"). The
//     existing at-risk list is `>= 3 unresolved penalties`, which is a lagging
//     signal by construction. See the header of ./risk.ts.
//
// -----------------------------------------------------------------------------
// PERFORMANCE — MEASURED, AND THE REASON THIS FILE IS SHAPED LIKE THIS.
//
// src/db/index.ts:56 records the measurement that decides everything here: on
// this Neon instance a query on an existing pooled connection costs ~245 ms of
// pure network round trip, and the pool ceiling is `max: 5` (src/db/index.ts:77).
// The five figures above are five aggregates. Written the obvious way — one
// exported function each, `Promise.all` at the call site — they would be five
// round trips: ~1225 ms if the pool serialises them behind the three
// `getCohortAnalytics` already issues, and five of the five available connections
// held at once while the rest of the app waits.
//
// So this is ONE statement. Every figure is a CTE, and the final SELECT returns a
// SINGLE ROW of `jsonb` columns. The precedent is
// `src/lib/progress/query.ts:fetchWeekAggregates`, which took the same decision
// for the same reason and states it at length.
//
// Measured with scripts/perf-probe.ts against live Neon — the numbers are in
// CHANGELOG.log for 2026-07-31 and in the report; do not "optimise" this on a
// hunch without re-running the probe.
//
// WHY RAW SQL: the aggregation needs UNION ALL across four event tables, EXTRACT
// on timestamptz, `COUNT(DISTINCT ...) FILTER (WHERE ...)`, `generate_series` for
// a gap-free daily series, and five independent groupings composed into one row.
// The typed query builder expresses none of that without more noise than the type
// safety returns. The trade-off is stated plainly, as house rule 7 requires: this
// file must be revisited if src/db/schema.ts renames a column, and every column
// it touches is named in the comments below.
// =============================================================================

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";

import {
  buildHeatmap,
  gradeDistribution,
  type GradeDistribution,
  type Heatmap,
  type HeatmapCellRow,
} from "./distribution";
import { rankRisk, type RiskAssessment, type RiskSignals } from "./risk";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface EngagementSummary {
  /** Distinct students with at least one recorded event in the last 7 days. */
  activeStudents7d: number;
  activeStudents30d: number;
  /** Students in scope, so the two counts above have a denominator. */
  cohortStudentCount: number;
  /** Every recorded event, all time. The heatmap's grand total. */
  eventCount: number;
  /** Most recent event across the cohort, or null on a cohort that never acted. */
  lastEventAt: Date | null;
  submissionCount: number;
  lateSubmissionCount: number;
}

/** One day of the trailing series. Gap-free: quiet days are present, at zero. */
export interface DailyActivity {
  /** ISO date, YYYY-MM-DD, UTC. */
  day: string;
  activeStudents: number;
  events: number;
}

export interface ProblemDifficulty {
  problemId: number;
  title: string;
  track: string;
  level: string;
  attemptCount: number;
  /** Distinct students who ran it. */
  studentCount: number;
  /** Distinct students with at least one all-tests-passing run. */
  solverCount: number;
  /** solvers / students, or null when nobody has tried it. */
  solveRatePercent: number | null;
  /** Runs per solver — the "how many goes did it take" number. Null if none. */
  attemptsPerSolver: number | null;
  avgRuntimeMs: number | null;
}

export interface AdvancedAnalytics {
  cohortId: number | null;
  engagement: EngagementSummary;
  daily: DailyActivity[];
  heatmap: Heatmap;
  problems: ProblemDifficulty[];
  grades: GradeDistribution;
  risk: RiskAssessment[];
  /** Wall-clock cost of the single statement, in milliseconds. */
  computeMs: number;
  /** Round trips this call made. One. Asserted in the e2e/perf notes. */
  queryCount: number;
}

/** Trailing window for the daily series, in days. */
export const DAILY_WINDOW_DAYS = 14;

// ---------------------------------------------------------------------------
// Coercion helpers. pg returns numerics as strings unless cast; every numeric
// expression below IS cast, and these still coerce defensively — the same
// belt-and-braces src/lib/progress/query.ts uses.
// ---------------------------------------------------------------------------

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Drizzle's node-postgres `execute` returns a pg QueryResult; some versions
 * return the row array directly. Normalised once, exactly as
 * src/lib/instructor/analytics.ts does, so neither file is written against a
 * driver detail.
 */
async function rows<T>(query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: unknown };
  return Array.isArray(maybe.rows) ? (maybe.rows as T[]) : [];
}

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------

/**
 * Everything feature 7 adds, in ONE round trip.
 *
 * `cohortId === null` means the whole platform, matching the convention
 * `getCohortAnalytics` already established for the same query string.
 *
 * NOTE ON THE ACTIVITY UNION. Four tables carry a per-student timestamp and are
 * the only evidence this schema has that a student did anything:
 *   quiz_attempts.submitted_at / .started_at, submissions.submitted_at,
 *   coding_attempts.created_at, attendance.recorded_at (attended rows only).
 * `attendance.recorded_at` is when STAFF recorded the register, not when the
 * student sat in the lecture; it is included because it is genuine evidence the
 * student was present that day, and its inclusion is why this is called an
 * activity heatmap and not a time-on-task one.
 */
export async function getAdvancedAnalytics(
  cohortId: number | null = null,
): Promise<AdvancedAnalytics> {
  const startedAt = Date.now();
  const scope = cohortId ?? null;

  const query = sql`
    WITH cohort_students AS (
      -- Same scoping rule as src/lib/instructor/analytics.ts: students only, so
      -- an instructor is never part of their own cohort's numbers.
      SELECT u.id, u.name
      FROM users u
      WHERE u.role = 'student'
        AND (${scope}::int IS NULL OR u.cohort_id = ${scope}::int)
    ),
    week_count AS (SELECT COUNT(*)::int AS n FROM weeks),
    activity AS (
      SELECT student_id, ts FROM (
        SELECT qa.student_id, COALESCE(qa.submitted_at, qa.started_at) AS ts
        FROM quiz_attempts qa
        JOIN cohort_students cs ON cs.id = qa.student_id
        UNION ALL
        SELECT s.student_id, s.submitted_at AS ts
        FROM submissions s
        JOIN cohort_students cs ON cs.id = s.student_id
        UNION ALL
        SELECT ca.student_id, ca.created_at AS ts
        FROM coding_attempts ca
        JOIN cohort_students cs ON cs.id = ca.student_id
        UNION ALL
        SELECT a.student_id, a.recorded_at AS ts
        FROM attendance a
        JOIN cohort_students cs ON cs.id = a.student_id
        WHERE a.attended
      ) u
      WHERE ts IS NOT NULL
    ),
    heat AS (
      -- ISODOW: 1 = Monday. Hour blocks of 4, in the session time zone (UTC on
      -- this instance) — the UI labels them UTC rather than pretending they are
      -- the viewer's local time.
      SELECT EXTRACT(ISODOW FROM ts)::int        AS dow,
             (EXTRACT(HOUR FROM ts)::int / 4)    AS block,
             COUNT(*)::int                       AS n
      FROM activity
      GROUP BY 1, 2
    ),
    day_series AS (
      -- generate_series, not GROUP BY on the events: a day nobody worked must
      -- appear at zero. A sparse series renders as a shorter chart, which reads
      -- as "the cohort was busy every day".
      SELECT d::date AS day
      FROM generate_series(
             (now() AT TIME ZONE 'UTC')::date - ${DAILY_WINDOW_DAYS - 1}::int,
             (now() AT TIME ZONE 'UTC')::date,
             interval '1 day'
           ) AS d
    ),
    daily AS (
      SELECT ds.day,
             COUNT(DISTINCT a.student_id)::int AS active_students,
             COUNT(a.student_id)::int          AS events
      FROM day_series ds
      LEFT JOIN activity a
        ON a.ts >= ds.day::timestamptz
       AND a.ts <  (ds.day + 1)::timestamptz
      GROUP BY ds.day
    ),
    sub_totals AS (
      SELECT COUNT(*)::int                                AS submission_count,
             COUNT(*) FILTER (WHERE s.is_late)::int       AS late_count
      FROM submissions s
      JOIN cohort_students cs ON cs.id = s.student_id
    ),
    prob AS (
      SELECT p.id, p.title, p.track, p.level::text AS level,
             COUNT(ca.id)::int                     AS attempts,
             COUNT(DISTINCT ca.student_id)::int    AS students,
             COUNT(DISTINCT ca.student_id) FILTER (
               WHERE ca.total_count > 0 AND ca.passed_count = ca.total_count
             )::int                                AS solvers,
             AVG(ca.runtime_ms)::float8            AS avg_runtime_ms
      FROM coding_problems p
      JOIN coding_attempts ca ON ca.problem_id = p.id
      JOIN cohort_students cs ON cs.id = ca.student_id
      WHERE p.published
      GROUP BY p.id, p.title, p.track, p.level
    ),
    lb_totals AS (
      -- The denormalised totals, NOT recomputed. See ./distribution.ts.
      SELECT lb.total_score
      FROM leaderboard lb
      JOIN cohort_students cs ON cs.id = lb.student_id
    ),
    quizzed_weeks AS (
      SELECT qa.student_id, COUNT(DISTINCT q.week_id)::int AS n
      FROM quiz_attempts qa
      JOIN quizzes q ON q.id = qa.quiz_id
      JOIN cohort_students cs ON cs.id = qa.student_id
      GROUP BY qa.student_id
    ),
    pen AS (
      SELECT p.student_id,
             COUNT(*)::int                            AS cnt,
             COALESCE(SUM(p.penalty_points), 0)::int  AS pts
      FROM penalties p
      JOIN cohort_students cs ON cs.id = p.student_id
      WHERE p.resolved = false
      GROUP BY p.student_id
    ),
    subs AS (
      SELECT s.student_id,
             COUNT(*) FILTER (WHERE s.status <> 'graded')::int AS ungraded,
             COUNT(*) FILTER (WHERE s.is_late)::int            AS late
      FROM submissions s
      JOIN cohort_students cs ON cs.id = s.student_id
      GROUP BY s.student_id
    ),
    last_seen AS (
      SELECT student_id, MAX(ts) AS ts FROM activity GROUP BY student_id
    ),
    risk AS (
      -- FACTS ONLY. The weighting lives in ./risk.ts where a unit test can reach
      -- it; a weight expressed in SQL is a weight nothing tests.
      -- NAME, NEVER EMAIL: see ./privacy.ts.
      SELECT cs.id                                        AS student_id,
             cs.name                                      AS name,
             COALESCE(pen.cnt, 0)                         AS penalty_count,
             COALESCE(pen.pts, 0)                         AS penalty_points,
             GREATEST(wc.n - COALESCE(qw.n, 0), 0)        AS weeks_without_quiz,
             wc.n                                         AS week_count,
             COALESCE(subs.ungraded, 0)                   AS ungraded_submissions,
             COALESCE(subs.late, 0)                       AS late_submissions,
             CASE WHEN ls.ts IS NULL THEN NULL
                  ELSE FLOOR(EXTRACT(EPOCH FROM (now() - ls.ts)) / 86400)::int
             END                                          AS days_since_activity
      FROM cohort_students cs
      CROSS JOIN week_count wc
      LEFT JOIN quizzed_weeks qw ON qw.student_id = cs.id
      LEFT JOIN pen            ON pen.student_id = cs.id
      LEFT JOIN subs           ON subs.student_id = cs.id
      LEFT JOIN last_seen ls   ON ls.student_id = cs.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM cohort_students) AS student_count,
      (SELECT COUNT(DISTINCT student_id)::int FROM activity
        WHERE ts > now() - interval '7 days')     AS active_7d,
      (SELECT COUNT(DISTINCT student_id)::int FROM activity
        WHERE ts > now() - interval '30 days')    AS active_30d,
      (SELECT COUNT(*)::int FROM activity)        AS event_count,
      (SELECT MAX(ts) FROM activity)              AS last_event_at,
      (SELECT submission_count FROM sub_totals)   AS submission_count,
      (SELECT late_count FROM sub_totals)         AS late_submission_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('dow', dow, 'block', block, 'count', n))
                FROM heat), '[]'::jsonb)          AS heatmap,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'day', to_char(day, 'YYYY-MM-DD'),
                  'activeStudents', active_students,
                  'events', events) ORDER BY day)
                FROM daily), '[]'::jsonb)         AS daily,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'problemId', id, 'title', title, 'track', track, 'level', level,
                  'attempts', attempts, 'students', students, 'solvers', solvers,
                  'avgRuntimeMs', avg_runtime_ms)
                  ORDER BY solvers::float8 / NULLIF(students, 0) ASC NULLS FIRST,
                           attempts DESC)
                FROM prob), '[]'::jsonb)          AS problems,
      COALESCE((SELECT jsonb_agg(total_score) FROM lb_totals), '[]'::jsonb)
                                                  AS lb_totals,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'studentId', student_id, 'name', name,
                  'penaltyCount', penalty_count, 'penaltyPoints', penalty_points,
                  'weeksWithoutQuizAttempt', weeks_without_quiz,
                  'weekCount', week_count,
                  'ungradedSubmissionCount', ungraded_submissions,
                  'lateSubmissionCount', late_submissions,
                  'daysSinceLastActivity', days_since_activity))
                FROM risk), '[]'::jsonb)          AS risk`;

  const [row] = await rows<Record<string, unknown>>(query);
  const r = toRecord(row);

  const cohortStudentCount = toInt(r.student_count);

  const heatmapRows: HeatmapCellRow[] = toArray(r.heatmap).map((cell) => {
    const c = toRecord(cell);
    return { dow: toInt(c.dow), block: toInt(c.block), count: toInt(c.count) };
  });

  const daily: DailyActivity[] = toArray(r.daily).map((d) => {
    const o = toRecord(d);
    return {
      day: String(o.day ?? ""),
      activeStudents: toInt(o.activeStudents),
      events: toInt(o.events),
    };
  });

  const problems: ProblemDifficulty[] = toArray(r.problems).map((p) => {
    const o = toRecord(p);
    const students = toInt(o.students);
    const solvers = toInt(o.solvers);
    const attempts = toInt(o.attempts);
    return {
      problemId: toInt(o.problemId),
      title: String(o.title ?? ""),
      track: String(o.track ?? ""),
      level: String(o.level ?? ""),
      attemptCount: attempts,
      studentCount: students,
      solverCount: solvers,
      // Zero denominators are "no data", never 0% — the rule
      // src/lib/instructor/rates.ts states for the whole analytics surface.
      solveRatePercent: students > 0 ? (solvers / students) * 100 : null,
      attemptsPerSolver: solvers > 0 ? attempts / solvers : null,
      avgRuntimeMs: toNumberOrNull(o.avgRuntimeMs),
    };
  });

  const totals = toArray(r.lb_totals)
    .map((t) => toNumberOrNull(t))
    .filter((t): t is number => t !== null);

  const riskSignals: RiskSignals[] = toArray(r.risk).map((s) => {
    const o = toRecord(s);
    return {
      studentId: toInt(o.studentId),
      name: String(o.name ?? ""),
      penaltyCount: toInt(o.penaltyCount),
      penaltyPoints: toInt(o.penaltyPoints),
      weeksWithoutQuizAttempt: toInt(o.weeksWithoutQuizAttempt),
      weekCount: toInt(o.weekCount),
      ungradedSubmissionCount: toInt(o.ungradedSubmissionCount),
      lateSubmissionCount: toInt(o.lateSubmissionCount),
      daysSinceLastActivity: toNumberOrNull(o.daysSinceLastActivity),
    };
  });

  return {
    cohortId,
    engagement: {
      activeStudents7d: toInt(r.active_7d),
      activeStudents30d: toInt(r.active_30d),
      cohortStudentCount,
      eventCount: toInt(r.event_count),
      lastEventAt: toDateOrNull(r.last_event_at),
      submissionCount: toInt(r.submission_count),
      lateSubmissionCount: toInt(r.late_submission_count),
    },
    daily,
    heatmap: buildHeatmap(heatmapRows),
    problems,
    grades: gradeDistribution(totals, cohortStudentCount),
    risk: rankRisk(riskSignals),
    computeMs: Date.now() - startedAt, // milliseconds (house rule: metric)
    queryCount: 1,
  };
}
