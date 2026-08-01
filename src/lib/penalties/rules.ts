// =============================================================================
// PENALTY RULES — owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// These rules are PURE: they decide what penalty is warranted and return it.
// Persisting the decision is the caller's job (`quizzes` and `submissions` both
// call in). Purity is what makes them unit-testable without a database and what
// lets two callers share one judgement.
//
// `evaluatePenalties(input: PenaltyRuleInput): PenaltyDecision[]` is a FROZEN
// signature — callers live on other branches. Only the body below changed.
//
// Thresholds come from `@/lib/contracts/scoring` (QUIZ_FAIL_PERCENT = 50,
// QUIZ_PASS_PERCENT = 70) and the grace window from
// `appConfig.schedule.gracePeriodDays`. No competing numbers are defined here;
// the only literals in this file are the demerit weights, which are this
// module's own concept and are defined once in SEVERITY_DEMERITS.
//
// UNITS: every duration in this module is in DAYS where the contract says days
// (`PenaltyRuleInput.daysLate`) and in MILLISECONDS everywhere a clock value is
// handled (see MS_PER_DAY). Metric throughout, per house rules.
// =============================================================================

import type { PenaltyDecision, PenaltyRuleInput } from "@/lib/contracts/events";
import { appConfig } from "@/lib/config/app.config";
import {
  QUIZ_FAIL_PERCENT,
  QUIZ_PASS_PERCENT,
  quizPointsFromPercent,
} from "@/lib/contracts/scoring";

/** One day in milliseconds. Metric units per house rules. */
export const MS_PER_DAY = 86_400_000;

export type PenaltySeverityName = PenaltyDecision["severity"];
export type PenaltyTypeName = PenaltyDecision["type"];

// ---------------------------------------------------------------------------
// SEVERITY LADDER — the judgement, written down
// ---------------------------------------------------------------------------
// The schema fixes three severities. Read them as escalating consequences, not
// as three labels for the same thing:
//
//   warning  "noticed, on your record, no action expected yet"
//            A first, small slip. Recoverable inside the same week.
//   notice   "formally on your record; the instructor is watching this student"
//            The slip is large enough that a human should look at it.
//   serious  "the learning outcome for this week is at risk"
//            Either nothing was delivered at all, or the assessment was failed
//            outright against the documented hard-fail line.
//
// `penaltyPoints` are DEMERIT points used for accumulation and escalation
// (see `escalationFor` in ./accumulation). They are deliberately NOT score
// deductions: the mark deduction for lateness already lives in
// scoring.assignmentPoints() and for a weak quiz in scoring.quizPointsFromPercent().
// Deducting again here would double-punish the same event.
export const SEVERITY_DEMERITS: Record<PenaltySeverityName, number> = {
  warning: 1,
  notice: 2,
  serious: 3,
};

// Lateness bands, in days PAST THE GRACE WINDOW (not past the deadline):
//   1..3 days  -> warning  (a weekend's slip; the syllabus tolerates it)
//   4..7 days  -> notice   (more than half a week behind; instructor should see it)
//   > 7 days   -> serious  (a full week behind — the next week's content has
//                           already started, so the outcome itself is at risk)
export const LATE_WARNING_MAX_DAYS = 3;
export const LATE_NOTICE_MAX_DAYS = 7;

/**
 * Days late after the cohort's grace window is applied.
 *
 * `PenaltyRuleInput.daysLate` is documented as days past the deadline, already 0
 * when on time (callers use `scoring.daysLate()`). This function does NOT
 * recompute dates — it only subtracts the grace window, which is the single
 * thing the rules are entitled to know about the calendar.
 *
 * A submission inside the grace window is NOT late and attracts no penalty at
 * all, so this returns 0 there and every lateness rule short-circuits.
 */
export function effectiveDaysLate(
  daysLate: number,
  gracePeriodDays: number = appConfig.schedule.gracePeriodDays,
): number {
  // Defensive: a caller that passes a negative value (submitted early) means the
  // same thing as on time. Never let it wrap into a "negative lateness".
  const raw = Number.isFinite(daysLate) ? Math.max(0, daysLate) : 0;
  const grace = Number.isFinite(gracePeriodDays) ? Math.max(0, gracePeriodDays) : 0;
  return Math.max(0, raw - grace);
}

/** Severity for a late-but-delivered submission, from days past the grace window. */
export function lateSeverity(effectiveLate: number): PenaltySeverityName {
  if (effectiveLate <= LATE_WARNING_MAX_DAYS) return "warning";
  if (effectiveLate <= LATE_NOTICE_MAX_DAYS) return "notice";
  return "serious";
}

function decision(
  type: PenaltyTypeName,
  severity: PenaltySeverityName,
  description: string,
): PenaltyDecision {
  return { type, severity, description, penaltyPoints: SEVERITY_DEMERITS[severity] };
}

// ---------------------------------------------------------------------------
// Single-rule entry points (the shape the SKILL contract names)
// ---------------------------------------------------------------------------

/**
 * Lateness rule for a submission that DID arrive.
 *
 * Returns null when the work is on time or inside the grace window. Never
 * returns `missed_deadline` — that is a different rule with different evidence
 * (see `evaluateMissedDeadlinePenalty`), which is how double-jeopardy is
 * prevented at the source.
 */
