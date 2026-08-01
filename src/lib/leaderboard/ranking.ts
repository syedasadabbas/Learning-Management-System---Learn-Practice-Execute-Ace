// =============================================================================
// LEADERBOARD RANKING — pure maths, no database, no I/O.
// -----------------------------------------------------------------------------
// Owner: leaderboard stream.
//
// Everything in this file is a pure function of its arguments. That is
// deliberate: rank assignment is the part of the leaderboard that is easy to get
// subtly wrong (ties, empty cohorts, a cohort of one) and impossible to test
// cheaply once it is welded to SQL. The query layer (./rebuild.ts, ./queries.ts)
// fetches rows and hands them here.
//
// Score arithmetic delegates to src/lib/contracts/scoring.ts. This file never
// re-derives a points value from a percentage or a star rating — divergent
// copies of the scoring rules are exactly the leaderboard/grade mismatch the
// scoring contract exists to prevent.
// =============================================================================

import type { ScoringEvent, ScoringSource } from "@/lib/contracts/events";
import { POINTS, courseMaxScore } from "@/lib/contracts/scoring";
import { appConfig } from "@/lib/config/app.config";

// ---------------------------------------------------------------------------
// Source -> column mapping
// ---------------------------------------------------------------------------

/** The four score components stored on a `leaderboard` row. */
export interface ComponentScores {
  quizScore: number;
  assignmentScore: number;
  participationScore: number;
  finalProjectScore: number;
}

export type ComponentKey = keyof ComponentScores;

/**
 * Which `leaderboard` column a `ScoringSource` accumulates into.
 *
 * Typed as a total `Record` over the frozen `ScoringSource` union, so adding a
 * source to src/lib/contracts/events.ts fails compilation here rather than
 * silently dropping its points on the floor.
 */
export const COLUMN_FOR_SOURCE: Record<ScoringSource, ComponentKey> = {
  quiz: "quizScore",
  assignment: "assignmentScore",
  participation: "participationScore",
  final_project: "finalProjectScore",
};

/**
 * Course-wide ceiling for each component.
 *
 * POINTS in scoring.ts are PER WEEK for the three weekly components, so the
 * course ceiling is (per-week max x week count). The final project is a single
 * award and is already course-wide.
 *
 * These caps are load-bearing for idempotency, not cosmetic. `onScoringEvent`
 * is additive (see ./rebuild.ts) and its callers deliberately swallow
 * rejections, so a retried grading event can deliver the same points twice.
 * Clamping every component to a ceiling derived from the scoring contract means
 * a duplicate delivery can at worst push a student to their true maximum — it
 * can never manufacture a total above `courseMaxScore()` and reorder the board.
 */
export function componentCaps(
  durationWeeks: number = appConfig.course.durationWeeks,
): ComponentScores {
  const weeks = Math.max(0, durationWeeks);
  return {
    quizScore: weeks * POINTS.QUIZ_MAX,
    assignmentScore: weeks * POINTS.ASSIGNMENT_MAX,
    participationScore: weeks * POINTS.PARTICIPATION_MAX,
    finalProjectScore: POINTS.FINAL_PROJECT_MAX,
  };
}

/** Sum of the four components. Never exceeds `courseMaxScore()` once clamped. */
export function totalOf(scores: ComponentScores): number {
  return (
    scores.quizScore +
    scores.assignmentScore +
    scores.participationScore +
    scores.finalProjectScore
  );
}

export const ZERO_SCORES: Readonly<ComponentScores> = Object.freeze({
  quizScore: 0,
  assignmentScore: 0,
  participationScore: 0,
  finalProjectScore: 0,
});

/**
 * Apply a scoring event's points to the component its `source` names, and return
 * the whole new row (components + recomputed total).
 *
 * Semantics per source:
 *   - quiz / assignment / participation are WEEKLY and therefore ADDITIVE: the
 *     event carries the points for one week, and the column holds the course
 *     running total. Clamped to the course ceiling.
 *   - final_project is a SINGLE slot (its `weekId` is null by contract), so it
 *     is applied as `max(existing, points)` rather than added. That makes a
 *     duplicate delivery of the same final-project grade an exact no-op.
 *
 * Negative `points` and non-finite `points` are treated as 0: a caller passing
 * NaN would otherwise poison `totalScore` and make every comparison false,
 * silently randomising the whole cohort's order.
 */
