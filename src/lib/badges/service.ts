// =============================================================================
// BADGE SERVICE — gather facts, evaluate criteria, let the database award.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// The three-step orchestration, and the ONLY place the three are joined:
//
//   ./facts.ts      one query  -> a flat snapshot of scalars
//   ./evaluate.ts   pure       -> everything the student now qualifies for
//   ./award.ts      one INSERT per badge, de-duplicated BY POSTGRES
//
// Note what this function does NOT do: it does not ask which badges the student
// already has, and it does not filter the evaluated list against them. That
// omission is the entire correctness argument of the feature — the "already has
// it" question is answered by `badge_awards_student_type_idx` inside the INSERT,
// because answering it in application code first is the check-then-insert race
// written up at src/lib/badges/award.ts:8-24 and src/db/schema.badges.ts:66-91.
//
// A "wasteful" INSERT that conflicts is the correct implementation. Five
// ON CONFLICT DO NOTHING inserts that all conflict cost one round trip each and
// change nothing; a SELECT that skips them costs a round trip too and is wrong.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import type { Db } from "./award";
import { awardBadges, type AwardResult } from "./award";
import { evaluateBadges } from "./evaluate";
import { loadBadgeFacts } from "./facts";
import type { BadgeType } from "./catalogue";

export interface EvaluationReport {
  studentId: number;
  /** Badges the student qualified for in this pass, whether or not newly awarded. */
  qualified: BadgeType[];
  /** Badges THIS pass inserted. Empty on almost every run, which is correct. */
  newlyAwarded: BadgeType[];
  /** Wall-clock duration, in milliseconds. */
  durationMs: number;
}

/**
 * Evaluate every criterion for one student and award what they have earned.
 *
 * NEVER THROWS. Both callers are side-effect paths off something more important —
 * a grading event (./on-scoring-event.ts) and a page read (./queries.ts) — and
 * neither may be failed by a gamification feature. A caller that wants the error
 * should call the three steps itself; this is the safe composition.
 *
 * The report is returned rather than only logged so that a test, an operator
 * script, or the read path can act on "was anything new awarded?" — which is the
 * hook a future notification would use. See ./on-scoring-event.ts for why no
 * notification is sent today.
 */
export async function evaluateAndAwardBadges(
  studentId: number,
  options: { courseId?: number | null; client?: Db } = {},
): Promise<EvaluationReport> {
  const startedAt = Date.now();
  const id = Math.trunc(studentId);
  const empty: EvaluationReport = {
    studentId: id,
    qualified: [],
    newlyAwarded: [],
    durationMs: 0,
  };

  if (!Number.isSafeInteger(id) || id <= 0) {
    // A non-positive id is a caller bug, not a runtime condition. Logged and
    // dropped rather than thrown, for the reason in the doc comment.
    console.warn("[badges] refusing to evaluate a non-positive student id", { studentId });
    return { ...empty, durationMs: Date.now() - startedAt };
  }

  try {
    const facts = await loadBadgeFacts(id, {
      courseId: options.courseId ?? null,
      client: options.client,
    });
    const earned = evaluateBadges(facts);

    if (earned.length === 0) {
      return { ...empty, durationMs: Date.now() - startedAt };
    }

    const results: AwardResult[] = await awardBadges(id, earned, options.client);

    const report: EvaluationReport = {
      studentId: id,
      qualified: earned.map((e) => e.type),
      newlyAwarded: results.filter((r) => r.created).map((r) => r.type),
      durationMs: Date.now() - startedAt,
    };

    // Logged at info, and ONLY when something was actually awarded. Logging every
    // evaluation would print on every grading event for every student for the rest
    // of the course, because `qualified` stays non-empty forever once the first
    // badge is earned — the caution attached to `created` at ./award.ts:74-82.
    if (report.newlyAwarded.length > 0) {
      console.info(
        `[badges] awarded ${report.newlyAwarded.join(", ")} to student ${id} ` +
          `in ${report.durationMs} ms`,
      );
    }

    return report;
  } catch (error) {
    console.error(`[badges] evaluation failed after ${Date.now() - startedAt} ms`, {
      studentId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...empty, durationMs: Date.now() - startedAt };
  }
}