export function evaluateSubmissionPenalty(
  daysLate: number,
  gracePeriodDays: number = appConfig.schedule.gracePeriodDays,
): PenaltyDecision | null {
  const late = effectiveDaysLate(daysLate, gracePeriodDays);
  if (late === 0) return null;

  const severity = lateSeverity(late);
  const graceNote =
    gracePeriodDays > 0
      ? ` (${daysLate} day(s) past the deadline, ${gracePeriodDays}-day grace window applied)`
      : "";
  return decision(
    "late_submission",
    severity,
    `Assignment submitted ${late} day(s) late${graceNote}.`,
  );
}

/**
 * Missed-deadline rule: the window closed — grace included — with nothing
 * submitted at all.
 *
 * Always `serious`: unlike a late submission there is no work to assess, so the
 * week's assignment outcome is simply unmet. It does not escalate with time
 * because it is already at the top of the ladder on day one.
 *
 * Returns null while the student is still inside the grace window: they can
 * still deliver, so nothing has been missed yet.
 */
export function evaluateMissedDeadlinePenalty(
  daysLate: number,
  gracePeriodDays: number = appConfig.schedule.gracePeriodDays,
): PenaltyDecision | null {
  const late = effectiveDaysLate(daysLate, gracePeriodDays);
  if (late === 0) return null;

  return decision(
    "missed_deadline",
    "serious",
    `Deadline passed with no submission (${late} day(s) past the grace window).`,
  );
}

/**
 * Quiz rule. One band split, so `quiz_failure` and `low_score` can never both
 * fire for the same percentage:
 *
 *   percent <  QUIZ_FAIL_PERCENT (50)   -> quiz_failure, serious
 *        the documented hard-fail line; the week is not understood.
 *   50 <= percent < QUIZ_PASS_PERCENT (70) -> low_score
 *        passed the fail line but below the unlock line, so the next week stays
 *        locked. Severity splits on the scoring band rather than on a new
 *        literal: a percentage that still earns 15 of QUIZ_MAX is a `warning`;
 *        one that earns less than that is a `notice`, i.e. closer to failing.
 *   percent >= 70                        -> no penalty (unlock threshold met).
 *
 * `null` percent means no attempt has been recorded yet. That is not a quiz
 * penalty — a missing attempt is a deadline question, handled by
 * `evaluateMissedDeadlinePenalty` — so this returns null rather than guessing.
 */
export function evaluateQuizPenalty(percent: number | null): PenaltyDecision | null {
  if (percent == null || !Number.isFinite(percent)) return null;

  if (percent < QUIZ_FAIL_PERCENT) {
    return decision(
      "quiz_failure",
      "serious",
      `Quiz score ${percent}% is below the ${QUIZ_FAIL_PERCENT}% hard-fail threshold.`,
    );
  }

  if (percent < QUIZ_PASS_PERCENT) {
    // Reuse the scoring bands instead of inventing a second boundary here.
    const bandPoints = quizPointsFromPercent(percent);
    const severity: PenaltySeverityName = bandPoints >= 15 ? "warning" : "notice";
    return decision(
      "low_score",
      severity,
      `Quiz score ${percent}% is below the ${QUIZ_PASS_PERCENT}% pass threshold; the next week stays locked.`,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// The frozen aggregate entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate every penalty rule against a student's situation and return the
 * penalties that apply. An empty array means nothing is warranted.
 *
 * FROZEN SIGNATURE — `quizzes` and `submissions` call this. Do not rename it,
 * change its parameters, or change its return type.
 *
 * Precedence (NO DOUBLE JEOPARDY):
 *   - `missedEntirely === true`  -> at most one deadline penalty, and it is
 *     `missed_deadline`. `late_submission` is never emitted alongside it: one
 *     missed deadline is one offence, not two.
 *   - `missedEntirely === false` -> at most one deadline penalty, and it is
 *     `late_submission`.
 *   - The quiz rule is orthogonal (different assessment), so a student can hold
 *     one deadline penalty AND one quiz penalty. Within the quiz rule the bands
 *     are exclusive, so `quiz_failure` and `low_score` never co-occur.
 *
 * Result order is deterministic — deadline penalty first, then quiz — so callers
 * and tests can rely on it.
 *
 * Uses the cohort-independent default grace window from app.config. A caller
 * that knows the student's actual `cohorts.gracePeriodDays` should call
 * `evaluatePenaltiesWithGrace` instead; this wrapper exists because
 * `PenaltyRuleInput` is frozen and carries no cohort field.
 */
export function evaluatePenalties(input: PenaltyRuleInput): PenaltyDecision[] {
  return evaluatePenaltiesWithGrace(input, appConfig.schedule.gracePeriodDays);
}

/**
 * Same rules as `evaluatePenalties`, with the cohort's own grace window.
 *
 * Separate function rather than an extra parameter: `evaluatePenalties` is a
 * frozen signature and two live callers depend on it.
 */
export function evaluatePenaltiesWithGrace(
  input: PenaltyRuleInput,
  gracePeriodDays: number,
): PenaltyDecision[] {
  const decisions: PenaltyDecision[] = [];

  // -- Deadline: exactly one of missed_deadline / late_submission, or neither --
  const deadline = input.missedEntirely
    ? evaluateMissedDeadlinePenalty(input.daysLate, gracePeriodDays)
    : evaluateSubmissionPenalty(input.daysLate, gracePeriodDays);
  if (deadline) decisions.push(deadline);

  // -- Quiz: orthogonal assessment, exclusive bands within itself -------------
  const quiz = evaluateQuizPenalty(input.quizBestPercent);
  if (quiz) decisions.push(quiz);

  return decisions;
}