export function applyPoints(
  current: ComponentScores,
  source: ScoringSource,
  points: number,
  caps: ComponentScores = componentCaps(),
): ComponentScores & { totalScore: number } {
  const column = COLUMN_FOR_SOURCE[source];
  const awarded = Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;

  const base = Math.max(0, Math.round(current[column]));
  const raw = source === "final_project" ? Math.max(base, awarded) : base + awarded;

  const next: ComponentScores = {
    quizScore: Math.max(0, Math.round(current.quizScore)),
    assignmentScore: Math.max(0, Math.round(current.assignmentScore)),
    participationScore: Math.max(0, Math.round(current.participationScore)),
    finalProjectScore: Math.max(0, Math.round(current.finalProjectScore)),
  };
  next[column] = Math.min(raw, caps[column]);

  return { ...next, totalScore: Math.min(totalOf(next), courseMaxScore()) };
}

/** True when this event can move a leaderboard row at all. */
export function isMeaningfulEvent(event: ScoringEvent): boolean {
  if (!Number.isInteger(event.studentId) || event.studentId <= 0) return false;
  if (!Number.isFinite(event.points)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rank ordering
// ---------------------------------------------------------------------------

/**
 * The minimum a row must expose to be ranked. Extra fields are preserved by
 * `assignRanks`, so callers can pass their full display row through.
 */
export interface RankableRow {
  studentId: number;
  totalScore: number;
  /** Mean instructor star rating across graded submissions. Null = never rated. */
  avgStars: number | null;
  finalProjectScore: number;
  /** Epoch milliseconds of the student's earliest submission. Null = none yet. */
  firstSubmittedAtMs: number | null;
}

export type Ranked<T> = T & { ranking: number };

/**
 * =========================== TIE-BREAK RULE (documented) ====================
 * Order is, in strict precedence:
 *
 *   1. totalScore            DESC
 *   2. avgStars              DESC, nulls last
 *   3. finalProjectScore     DESC
 *   4. firstSubmittedAtMs    ASC (earliest first), nulls last
 *   5. studentId             ASC          <-- the determinism backstop
 *
 * Keys 1-4 are the order the leaderboard skill specifies. Key 5 is mine, and it
 * is the important one: keys 1-4 can all tie simultaneously, and in a fresh
 * cohort they always do (everyone 0 / null / null). With only keys 1-4, the
 * final order would be whatever order Postgres happened to return rows in,
 * which is not stable across rebuilds — so ranks would flicker between page
 * loads for no reason at all, which is worse than an arbitrary-but-fixed order.
 * `studentId` is immutable and unique, so appending it makes the comparator a
 * TOTAL order: exactly one valid arrangement of any row set.
 *
 * Because the order is total, ranks are assigned ORDINALLY (1..N, like SQL
 * ROW_NUMBER) rather than competition-style (1,1,3). No duplicates, no gaps.
 * The trade-off, stated plainly: two genuinely equal students see different
 * ranks. That is the cost of a stable board, and the alternative (shared rank
 * 1, then a gap) breaks "rank N of M" arithmetic in the UI.
 *
 * Nulls sort last on keys 2 and 4 so that "not yet rated" / "never submitted"
 * never beats a real, worse value — an unrated student must not out-rank a
 * 1-star one.
 * ===========================================================================
 */
export function compareForRank(a: RankableRow, b: RankableRow): number {
  // 1) total score, descending
  if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;

  // 2) average instructor stars, descending, nulls last
  const starCmp = compareDescNullsLast(a.avgStars, b.avgStars);
  if (starCmp !== 0) return starCmp;

  // 3) final project score, descending
  if (a.finalProjectScore !== b.finalProjectScore) {
    return b.finalProjectScore - a.finalProjectScore;
  }

  // 4) earliest submission first, nulls last
  const timeCmp = compareAscNullsLast(a.firstSubmittedAtMs, b.firstSubmittedAtMs);
  if (timeCmp !== 0) return timeCmp;

  // 5) deterministic backstop
  return a.studentId - b.studentId;
}

function compareDescNullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return b - a;
}

function compareAscNullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return a - b;
}

/**
 * Sort `rows` into leaderboard order and stamp an ordinal `ranking` on each.
 *
 * - Empty input returns an empty array. A fresh cohort with no scores is a
 *   normal state, not an error.
 * - A single row gets `ranking: 1`.
 * - The input array is not mutated (callers often hold the fetched rows).
 */
export function assignRanks<T extends RankableRow>(rows: readonly T[]): Ranked<T>[] {
  return [...rows]
    .sort(compareForRank)
    .map((row, index) => ({ ...row, ranking: index + 1 }));
}

/**
 * Rank of one student within `rows`, or null when they are not in the set.
 * Used by /api/leaderboard/me so the "you are 7th of 52" line cannot disagree
 * with the table above it — both come from this one comparator.
 */
export function rankOf(rows: readonly RankableRow[], studentId: number): number | null {
  const found = assignRanks(rows).find((r) => r.studentId === studentId);
  return found ? found.ranking : null;
}
