// =============================================================================
// BADGE FACTS — the ONE query that feeds the pure criteria in ./evaluate.ts.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// WHY ONE QUERY AND NOT SIX.
//
// Badge evaluation runs off the back of a grading event, in the same request an
// instructor is waiting on (see ./on-scoring-event.ts for the call path). The cost
// of a round trip against this Neon instance was measured at ~245 ms on an already
// -open pooled connection — the number src/lib/queue/store.ts:463-467 cites for
// making `queueCounts` one statement instead of six. Five badges over five
// separate queries would be over a second of an instructor's grading request spent
// on gamification. Everything below is gathered in a single statement of
// independent scalar subqueries, so the cost is one round trip whatever the
// catalogue grows to.
//
// -----------------------------------------------------------------------------
// WHY THESE READS ARE HAND-WRITTEN SQL AND NOT THE EXISTING READ MODELS.
//
// src/lib/progress/**, src/lib/penalties/** and src/lib/attendance/** are read
// models over the same tables, and the obvious move is to call them. They are not
// used here, deliberately:
//
//   * they answer PER-WEEK questions (`getWeekProgress` takes a weekId) and every
//     criterion here is course-wide, so composing them means N week queries;
//   * they return SCORES, computed through src/lib/contracts/scoring.ts. A badge
//     must not depend on a score for a fact like "did you submit this on time",
//     because scoring rules move — `assignmentPoints` changed meaning TODAY
//     (scoring.ts:65-94, ungraded now scores 0) and a badge criterion phrased over
//     it would have silently changed with it.
//
// The one place a scoring rule IS the right source is `high_score`, which is
// defined as "grade A" — and that one goes through `courseMaxScore()` and
// `letterGrade()` rather than a literal. See ./catalogue.ts#highScoreThreshold.
//
// Raw SQL rather than the select builder because these are correlated scalar
// subqueries in one projection, which drizzle's builder expresses only as
// `sql` fragments anyway. Column names are mapped by hand below rather than cast,
// so a rename fails visibly here instead of producing `undefined` facts and a
// silently unearnable badge — the reasoning at src/lib/queue/store.ts:307-312.
// =============================================================================

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { courseMaxScore } from "@/lib/contracts/scoring";

import type { BadgeFacts } from "./evaluate";

/** Drizzle's transaction handle, derived from `db` so it cannot drift. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either the pooled client or an open transaction. */
export type Db = typeof db | Tx;

/** Shape node-postgres returns for the statement below. Every column nullable-safe. */
interface RawFactsRow {
  submission_count: string | number | null;
  best_quiz_percent: string | number | null;
  best_quiz_id: string | number | null;
  assignment_total: string | number | null;
  on_time_assignments: string | number | null;
  late_assignments: string | number | null;
  solved_problems: string | number | null;
  total_score: string | number | null;
}

