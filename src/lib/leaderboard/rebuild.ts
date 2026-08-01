// =============================================================================
// LEADERBOARD WRITE PATH — upsert a student's row, then renumber their cohort.
// Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// This is the only module in the app that writes to the `leaderboard` table.
//
// CONCURRENCY (the part that matters)
//
// Two students being graded at the same instant both want to renumber the same
// cohort. Renumbering is a read-then-write over every row in the cohort, so
// without serialisation the two passes interleave and you get duplicated or
// gapped ranks — the classic symptom being two "rank 4"s and no "rank 5".
//
// Two mechanisms, both required:
//
//   1. `db.transaction()` — the upsert and the renumber are one atomic unit.
//      A reader never sees a row whose totalScore has moved but whose ranking
//      has not. (This is why src/db/index.ts uses node-postgres rather than
//      neon-http: the HTTP driver has no interactive transactions at all.)
//
//   2. `pg_advisory_xact_lock(namespace, cohortId)` — a cohort-scoped mutex, so
//      two concurrent renumbers of the SAME cohort queue instead of racing,
//      while different cohorts still proceed in parallel. Advisory locks are
//      cheap (in-memory, no row contention) and the XACT variant is released by
//      COMMIT/ROLLBACK automatically. That last point is not incidental: the
//      pooled Neon endpoint is PgBouncer, where a SESSION-level advisory lock
//      would leak onto whichever backend the pool later hands to someone else.
//      Transaction-scoped is the only correct choice behind a transaction pooler.
//
//   The alternative — SERIALIZABLE isolation — would push the failure into
//   40001 serialisation errors that this call path deliberately swallows, so a
//   grading event would silently not update the board. An explicit lock makes
//   the second writer wait rather than fail.
//
// All durations are milliseconds (house rule 5).
// =============================================================================

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { leaderboard, users } from "@/db/schema";
import type { ScoringEvent } from "@/lib/contracts/events";
import { courseMaxScore } from "@/lib/contracts/scoring";
import {
  ZERO_SCORES,
  applyPoints,
  componentCaps,
  isMeaningfulEvent,
  totalOf,
  type ComponentScores,
} from "./ranking";

/**
 * The transaction handle drizzle hands to a `db.transaction()` callback.
 * Derived from `db` rather than importing `PgTransaction` with its five generic
 * parameters, so it cannot drift from the driver choice in src/db/index.ts.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * First key of the advisory lock — an arbitrary but fixed namespace so the
 * leaderboard cannot collide with another stream that also locks on a cohort id.
 * Must fit in int4.
 */
const LOCK_NAMESPACE = 4_150_711;

/** Cohort id used in the lock when the student has no cohort (`cohortId IS NULL`). */
const NULL_COHORT_LOCK_KEY = 0;

export interface RebuildResult {
  /** Rows whose `ranking` the renumber pass touched. */
  rowsRanked: number;
  /** Wall-clock duration of the transaction, in milliseconds. */
  durationMs: number;
}

export interface ApplyResult extends RebuildResult {
  applied: boolean;
  /** Why the event was ignored. Absent when `applied` is true. */
  skippedReason?: "invalid_event" | "unknown_student" | "not_a_student";
  /** The student's new total after the event, null when skipped. */
  totalScore: number | null;
}

// ---------------------------------------------------------------------------
// Cohort-scoped serialisation
// ---------------------------------------------------------------------------

