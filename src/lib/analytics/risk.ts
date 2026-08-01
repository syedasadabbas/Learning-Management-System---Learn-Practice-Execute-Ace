// =============================================================================
// AT-RISK SCORING (PURE) — advanced-analytics extension.
// -----------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL, GIVEN `getAtRiskStudents` ALREADY DOES SOMETHING
// `src/lib/instructor/analytics.ts:getAtRiskStudents` answers exactly one
// question: "who is carrying >= 3 unresolved penalties". That is a LAGGING
// signal — a penalty is issued after the deadline has already been missed, so a
// student who has silently stopped opening the course has a clean penalty record
// until the first deadline passes, and appears nowhere on that list. The roadmap
// asks for "predictive alerts for at-risk students" (IMPLEMENTATION_ROADMAP.md,
// Phase 2 feature 7), which is a different question and needs the leading
// signals: silence, un-attempted quizzes, work handed in but never marked.
//
// The existing penalty list is NOT replaced and NOT recomputed. It still renders
// on both analytics pages from `getCohortAnalytics`. This module ranks the same
// cohort by a different, forward-looking measure and both are shown, labelled.
//
// WHY THE ARITHMETIC IS HERE AND NOT IN SQL
// The same reason `src/lib/progress/query.ts` gives for keeping scoring out of
// its statement: a weight expressed in SQL is a weight no unit test can reach.
// The statement in ./queries.ts returns FACTS (counts, timestamps); this file
// turns them into a score and is tested in risk.test.ts with no database.
//
// THIS DELIBERATELY DOES NOT PRODUCE A GRADE OR A TOTAL. Nothing here divides
// points or predicts a mark. Points come from src/lib/contracts/scoring.ts and
// only from there (see ./distribution.ts, which calls `letterGrade`). A risk
// score is an ORDERING over students for an instructor's attention, on an
// arbitrary 0-100 scale that means nothing outside this list, and it is labelled
// as such in the UI.
// =============================================================================

/** The facts ./queries.ts returns for one student. No derived values. */
export interface RiskSignals {
  studentId: number;
  name: string;
  /** Unresolved penalties. */
  penaltyCount: number;
  /** Sum of `penalties.penalty_points` over unresolved rows. */
  penaltyPoints: number;
  /** Weeks in the course that this student has never attempted a quiz for. */
  weeksWithoutQuizAttempt: number;
  /** Total weeks in the course, i.e. the denominator for the field above. */
  weekCount: number;
  /** Submissions in `status <> 'graded'` — work handed in and not yet marked. */
  ungradedSubmissionCount: number;
  /** Submissions flagged `is_late`. */
  lateSubmissionCount: number;
  /**
   * Whole days since this student's most recent recorded activity, or null when
   * they have never done anything at all. Null is the WORST case, not a missing
   * one — see `daysSilentWeight`.
   */
  daysSinceLastActivity: number | null;
}

export type RiskBand = "low" | "watch" | "high";

export interface RiskAssessment extends RiskSignals {
  /** 0..100. An ordering, not a percentage of anything. */
  score: number;
  band: RiskBand;
  /** Human-readable signals that actually fired, in weight order. */
  reasons: string[];
}

/**
 * Silence, weighted. 0 points at 0-3 days, rising to the full 40 at 21 days.
 *
 * `null` (never active) scores the maximum: a student who has not logged one
 * event all term is the single clearest case this list exists to surface, and
 * treating an absent timestamp as "no signal" would rank them SAFEST — the exact
 * inversion that makes an at-risk list worse than no list.
 *
 * The 21-day ceiling is a judgement call, stated rather than hidden: the course
 * is 4 weeks (appConfig.course.durationWeeks), so three weeks of silence is most
 * of it and there is nothing left to distinguish beyond that.
 */
export function daysSilentWeight(daysSinceLastActivity: number | null): number {
  if (daysSinceLastActivity === null) return 40;
  if (daysSinceLastActivity <= 3) return 0;
  const span = Math.min(daysSinceLastActivity, 21) - 3; // 0..18
  return Math.round((span / 18) * 40);
}

const MAX_SCORE = 100;

/**
 * Score one student, 0..100. Deterministic, order-independent, no clock read:
 * `daysSinceLastActivity` is measured once in SQL so every student on the page
 * is measured against the same instant.
 *
 * Weights (sum 100): silence 40, un-attempted quizzes 30, unresolved penalties
 * 20, never-marked work 10. Silence and missing quizzes lead the deadline;
 * penalties follow it; ungraded work is the weakest signal of the four and is
 * partly an instructor-side backlog, which is why it cannot on its own push a
 * student past the "watch" line.
 */
export function assessRisk(signals: RiskSignals): RiskAssessment {
  const reasons: string[] = [];

  const silence = daysSilentWeight(signals.daysSinceLastActivity);
  if (silence > 0) {
    reasons.push(
      signals.daysSinceLastActivity === null
        ? "no recorded activity at all"
        : `no activity for ${signals.daysSinceLastActivity} days`,
    );
  }

  // Un-attempted quizzes, as a share of the course. A zero week count means the
  // course has no weeks yet: no denominator, so no claim (see the "zero
  // denominators" rule in src/lib/instructor/rates.ts).
  const missedShare =
    signals.weekCount > 0
      ? Math.min(signals.weeksWithoutQuizAttempt, signals.weekCount) / signals.weekCount
      : 0;
  const missed = Math.round(missedShare * 30);
  if (signals.weeksWithoutQuizAttempt > 0 && signals.weekCount > 0) {
    reasons.push(
      `${signals.weeksWithoutQuizAttempt} of ${signals.weekCount} weeks with no quiz attempt`,
    );
  }

  // Penalties: 3 unresolved is the threshold the existing list uses, so 3 is
  // where this component saturates. Kept consistent on purpose — two different
  // penalty thresholds on one page is a support question.
  const penalty = Math.round((Math.min(signals.penaltyCount, 3) / 3) * 20);
  if (signals.penaltyCount > 0) {
    reasons.push(
      `${signals.penaltyCount} unresolved ${signals.penaltyCount === 1 ? "penalty" : "penalties"}` +
        (signals.penaltyPoints > 0 ? ` (${signals.penaltyPoints} points)` : ""),
    );
  }

  const ungraded = Math.min(signals.ungradedSubmissionCount, 2) * 5; // 0, 5 or 10
  if (signals.ungradedSubmissionCount > 0) {
    reasons.push(`${signals.ungradedSubmissionCount} submission(s) awaiting marking`);
  }

  const score = Math.min(MAX_SCORE, silence + missed + penalty + ungraded);

  return { ...signals, score, band: bandFor(score), reasons };
}

/**
 * Score -> band. 50 is the "high" line because it cannot be reached by any single
 * component except total silence (40) plus one more signal, so a student is only
 * ever escalated on corroborating evidence.
 */
export function bandFor(score: number): RiskBand {
  if (score >= 50) return "high";
  if (score >= 25) return "watch";
  return "low";
}

/**
 * Rank a cohort, worst first, dropping the "low" band.
 *
 * A list of 80 students of whom 6 need help is not an alert, it is a table, and
 * an instructor stops reading it. `limit` caps what reaches the page.
 * Ties break on studentId so the order is stable between renders — an alert list
 * that reshuffles on refresh reads as broken.
 */
export function rankRisk(
  signals: readonly RiskSignals[],
  limit = 10,
): RiskAssessment[] {
  return signals
    .map(assessRisk)
    .filter((a) => a.band !== "low")
    .sort((a, b) => b.score - a.score || a.studentId - b.studentId)
    .slice(0, limit);
}