function num(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Gather every fact the criteria need for one student.
 *
 * `courseId` scopes the `all_assignments_ontime` denominator. Null means "the
 * active course", resolved the same way `getActiveCourseId`
 * (src/lib/courses/store.ts:46) and `loadCourseAndWeeks`
 * (src/components/course/data.ts:160) resolve it — `ORDER BY id ASC LIMIT 1`.
 * That duplication is deliberate and is the smaller evil for the reason
 * courses/store.ts:39-45 already argues: importing it would pull a React
 * `cache()`-wrapped module into a path that runs outside a request. It is inlined
 * as a subquery here rather than fetched first, so it costs no extra round trip.
 *
 * The whole statement is read-only, so it is safe to run inside a caller's
 * transaction or on the pool.
 */
export async function loadBadgeFacts(
  studentId: number,
  options: { courseId?: number | null; client?: Db } = {},
): Promise<BadgeFacts> {
  const client = options.client ?? db;
  const id = Math.trunc(studentId);

  // The course whose assignments form the denominator. `coalesce` on a parameter
  // rather than two variants of the statement.
  const courseId = options.courseId ?? null;

  const result = await client.execute(sql`
    with target_course as (
      select coalesce(
        ${courseId}::int,
        (select c.id from courses c order by c.id asc limit 1)
      ) as id
    ),
    -- Best attempt over EVERY quiz, with the quiz it came from. A max, so a worse
    -- later attempt cannot revoke perfect_quiz (./evaluate.ts monotonicity note).
    -- ORDER BY + LIMIT 1 rather than max(), because the quiz_id has to come from
    -- the same row as the percentage.
    best_attempt as (
      select qa.quiz_id, qa.percentage
        from quiz_attempts qa
       where qa.student_id = ${id}
       order by qa.percentage desc, qa.id asc
       limit 1
    )
    select
      (select count(*)::int
         from submissions s
        where s.student_id = ${id})                            as submission_count,

      (select ba.percentage from best_attempt ba)              as best_quiz_percent,
      (select ba.quiz_id    from best_attempt ba)              as best_quiz_id,

      -- DENOMINATOR: assignments belonging to the target course, via weeks.
      -- assignments has no course_id of its own (src/db/schema.ts:363-377), so
      -- the join through weeks is the only way to scope it.
      (select count(*)::int
         from assignments a
         join weeks w on w.id = a.week_id
        where w.course_id = (select id from target_course))     as assignment_total,

      -- DISTINCT assignment, not distinct submission: a student who submitted the
      -- same assignment twice on time must count once, or two rows for one
      -- assignment could satisfy a two-assignment course.
      (select count(distinct s.assignment_id)::int
         from submissions s
         join assignments a on a.id = s.assignment_id
         join weeks w on w.id = a.week_id
        where s.student_id = ${id}
          and w.course_id = (select id from target_course)
          and s.is_late = false)                                as on_time_assignments,

      (select count(distinct s.assignment_id)::int
         from submissions s
         join assignments a on a.id = s.assignment_id
         join weeks w on w.id = a.week_id
        where s.student_id = ${id}
          and w.course_id = (select id from target_course)
          and s.is_late = true)                                 as late_assignments,

      -- SOLVED is DERIVED from a run that passed every test, never read from a
      -- stored flag. src/db/schema.ts:705-710 states the rule for exactly this
      -- table: "a denormalized solved flag is a second source of truth, and the
      -- failure mode is a flag that says solved when no passing run exists".
      -- total_count > 0 excludes a problem with no tests, where passed = total = 0
      -- would otherwise read as solved.
      -- (No backticks anywhere in this template literal: one of them terminated
      -- the string and esbuild reported it as a SQL syntax error 40 lines away.)
      (select count(distinct ca.problem_id)::int
         from coding_attempts ca
        where ca.student_id = ${id}
          and ca.total_count > 0
          and ca.passed_count >= ca.total_count)                as solved_problems,

      -- 0, not null, when the student has no leaderboard row yet: "not ranked" and
      -- "ranked with nothing" are the same thing for a threshold comparison, and
      -- coalescing here keeps the null out of the pure criteria.
      (select coalesce(max(l.total_score), 0)::int
         from leaderboard l
        where l.student_id = ${id})                             as total_score
  `);

  const rows = (result as { rows?: unknown } | undefined)?.rows;
  const row = (Array.isArray(rows) ? (rows[0] as RawFactsRow | undefined) : undefined) ?? null;

  return {
    studentId: id,
    submissionCount: num(row?.submission_count),
    // `quiz_attempts.percentage` is decimal(5,2) (src/db/schema.ts:281) and
    // arrives as the STRING "100.00". Parsed here, at the boundary, and nowhere
    // else — which is why ./evaluate.ts compares with `>=` rather than `===`.
    bestQuizPercent: numOrNull(row?.best_quiz_percent),
    bestQuizId: numOrNull(row?.best_quiz_id),
    assignmentTotal: num(row?.assignment_total),
    onTimeAssignmentCount: num(row?.on_time_assignments),
    lateAssignmentCount: num(row?.late_assignments),
    solvedProblemCount: num(row?.solved_problems),
    totalScore: num(row?.total_score),
    // Passed into the facts rather than read inside a criterion, so the pure rules
    // stay pure and a test can vary the course length without touching config.
    maxScore: courseMaxScore(),
  };
}