async function lockCohort(tx: Tx, cohortId: number | null): Promise<void> {
  const key = cohortId ?? NULL_COHORT_LOCK_KEY;
  await tx.execute(
    sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}::int4, ${key}::int4)`,
  );
}

// ---------------------------------------------------------------------------
// Renumbering
// ---------------------------------------------------------------------------

/**
 * Rewrite `ranking` for every leaderboard row in one cohort.
 *
 * The ORDER BY is the SQL twin of `compareForRank` in ./ranking.ts — read the
 * tie-break rationale there; the two MUST stay in step, and
 * ranking.test.ts pins the JavaScript half so a change is at least visible.
 *
 * Implementation notes:
 *   - `ROW_NUMBER()` gives ordinal ranks: 1..N, no duplicates, no gaps. Safe
 *     because the comparator is a total order (studentId is the final key).
 *   - `cohort_id IS NOT DISTINCT FROM $1` — plain `=` never matches NULL, so an
 *     unassigned student's row would never be ranked at all with `=`.
 *   - `JOIN users ... role = 'student'` — REQUIREMENT: staff must never appear
 *     on a student leaderboard. Filtering here means even if a stray row for an
 *     instructor were inserted, it is excluded from ranking, and ./queries.ts
 *     applies the same filter on read. Two independent barriers.
 *   - The `IS DISTINCT FROM` guard in the WHERE clause skips no-op updates, so
 *     a rebuild that changes nothing writes zero rows and produces no dead
 *     tuples for autovacuum. It also makes `rowsRanked` a useful signal.
 *   - Uses the `leaderboard_score_idx` (cohort_id, total_score) index for the
 *     scan + sort, and `leaderboard_student_idx` for the joins.
 */
export async function renumberCohort(tx: Tx, cohortId: number | null): Promise<number> {
  const result = await tx.execute(sql`
    with stars as (
      select
        s.student_id                          as student_id,
        avg(s.instructor_rating)::float8      as avg_stars,
        min(s.submitted_at)                   as first_submitted_at
      from submissions s
      group by s.student_id
    ),
    ranked as (
      select
        l.id as id,
        row_number() over (
          order by
            l.total_score            desc,
            st.avg_stars             desc nulls last,
            l.final_project_score    desc,
            st.first_submitted_at    asc  nulls last,
            l.student_id             asc
        ) as rn
      from leaderboard l
      join users u on u.id = l.student_id and u.role = 'student'
      left join stars st on st.student_id = l.student_id
      where l.cohort_id is not distinct from ${cohortId}
    )
    update leaderboard
       set ranking = ranked.rn,
           updated_at = now()
      from ranked
     where leaderboard.id = ranked.id
       and leaderboard.ranking is distinct from ranked.rn
  `);

  // node-postgres reports affected rows as `rowCount`; drizzle passes the result
  // through. Guard the shape rather than casting blindly — a driver change must
  // not turn this into a crash on the grading path.
  const rowCount = (result as { rowCount?: number | null } | undefined)?.rowCount;
  return typeof rowCount === "number" ? rowCount : 0;
}

// ---------------------------------------------------------------------------
// The full-cohort rebuild (SKILL.md: rebuildLeaderboard(cohortId))
// ---------------------------------------------------------------------------

/**
 * Recompute `totalScore` from the four component columns for every row in the
 * cohort, then renumber. Idempotent by construction: running it twice produces
 * the same table and the second run reports `rowsRanked: 0`.
 *
 * This is the repair path. `onScoringEvent` is incremental (it adds the points
 * the caller just awarded), which is fast but assumes each event arrives once.
 * Callers swallow rejections, so a retry can double-deliver. The per-component
 * caps in ./ranking.ts bound the damage; this function is how an operator (or a
 * future cron) restores exact totals and ranks without a manual UPDATE.
 *
 * TODO(leaderboard): re-derive the component columns themselves from
 * quiz_attempts / submissions / attendance via scoring.ts, so a rebuild can also
 * repair a component that drifted rather than only the total and the ranks.
 * Deliberately out of scope here: that derivation duplicates the aggregation
 * decisions the quizzes and submissions streams are still landing, and shipping
 * a second opinion on "which submissions count" is how the leaderboard and the
 * gradebook start disagreeing.
 */
export async function rebuildLeaderboard(cohortId: number | null): Promise<RebuildResult> {
  const startedAt = Date.now();
  const caps = componentCaps();
  const ceiling = courseMaxScore();

  const rowsRanked = await db.transaction(async (tx) => {
    await lockCohort(tx, cohortId);

    await tx.execute(sql`
      update leaderboard l
         set quiz_score           = least(greatest(l.quiz_score, 0),           ${caps.quizScore}),
             assignment_score     = least(greatest(l.assignment_score, 0),     ${caps.assignmentScore}),
             participation_score  = least(greatest(l.participation_score, 0),  ${caps.participationScore}),
             final_project_score  = least(greatest(l.final_project_score, 0),  ${caps.finalProjectScore}),
             total_score = least(
               least(greatest(l.quiz_score, 0),          ${caps.quizScore})
             + least(greatest(l.assignment_score, 0),    ${caps.assignmentScore})
             + least(greatest(l.participation_score, 0), ${caps.participationScore})
             + least(greatest(l.final_project_score, 0), ${caps.finalProjectScore}),
               ${ceiling}
             ),
             updated_at = now()
       where l.cohort_id is not distinct from ${cohortId}
    `);

    return renumberCohort(tx, cohortId);
  });

  return { rowsRanked, durationMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// The incremental path used by onScoringEvent
// ---------------------------------------------------------------------------

/**
 * Upsert one student's row from a `ScoringEvent`, then renumber their cohort.
 *
 * `event.cohortId` is treated as a HINT, not as truth: the authoritative cohort
 * (and the student's role) is read from `users` inside the transaction. A caller
 * holding a stale cohort id would otherwise write a row into the wrong board,
 * and a caller passing an instructor's id would put staff on a student board.
 */
export async function applyScoringEvent(event: ScoringEvent): Promise<ApplyResult> {
  const startedAt = Date.now();

  if (!isMeaningfulEvent(event)) {
    return {
      applied: false,
      skippedReason: "invalid_event",
      totalScore: null,
      rowsRanked: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const outcome = await db.transaction(async (tx) => {
    const [student] = await tx
      .select({ id: users.id, role: users.role, cohortId: users.cohortId })
      .from(users)
      .where(eq(users.id, event.studentId))
      .limit(1);

    if (!student) {
      return { applied: false as const, skippedReason: "unknown_student" as const };
    }
    if (student.role !== "student") {
      // Staff have no standing. Returning quietly rather than throwing: the
      // caller swallows rejections, so a throw here would be invisible, and
      // participation points for a demo instructor account are not an incident.
      return { applied: false as const, skippedReason: "not_a_student" as const };
    }

    const cohortId = student.cohortId ?? event.cohortId ?? null;

    // Serialise before reading the current row: the read-modify-write below and
    // the renumber must both sit inside the same held lock, or a second event
    // for the same student could read the same "before" value and lose points.
    await lockCohort(tx, cohortId);

    const [existing] = await tx
      .select({
        quizScore: leaderboard.quizScore,
        assignmentScore: leaderboard.assignmentScore,
        participationScore: leaderboard.participationScore,
        finalProjectScore: leaderboard.finalProjectScore,
      })
      .from(leaderboard)
      .where(eq(leaderboard.studentId, event.studentId))
      .limit(1);

    const current: ComponentScores = existing ?? { ...ZERO_SCORES };
    const next = applyPoints(current, event.source, event.points);

    // `leaderboard_student_idx` is the unique index this conflict target names —
    // one row per student, so a concurrent first-time insert updates instead of
    // raising 23505 into the grading path.
    await tx
      .insert(leaderboard)
      .values({
        studentId: event.studentId,
        cohortId,
        quizScore: next.quizScore,
        assignmentScore: next.assignmentScore,
        participationScore: next.participationScore,
        finalProjectScore: next.finalProjectScore,
        totalScore: next.totalScore,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: leaderboard.studentId,
        set: {
          cohortId,
          quizScore: next.quizScore,
          assignmentScore: next.assignmentScore,
          participationScore: next.participationScore,
          finalProjectScore: next.finalProjectScore,
          totalScore: next.totalScore,
          updatedAt: new Date(),
        },
      });

    const rowsRanked = await renumberCohort(tx, cohortId);

    return {
      applied: true as const,
      totalScore: next.totalScore,
      rowsRanked,
    };
  });

  if (!outcome.applied) {
    return {
      applied: false,
      skippedReason: outcome.skippedReason,
      totalScore: null,
      rowsRanked: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    applied: true,
    totalScore: outcome.totalScore,
    rowsRanked: outcome.rowsRanked,
    durationMs: Date.now() - startedAt,
  };
}

/** Re-exported for the repair path's callers; keeps `totalOf` in one place. */
export { totalOf };
