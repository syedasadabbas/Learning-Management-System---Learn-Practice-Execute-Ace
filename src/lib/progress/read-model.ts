// =============================================================================
// WEEK PROGRESS READ MODEL — owned by the `progress-tracking` stream.
// -----------------------------------------------------------------------------
// This file landed as a stub so that `course-content` (week list lock state) and
// `leaderboard` could call it and compile. Only the BODY has been replaced. The
// exported signature is UNCHANGED and must stay unchanged:
//
//     export async function getWeekProgress(studentId: number): Promise<WeekProgress[]>
//
// The `WeekProgress` type is frozen in src/lib/contracts/events.ts and is not
// touched here. Where the dashboard needs more than the frozen shape allows
// (week deadlines, score component breakdown) it calls
// `getWeekProgressDetail()` below instead — an ADDITIVE export, so no existing
// caller is affected.
//
// Composition:
//   query.ts      one SQL statement, one row per week (no N+1)
//   unlock.ts     pure unlock chain, via scoring.shouldUnlockNextWeek
//   score.ts      pure points arithmetic, via scoring.ts helpers
//   aggregate.ts  pure row -> WeekProgress mapping
// =============================================================================

import type { WeekProgress } from "@/lib/contracts/events";

import { buildWeekProgress, type WeekProgressDetail } from "./aggregate";
import { fetchWeekAggregates } from "./query";

/**
 * Per-week progress for one student, ordered by week number ascending.
 *
 * This is the single read model for "what has this student done and what can
 * they see". course-content uses it for lock badges, the dashboard uses it for
 * completion, and the leaderboard uses it for aggregation — one query shape
 * rather than three divergent ones.
 *
 * Week 1 is always unlocked. Week N>1 is unlocked when week N-1's best quiz
 * percentage is at or above QUIZ_PASS_PERCENT (see scoring.shouldUnlockNextWeek).
 *
 * `lectureTotal` is included so a caller can render "2 of 3 lectures" without a
 * second query — that promise is the reason the aggregation happens in SQL.
 *
 * Costs exactly ONE database round trip regardless of the course length. Returns
 * `[]` for an unknown student or an empty course; never throws for a student
 * with no activity, who correctly sees week 1 unlocked and the rest locked.
 */
export async function getWeekProgress(studentId: number): Promise<WeekProgress[]> {
  const rows = await fetchWeekAggregates(studentId);
  return buildWeekProgress(rows);
}

/**
 * Same data plus the fields the frozen `WeekProgress` type cannot carry:
 * `dueAt`, the score `breakdown`, and quiz/assignment counts.
 *
 * Additive on purpose. Widening `WeekProgress` would have meant editing a frozen
 * contract file that another stream compiles against; a second, richer return
 * type costs nothing and breaks nobody. Every `WeekProgressDetail` is a valid
 * `WeekProgress`.
 */
export async function getWeekProgressDetail(studentId: number): Promise<WeekProgressDetail[]> {
  const rows = await fetchWeekAggregates(studentId);
  return buildWeekProgress(rows);
}
