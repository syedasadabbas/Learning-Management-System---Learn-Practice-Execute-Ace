// =============================================================================
// LATENESS — the cohort grace period applied on top of the scoring contract.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// The arithmetic of "how many days late" and "how many points is that worth"
// lives in src/lib/contracts/scoring.ts and is NOT duplicated here. `daysLate`
// and `assignmentPoints` are imported and called. The scoring contract's own
// header says why: divergent copies of these two functions are the classic cause
// of a grade on the submission page disagreeing with the leaderboard.
//
// What this module adds is the one thing scoring.ts cannot know about: the
// cohort's grace window (`cohorts.grace_period_days`, seeded to 2 from
// appConfig.schedule.gracePeriodDays). A submission inside the grace window is
// NOT late — zero days late, no penalty, `is_late` false — so the grace period is
// modelled by shifting the deadline the student is measured against, rather than
// by subtracting days afterwards.
//
// Shifting the deadline rather than subtracting matters at the boundary.
// `daysLate` rounds UP to whole days: a submission 25 hours past a raw deadline
// is 2 days late. Subtracting a 2-day grace from that gives 0 — correct here, but
// a submission 49 hours past would give 3-2=1 when the student is in fact only
// 1 hour past the end of a 2-day grace window, which should also round to 1.
// Shifting the deadline makes both cases fall out of one calculation.
// =============================================================================

import { assignmentPoints, assignmentPointsCeiling, daysLate } from "@/lib/contracts/scoring";

/** One day in milliseconds. Metric units per the house rules. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normalise a grace period read from the database.
 *
 * `cohorts.grace_period_days` is `notNull().default(0)`, but a student with no
 * cohort (`users.cohort_id` is nullable, and staff have none) yields `null` here.
 * No cohort means no negotiated grace, so the fallback is 0 — never a silent
 * extension of somebody's deadline.
 */
export function normaliseGraceDays(gracePeriodDays: number | null | undefined): number {
  if (gracePeriodDays == null || !Number.isFinite(gracePeriodDays)) return 0;
  return Math.max(0, Math.trunc(gracePeriodDays));
}

/**
 * The deadline a submission is actually measured against: `dueAt` plus the
 * cohort's grace days.
 */
export function effectiveDueAt(dueAt: Date, gracePeriodDays: number | null | undefined): Date {
  return new Date(dueAt.getTime() + normaliseGraceDays(gracePeriodDays) * DAY_MS);
}

export type Lateness = {
  /** Whole days past the end of the grace window. 0 when on time or inside grace. */
  daysLate: number;
  /**
   * Whole days past the RAW `dueAt`, grace NOT applied.
   *
   * Needed because `@/lib/penalties/rules` applies the grace window itself:
   * `evaluatePenaltiesWithGrace(input, graceDays)` calls its own
   * `effectiveDaysLate(input.daysLate, graceDays)`. Handing it the already-graced
   * `daysLate` above would subtract the grace period twice and quietly under-issue
   * every late-submission penalty. Scoring uses `daysLate`; penalties use this.
   */
  rawDaysLate: number;
  /** Mirrors `submissions.is_late`. True only when `daysLate > 0`. */
  isLate: boolean;
  /** `dueAt` + grace, for display ("counts as late after ...") and for tests. */
  effectiveDueAt: Date;
  /** True when the submission is past `dueAt` but still inside the grace window. */
  withinGrace: boolean;
};

/**
 * Days late for one submission, honouring the cohort grace window.
 *
 * Delegates the day count to `scoring.daysLate` so the rounding rule (ceiling,
 * i.e. any part of a day counts as a whole day) is defined in exactly one place.
 */
export function computeLateness(input: {
  submittedAt: Date;
  dueAt: Date;
  gracePeriodDays: number | null | undefined;
}): Lateness {
  const effective = effectiveDueAt(input.dueAt, input.gracePeriodDays);
  const late = daysLate(input.submittedAt, effective);
  return {
    daysLate: late,
    rawDaysLate: daysLate(input.submittedAt, input.dueAt),
    isLate: late > 0,
    effectiveDueAt: effective,
    withinGrace: late === 0 && input.submittedAt.getTime() > input.dueAt.getTime(),
  };
}

/**
 * The MOST a submission could still score, given only how late it is.
 *
 * The counterpart to `pointsForSubmission`, and the reason there are now two: the
 * scoring contract's `assignmentPoints` no longer awards the full 40 for
 * `stars: null` (an ungraded submission scores 0 — see the long note on that
 * function). Callers that want the late-penalty CEILING rather than an award have
 * to say so, and they say it here rather than by passing a null and relying on what
 * that used to mean.
 *
 * Concretely: the student's "Maximum still available" badge and the instructor
 * queue's projection. Both are answering "what is left to play for", not "what has
 * been earned".
 */
export function ceilingForSubmission(input: {
  submittedAt: Date;
  dueAt: Date;
  gracePeriodDays: number | null | undefined;
  latePenaltyPercentPerDay: number;
}): { points: number; lateness: Lateness } {
  const lateness = computeLateness(input);
  return {
    points: assignmentPointsCeiling({
      daysLate: lateness.daysLate,
      latePenaltyPercentPerDay: input.latePenaltyPercentPerDay,
    }),
    lateness,
  };
}

/**
 * Points for a GRADED assignment, from the submission's timing and star rating.
 *
 * A thin composition of `computeLateness` and the frozen `assignmentPoints`,
 * existing so that the grading write path, the read model, and the tests all go
 * through one call and cannot drift. The 20% late cap and the 10-points-per-star
 * shortfall both live in `assignmentPoints`; nothing about them is re-expressed
 * here.
 *
 * With `stars: null` this now returns 0, not 40. If you want the ceiling, call
 * `ceilingForSubmission` above — the change is deliberate and its reasoning is on
 * `assignmentPoints` in the scoring contract.
 */
export function pointsForSubmission(input: {
  submittedAt: Date;
  dueAt: Date;
  gracePeriodDays: number | null | undefined;
  latePenaltyPercentPerDay: number;
  /** 1..5, or null when the instructor has not rated it yet. */
  stars: number | null;
}): { points: number; lateness: Lateness } {
  const lateness = computeLateness(input);
  const points = assignmentPoints({
    daysLate: lateness.daysLate,
    latePenaltyPercentPerDay: input.latePenaltyPercentPerDay,
    stars: input.stars,
  });
  return { points, lateness };
}

/**
 * Has the deadline (including grace) passed with nothing handed in?
 *
 * Feeds `PenaltyRuleInput.missedEntirely`. The grace window is included on
 * purpose: issuing a missed-deadline warning to a student who is still inside
 * their grace period would be wrong, and the student would have no way to appeal
 * it other than by pointing at this code.
 */
export function deadlineHasPassed(input: {
  now: Date;
  dueAt: Date;
  gracePeriodDays: number | null | undefined;
}): boolean {
  return input.now.getTime() > effectiveDueAt(input.dueAt, input.gracePeriodDays).getTime();
}
