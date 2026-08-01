// =============================================================================
// SCORING CONTRACT — single source of truth
// -----------------------------------------------------------------------------
// Derived from the syllabus assessment breakdown:
//   Weekly Quizzes 20% | Weekly Assignments 40% | Participation 10% | Final 30%
//
// The quizzes, submissions, progress, and leaderboard streams ALL import these
// functions. Do not re-implement scoring anywhere else — divergent copies are
// the classic source of leaderboard/grade mismatches.
// Owner: shared-contracts skill (Wave 0).
// =============================================================================

import { appConfig } from "@/lib/config/app.config";

export const POINTS = {
  QUIZ_MAX: 20,
  ASSIGNMENT_MAX: 40,
  PARTICIPATION_MAX: 10,
  FINAL_PROJECT_MAX: 30,
  WEEK_MAX: 70, // quiz + assignment + participation for a normal week
} as const;

export const QUIZ_PASS_PERCENT = 70; // >= this unlocks the next week
export const QUIZ_FAIL_PERCENT = 50; // < this is a serious penalty / hard block

// -- Quiz: percentage -> weekly quiz points (banded) --------------------------
export function quizPointsFromPercent(percent: number): number {
  if (percent >= 70) return POINTS.QUIZ_MAX;
  if (percent >= 60) return 15;
  if (percent >= 50) return 10;
  return 0;
}

// -- Assignment: base 40, minus late penalty, minus star shortfall ------------
// Late penalty: latePenaltyPercentPerDay per day, capped at 20% total.
// Star rating: 3 stars = full; each star below 3 removes 10 points.

/**
 * The most an assignment can still be worth given only its LATENESS.
 *
 * The star shortfall is not applied, because nobody has awarded stars yet. This is
 * a ceiling — "the late penalty has already cost you this much, the rest is up to
 * the marker" — and it is what the student-facing "Maximum still available" badge
 * and the instructor queue's projection want.
 *
 * SPLIT OUT OF `assignmentPoints` ON 2026-07-31, and the reason matters more than
 * the refactor. `assignmentPoints` used to return this same number for
 * `stars: null`, so the two ideas — "what is this worth" and "what could this still
 * be worth" — were one function with one return value, and every caller that meant
 * the first got the second. See the note on `assignmentPoints`.
 */
export function assignmentPointsCeiling(params: {
  daysLate: number;
  latePenaltyPercentPerDay: number;
}): number {
  const { daysLate, latePenaltyPercentPerDay } = params;
  let pts = POINTS.ASSIGNMENT_MAX;
  if (daysLate > 0) {
    const penaltyPct = Math.min(daysLate * latePenaltyPercentPerDay, 20);
    pts = pts - (pts * penaltyPct) / 100;
  }
  return Math.max(0, Math.round(pts));
}

/**
 * Points AWARDED for an assignment.
 *
 * AN UNGRADED SUBMISSION SCORES 0. This changed on 2026-07-31 and it is a
 * behaviour change, not a tidy-up, so here is the whole argument.
 *
 * The previous implementation started at `POINTS.ASSIGNMENT_MAX` and only ever
 * deducted: a late penalty, then 10 points per star below 3. `stars: null` meant
 * "not yet rated", and a null therefore deducted nothing — so the function
 * returned the full 40 for a submission no human had looked at. That was not a
 * harmless default. `assignmentPointsForWeek` (src/lib/progress/score.ts) feeds the
 * student dashboard and the weekly aggregate directly from this function, so the
 * mere act of INGESTING a row from the response sheet awarded a student full marks
 * for the assignment. A student who handed in an empty repository saw 40/40 until
 * an instructor got round to marking it, and the number went DOWN when they did —
 * which is the one direction a grade must never move for a reason the student
 * cannot see.
 *
 * The old behaviour was documented (progress/score.ts called it out as a
 * "TRADE-OFF" and flagged it rather than working around it), so it was known
 * rather than accidental. It was still wrong: no reading of the syllabus awards
 * 40% of a week for the act of submitting, and nothing downstream WANTED an
 * optimistic number — the two call sites that did were both asking for a ceiling,
 * and they now ask `assignmentPointsCeiling` for one by name.
 *
 * `stars` is still `number | null` rather than `number`, deliberately. Making it
 * required would have pushed the "is this graded?" decision out to every caller,
 * which is exactly how two callers come to disagree about it. One function, one
 * answer: null means ungraded, ungraded means no marks.
 */
export function assignmentPoints(params: {
  daysLate: number;
  latePenaltyPercentPerDay: number;
  stars: number | null; // 1..5, null = not yet rated -> 0 points
}): number {
  const { daysLate, latePenaltyPercentPerDay, stars } = params;

  // Not yet rated: no marks. See the note above.
  if (stars == null) return 0;

  let pts = assignmentPointsCeiling({ daysLate, latePenaltyPercentPerDay });
  if (stars < 3) {
    pts = pts - (3 - stars) * 10;
  }
  return Math.max(0, Math.round(pts));
}

// -- Days late from due date --------------------------------------------------
export function daysLate(submittedAt: Date, dueAt: Date): number {
  const ms = submittedAt.getTime() - dueAt.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// -- Week unlock decision -----------------------------------------------------
export function shouldUnlockNextWeek(quizBestPercent: number): boolean {
  return quizBestPercent >= QUIZ_PASS_PERCENT;
}

// -- Course-wide maximum -------------------------------------------------------
// Derived, never hardcoded: every normal week contributes WEEK_MAX (quiz 20 +
// assignment 40 + participation 10), plus one final project. For the default
// 4-week course this is 4*70 + 30 = 310.
//
// Previously this was a literal 330 with a comment claiming a 360 ceiling —
// both wrong, and every letter grade came out deflated. Deriving it from
// app.config keeps it correct if the course length ever changes.
// The parameter is annotated `number` deliberately. appConfig is declared
// `as const`, so appConfig.course.durationWeeks has the literal type `4`; an
// inferred default would narrow this parameter to `4` and reject every caller
// passing a variable week count.
export function courseMaxScore(
  durationWeeks: number = appConfig.course.durationWeeks,
): number {
  return durationWeeks * POINTS.WEEK_MAX + POINTS.FINAL_PROJECT_MAX;
}

// -- Letter grade from total --------------------------------------------------
export function letterGrade(
  totalScore: number,
  maxScore = courseMaxScore(),
): "A" | "B" | "C" | "D" | "F" {
  // A zero or negative ceiling has no meaningful percentage; treat as failing
  // rather than dividing by zero and returning NaN through the comparisons.
  if (maxScore <= 0) return "F";
  const pct = (totalScore / maxScore) * 100;
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  return "F";
}
