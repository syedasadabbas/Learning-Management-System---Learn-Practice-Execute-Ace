// =============================================================================
// THE TRIGGER — badges ride the EXISTING scoring-event mechanism.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// NO SECOND EVENT BUS WAS BUILT, and that was the main design decision in this
// feature. Written out here because the roadmap asks for something else.
//
// IMPLEMENTATION_ROADMAP.md:266-269 says to "Hook badge triggers in: Quiz
// submission -> check perfect_quiz; Assignment submission -> check
// first_submission; Leaderboard update -> check high_score, consecutive_days".
// Three call sites, in three different streams' files, each one deciding which
// subset of badges to evaluate. That was not done. Three reasons:
//
//  1. THE FAN-OUT POINT ALREADY EXISTS. `ScoringEvent`
//     (src/lib/contracts/events.ts:30-38) is the frozen cross-stream contract for
//     "a student's score changed", and `onScoringEvent`
//     (src/lib/leaderboard/on-scoring-event.ts) is the single function every
//     producer already calls: src/lib/quizzes/service.ts:570,
//     src/lib/submissions/grade.ts:195, src/lib/attendance/service.ts:156.
//     Badge awarding is triggered by exactly the same moments. Hooking the one
//     fan-out point touches ONE file instead of three, and it means a fourth
//     producer added later gets badges for free rather than being a fourth place
//     to remember.
//
//  2. PER-CALL-SITE BADGE LISTS GO STALE. "Quiz submission -> check perfect_quiz"
//     is wrong the moment a badge depends on two sources at once —
//     `all_assignments_ontime` and `high_score` already do — and it means adding a
//     badge requires editing other streams' files to widen their lists. Every
//     criterion is re-evaluated on every event instead. That is affordable because
//     the whole evaluation is ONE query (./facts.ts) plus pure functions, and it
//     makes the criteria the only place a badge is defined.
//
//  3. THE ALTERNATIVE MECHANISM WAS ALREADY CONSIDERED AND REJECTED FOR THIS
//     SHAPE OF WORK. src/lib/queue/types.ts:18-24 records the async-queues stream
//     rejecting the queue for leaderboard rebuilds on grading events, because
//     "deferring it would make the board lag the grade for a whole drain interval"
//     and the work is a single statement. Badge evaluation is one query and one
//     conflicting INSERT per badge; the same reasoning applies, so it runs inline
//     with the leaderboard rather than becoming a second JobKind. (Adding one
//     would also mean editing src/lib/queue/types.ts and ./registry.ts, which
//     belong to that stream.)
//
// WHAT THIS COSTS, stated plainly: badges are evaluated on a path that swallows its
// own failures, so a missed evaluation is silent. It is also self-healing, which is
// what makes that acceptable — the criteria are re-derived from live data on the
// NEXT scoring event for that student, and ./queries.ts re-evaluates on read as
// well, so a badge that was missed is awarded the next time anything happens. The
// only permanent loss is the moment of recognition, not the badge.
//
// -----------------------------------------------------------------------------
// WHY THIS TAKES THE WHOLE EVENT AND USES ONLY `studentId`.
//
// `event.source`, `event.points` and `event.weekId` are deliberately ignored: the
// criteria are course-wide and are computed from the database, not from the
// event's payload. Taking the whole `ScoringEvent` anyway keeps the signature
// aligned with the contract, so this stays a drop-in second consumer of the same
// event rather than a function with an invented parameter list.
//
// `event.cohortId` is likewise ignored, for the reason
// src/lib/leaderboard/rebuild.ts:225-227 gives for treating it as a HINT rather
// than truth: a caller can hold a stale one.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import type { ScoringEvent } from "@/lib/contracts/events";

import { evaluateAndAwardBadges } from "./service";
import type { EvaluationReport } from "./service";

/**
 * Evaluate and award badges for the student a scoring event names.
 *
 * NEVER THROWS — `evaluateAndAwardBadges` already swallows, and this adds no I/O
 * of its own. Both layers matter: the leaderboard learned the same lesson at
 * src/lib/leaderboard/on-scoring-event.ts:50-53 ("relying on ten separate call
 * sites each remembering their try/catch is how a leaderboard bug eventually rolls
 * back a grade").
 *
 * NO NOTIFICATION IS SENT. IMPLEMENTATION_ROADMAP.md:219 asks for "Badge
 * notifications when earned" and `notification_type` even lists `badge_earned`
 * (roadmap:51). Not shipped by this stream, deliberately: the mechanism it would
 * use is the async queue, whose `JOB_KINDS` union and `registry.ts` belong to the
 * async-queues stream (src/lib/queue/types.ts:67), and the notifications table
 * belongs to roadmap feature 1 — a different stream in this same wave. Inventing
 * either from this side would produce a second, colliding definition.
 *
 * TODO(badges): send a `badge_earned` notification for each entry in
 * `report.newlyAwarded`. The seam is already the right shape — `newlyAwarded` is
 * non-empty ONLY on the pass that actually inserted the row, because it is derived
 * from Postgres's own report of who won the INSERT (./award.ts:74-82). So one
 * notification per badge per student is guaranteed by the same unique index that
 * guarantees one award, with no extra de-duplication needed at the mail layer.
 */
export async function awardBadgesForScoringEvent(
  event: ScoringEvent,
): Promise<EvaluationReport> {
  try {
    return await evaluateAndAwardBadges(event.studentId);
  } catch (error) {
    // Belt AND braces. `evaluateAndAwardBadges` already swallows, so this branch
    // should be unreachable — but "never throws" is a promise the leaderboard hook
    // and, one layer further out, the quizzes and submissions grading paths are
    // relying on, and a guarantee that holds only because another module keeps a
    // promise it made in a comment is not a guarantee. The leaderboard reached the
    // same conclusion about its own callers at
    // src/lib/leaderboard/on-scoring-event.ts:50-53.
    console.error("[badges] scoring-event hook failed; no badge was awarded", {
      studentId: event.studentId,
      source: event.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      studentId: event.studentId,
      qualified: [],
      newlyAwarded: [],
      durationMs: 0,
    };
  }
}
