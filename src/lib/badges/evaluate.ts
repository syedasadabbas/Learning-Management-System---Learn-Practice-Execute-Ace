// =============================================================================
// BADGE CRITERIA — pure, database-free, unit-tested.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// The decision "has this student earned badge X?" and nothing else. No reads, no
// writes, no clock, no randomness. Kept separate from ./facts.ts for the reason
// src/lib/progress/score.ts:12-14 gives for the identical split: the interesting
// cases are the boundaries (exactly 100% vs 99.99%, the last assignment submitted
// one second late), and asserting those against a real database means arranging
// fixtures for each one.
//
// -----------------------------------------------------------------------------
// EVERY RULE IS MONOTONE, AND THAT IS A DESIGN CONSTRAINT, NOT AN OBSERVATION.
//
// `badge_awards` has no un-award path — one row per (student, badge), inserted
// once, never deleted (src/db/schema.badges.ts:110-116). So a criterion that can
// go from true back to false would produce a badge the student keeps but can no
// longer be told why they have. Every rule below is therefore phrased over a
// high-water mark or a count that only grows:
//
//   * `bestQuizPercent` is a MAX over attempts, so a worse later attempt cannot
//     revoke `perfect_quiz`. (This matters: src/lib/quizzes/** allows up to three
//     attempts and counts the best.)
//   * `solvedProblemCount` counts DISTINCT problems ever fully passed.
//   * `totalScore` is the leaderboard total, which is clamped but not reset
//     (src/lib/leaderboard/rebuild.ts:196-206).
//
// `all_assignments_ontime` is the one that needed care and is documented on its
// own rule below — it is the only criterion whose denominator can grow.
//
// -----------------------------------------------------------------------------
// THIS FILE DOES NOT DECIDE WHETHER TO INSERT. It returns everything the student
// currently qualifies for, including badges they were awarded months ago;
// ./award.ts hands the "already has it" question to the unique index in Postgres
// rather than filtering here. Filtering here would be the check-then-insert race
// this whole feature is built to avoid — see src/db/schema.badges.ts:66-91.
// =============================================================================

import { BADGE_TYPES, CODING_GENIUS_PROBLEMS, highScoreThreshold, type BadgeType } from "./catalogue";

/**
 * Everything the criteria need, gathered once per evaluation by ./facts.ts.
 *
 * A FLAT SNAPSHOT OF SCALARS rather than a handle the rules can query through.
 * That is what makes the rules pure, and it also caps the cost of an evaluation
 * at one round trip regardless of how many badges exist — which matters because
 * evaluation runs on the grading path, and src/db/index.ts measured a query on an
 * already-open pooled connection at ~245 ms against this Neon instance.
 */
export interface BadgeFacts {
  studentId: number;

  /** Assignment submissions this student has, at any status. */
  submissionCount: number;

  /**
   * Highest percentage over EVERY quiz attempt, null when they have never
   * attempted one. A max, so it cannot fall — see the monotonicity note above.
   */
  bestQuizPercent: number | null;
  /** The quiz the best percentage came from, for the `evidence` blob. Null iff above is null. */
  bestQuizId: number | null;

  /**
   * How many assignments exist in the course being evaluated. The DENOMINATOR of
   * `all_assignments_ontime`, and the only fact here that can grow for reasons
   * that have nothing to do with the student.
   */
  assignmentTotal: number;
  /** Distinct assignments this student submitted with `is_late = false`. */
  onTimeAssignmentCount: number;
  /** Distinct assignments this student submitted with `is_late = true`. */
  lateAssignmentCount: number;

  /** Distinct coding problems with at least one run that passed every test. */
  solvedProblemCount: number;

  /** The student's leaderboard total, 0 when they have no row yet. */
  totalScore: number;
  /** `courseMaxScore()` for the course length in effect. Passed in, never assumed. */
  maxScore: number;
}

/** A badge the student qualifies for right now, with the numbers that say so. */
export interface EarnedBadge {
  type: BadgeType;
  /** Stored on the row so a human can later see WHY without re-deriving it. */
  evidence: Record<string, number | string | boolean>;
}

/**
 * One criterion. Returns the evidence when earned, null when not.
 *
 * Returning the evidence rather than a boolean means the numbers that justified
 * the award are produced by the same expression that tested it, so they cannot
 * describe a different comparison than the one that fired.
 */
type Criterion = (facts: BadgeFacts) => EarnedBadge["evidence"] | null;

