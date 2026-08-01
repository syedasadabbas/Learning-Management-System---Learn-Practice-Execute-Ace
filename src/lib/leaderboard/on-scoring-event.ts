// =============================================================================
// CROSS-STREAM HOOK — owned by the `leaderboard` stream.
// -----------------------------------------------------------------------------
// The BODY below is the leaderboard implementation. The exported SIGNATURE is
// frozen and was landed as a stub ahead of this work so that `quizzes` and
// `submissions` could call it and compile on their own branches:
//
//     export async function onScoringEvent(event: ScoringEvent): Promise<void>
//
// Do not rename it, change its parameters, or change its return type. Its
// callers live on other branches; a signature change breaks them silently at
// merge time. `ScoringEvent` is frozen in src/lib/contracts/events.ts.
//
// All durations are milliseconds (house rule 5).
// =============================================================================

import type { ScoringEvent } from "@/lib/contracts/events";
// Owned by the badges stream. Imported rather than the reverse so that the frozen
// `onScoringEvent` signature stays the single entry point every producer knows
// about; see the call site below for the whole argument.
import { awardBadgesForScoringEvent } from "@/lib/badges/on-scoring-event";
import { applyScoringEvent } from "./rebuild";

/**
 * Record a scoring change and refresh the caller's leaderboard standing.
 *
 * Callers should treat this as fire-and-forget for correctness purposes: a
 * failure to update a ranking must never roll back the grade that caused it.
 * Await it, but do not let a rejection propagate into the grading path.
 *
 * What it does (see ./rebuild.ts for the transaction and locking detail):
 *   1. Resolves the student and their cohort from `users` — `event.cohortId` is
 *      a hint, not truth — and drops the event if the id is not a student, so
 *      staff never appear on a student leaderboard.
 *   2. Upserts the student's `leaderboard` row (unique on `student_id`), adding
 *      `event.points` to the column `event.source` names, clamped to the course
 *      ceiling derived from scoring.ts, and recomputes `totalScore`.
 *   3. Renumbers `ranking` across the whole cohort under a cohort-scoped
 *      advisory lock, so two concurrent grading events cannot interleave into
 *      duplicate or gapped ranks.
 *
 * REPEAT-SAFETY. Callers invoke this outside their transaction and swallow
 * rejections, so it can be delivered more than once for the same scoring change.
 * Three properties keep that from corrupting the board:
 *   - the write is an UPSERT, so a retry never duplicates a row;
 *   - `final_project` is applied as max(existing, points), so re-delivering the
 *     same final grade is an exact no-op;
 *   - every component is clamped to its course-wide ceiling, so a double-counted
 *     weekly award can at worst move a student to their true maximum — it cannot
 *     manufacture a total above `courseMaxScore()` and reorder the cohort.
 * `rebuildLeaderboard(cohortId)` is the exact repair path if a component ever
 * does drift.
 *
 * NEVER THROWS. Even though every documented caller already swallows rejections,
 * this function also swallows its own: relying on ten separate call sites each
 * remembering their try/catch is how a leaderboard bug eventually rolls back a
 * grade. The error is logged with the event so the failure is diagnosable.
 */
export async function onScoringEvent(event: ScoringEvent): Promise<void> {
  const startedAt = Date.now();

  try {
    const result = await applyScoringEvent(event);

    if (!result.applied) {
      console.warn(
        `[leaderboard] scoring event ignored (${result.skippedReason})`,
        { studentId: event.studentId, source: event.source, weekId: event.weekId },
      );
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[leaderboard] student ${event.studentId} -> ${result.totalScore} pts, ` +
          `${result.rowsRanked} rank(s) changed in ${result.durationMs} ms`,
      );
    }

    // -----------------------------------------------------------------------
    // SECOND CONSUMER OF THIS EVENT: badges (badges stream, roadmap feature 3).
    //
    // Added here, in the leaderboard's file, by the badges stream, and the reason
    // is that this is the ONLY fan-out point for "a student's score changed".
    // Every producer already calls it — src/lib/quizzes/service.ts:570,
    // src/lib/submissions/grade.ts:195, src/lib/attendance/service.ts:156 — so
    // hooking here touches one file instead of three, and a fourth producer added
    // later gets badges without remembering to. The alternative the roadmap
    // suggested (a badge check at each of those three call sites, each with its
    // own list of which badges to check) is argued against at length in
    // src/lib/badges/on-scoring-event.ts:8-45. A separate event bus for the same
    // event would have been the worse duplication.
    //
    // AFTER the upsert, not before, and not concurrently: the `high_score` badge
    // is defined against `leaderboard.total_score`, so evaluating first would make
    // it lag one event behind the score that earns it.
    //
    // CANNOT AFFECT THE LEADERBOARD OR THE GRADE. `awardBadgesForScoringEvent`
    // never throws (it swallows internally, and this file swallows again), and it
    // writes only to `badge_awards` — a table nothing in the scoring path reads.
    // Awarding is de-duplicated by a unique index rather than by being called once,
    // so a re-delivered event is a no-op: see src/lib/badges/award.ts:8-52. That is
    // the same REPEAT-SAFETY property this function's own doc comment above claims
    // for the leaderboard write, held for the same reason.
    await awardBadgesForScoringEvent(event);
  } catch (error) {
    // Swallowed on purpose — see the doc comment. A leaderboard failure must
    // never surface as a failed grading request.
    console.error(
      `[leaderboard] failed to apply scoring event after ${Date.now() - startedAt} ms`,
      {
        studentId: event.studentId,
        cohortId: event.cohortId,
        source: event.source,
        weekId: event.weekId,
        points: event.points,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