const CRITERIA: Record<BadgeType, Criterion> = {
  /**
   * Any submission at all. Deliberately does NOT require the submission to be
   * graded: the roadmap's own description is "first submission"
   * (IMPLEMENTATION_ROADMAP.md:275-279), and this badge is the encouragement for
   * the act of handing something in.
   *
   * Worth being explicit that this is NOT the mistake scoring.ts:65-94 was
   * changed to fix today. That change stopped an ungraded submission SCORING 40
   * marks. A badge is not marks — it moves no total, no rank and no letter grade
   * (src/db/schema.badges.ts:56-64) — so "you handed something in" is a fair
   * thing to recognise where "you earned 40%" was not.
   */
  first_submission: (f) =>
    f.submissionCount > 0 ? { submissionCount: f.submissionCount } : null,

  /**
   * A quiz attempt at exactly 100%.
   *
   * `>= 100` rather than `=== 100`: `quiz_attempts.percentage` is a
   * `decimal(5,2)` (src/db/schema.ts:281) which arrives from node-postgres as a
   * STRING like "100.00", and ./facts.ts parses it with Number(). An equality
   * test against a parsed decimal is the kind of comparison that works until a
   * grader rounds 99.995 up. Nothing can exceed 100 (the grader clamps per
   * question — schema.ts invariant I5), so `>=` adds no false positives.
   */
  perfect_quiz: (f) =>
    f.bestQuizPercent !== null && f.bestQuizPercent >= 100
      ? { percentage: f.bestQuizPercent, quizId: f.bestQuizId ?? 0 }
      : null,

  /**
   * EVERY assignment in the course submitted, and NONE of them late.
   *
   * Three guards, each for a specific wrong answer:
   *
   *   `assignmentTotal > 0` — without it, a course with no assignments seeded
   *   awards this to every student on their first grading event, because "all
   *   zero of them were on time" is vacuously true. That is not a hypothetical:
   *   a fresh database has courses and weeks before it has assignments.
   *
   *   `lateAssignmentCount === 0` — the "none of them late" half. Checked
   *   separately from the count rather than inferred from it, because a student
   *   can submit the same assignment twice (once late) and both rows exist.
   *
   *   `onTimeAssignmentCount >= assignmentTotal` rather than `===` — the counts
   *   are DISTINCT assignments so they cannot exceed the total, but `>=` means a
   *   denominator that shrinks (an assignment deleted by an admin) cannot silently
   *   un-earn the badge for a student who had it. See the monotonicity note in
   *   this file's header: this is the one criterion whose denominator moves, and
   *   `>=` is what keeps it monotone in the direction that matters.
   */
  all_assignments_ontime: (f) =>
    f.assignmentTotal > 0 &&
    f.lateAssignmentCount === 0 &&
    f.onTimeAssignmentCount >= f.assignmentTotal
      ? { assignmentTotal: f.assignmentTotal, onTime: f.onTimeAssignmentCount }
      : null,

  /** CODING_GENIUS_PROBLEMS distinct problems fully solved. Threshold in ./catalogue.ts. */
  coding_genius: (f) =>
    f.solvedProblemCount >= CODING_GENIUS_PROBLEMS
      ? { solved: f.solvedProblemCount, required: CODING_GENIUS_PROBLEMS }
      : null,

  /**
   * Total score in the A band.
   *
   * The threshold is `highScoreThreshold(f.maxScore)` — derived from the SAME
   * `letterGrade` bands the gradebook uses, and from the maxScore in the facts
   * rather than from a default, so a course of a different length moves the bar
   * with it. A literal here would repeat the rotted-constant defect that
   * src/lib/contracts/scoring.ts:128-131 records.
   */
  high_score: (f) => {
    const threshold = highScoreThreshold(f.maxScore);
    return f.totalScore >= threshold
      ? { totalScore: f.totalScore, threshold, maxScore: f.maxScore }
      : null;
  },
};

/**
 * Every badge `facts` currently qualifies for, in catalogue order.
 *
 * Includes badges the student already holds. That is not an oversight: see this
 * file's header, and src/db/schema.badges.ts:66-91 for why the "already holds it"
 * decision belongs to the database and not to a filter here.
 *
 * A criterion that THROWS is treated as "not earned" and logged rather than
 * allowed to abort the whole evaluation. One malformed fact (a NaN out of a
 * decimal parse) would otherwise cost the student every other badge in the same
 * pass, and the evaluation runs off the back of a grading event whose failure
 * mode must stay "no badge" and never "no grade".
 */
export function evaluateBadges(facts: BadgeFacts): EarnedBadge[] {
  const earned: EarnedBadge[] = [];

  for (const type of BADGE_TYPES) {
    try {
      const evidence = CRITERIA[type](facts);
      if (evidence) earned.push({ type, evidence });
    } catch (error) {
      console.error(`[badges] criterion ${type} threw; treating as not earned`, {
        studentId: facts.studentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return earned;
}

/** Exported for the unit tests, so a new badge cannot ship with no criterion. */
export const CRITERION_TYPES = Object.keys(CRITERIA) as BadgeType[];
