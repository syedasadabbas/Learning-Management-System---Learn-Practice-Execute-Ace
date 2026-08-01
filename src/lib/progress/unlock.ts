// =============================================================================
// WEEK-UNLOCK READ MODEL (derivation only) — pure, database-free, unit-tested.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// This stream owns the unlock READ model; the quizzes stream owns the WRITE
// (it sets `progress.weekUnlocked` when an attempt passes). The two must never
// disagree, so both defer to the SAME authority: `shouldUnlockNextWeek` in
// src/lib/contracts/scoring.ts. The threshold (70) is deliberately not repeated
// anywhere in this file.
//
// DESIGN NOTE — why the stored `progress.weekUnlocked` flag is NOT consulted:
// it is the write side's mirror of this same decision. Reading it and OR-ing it
// in would create a second source of truth, and the failure mode is ugly: a
// stale or hand-edited row would open a week that the passing rule says is shut,
// and nobody would be able to tell which answer was right. Deriving purely from
// best quiz percentages makes disagreement structurally impossible.
// TRADE-OFF: there is therefore no way to grant a manual/administrative unlock.
// If instructor-admin ever needs one, it needs an explicit override column — a
// coordinated schema change, not a local hack.
// =============================================================================

import { isWeekNumberEnabled, type CurriculumSection } from "@/components/course/sections";
import { shouldUnlockNextWeek } from "@/lib/contracts/scoring";

/** The only thing unlock derivation needs to know about a week. */
export type UnlockInput = {
  weekNumber: number;
  /** Best quiz percentage for the week, null when the student never attempted. */
  quizBestPercent: number | null;
};

/**
 * Unlock state for a list of weeks, returned in the same order it was given.
 *
 * Rules:
 *   - The FIRST week (lowest week number) is always unlocked. A new student must
 *     have somewhere to start.
 *   - Week N is unlocked when week N-1's best quiz percentage satisfies
 *     `shouldUnlockNextWeek`.
 *   - A null best percentage (no attempt) never unlocks the next week, and the
 *     chain stops there: week 4 cannot be open while week 3 is shut, even if the
 *     student somehow has a week-3 pass and no week-2 one. Progression is
 *     sequential, so an unlocked week requires every earlier gate to be passed.
 *
 *   - A week whose SUBJECT SECTION is not released is shut regardless of every
 *     rule above, including "the first week is always unlocked". See below.
 *
 * Input need not be sorted — it is sorted internally by week number so callers
 * cannot get the chain wrong by passing rows in query order.
 *
 * THE SECTION GATE, AND WHY IT IS REPEATED HERE
 * This module is a SECOND unlock derivation, independent of
 * `components/course/lock-state.ts` (that one gates content, this one drives the
 * dashboard and `currentWeekNumber`). Both must reach the same answer or the
 * dashboard offers a "continue to Week 2" action that /weeks and `gateWeek` then
 * refuse — the student is told to go somewhere they are then turned away from.
 * Rather than duplicate the policy, both call `isWeekNumberEnabled` from
 * components/course/sections.ts, which is the single source of truth for which
 * subjects are open.
 *
 * `sections` is injectable for the same reason it is in lock-state.ts: so the
 * unit tests can exercise the progression chain against a fully-open course
 * instead of silently re-testing the release switch.
 */
export function deriveUnlocked<T extends UnlockInput>(
  weeks: readonly T[],
  sections?: readonly CurriculumSection[],
): boolean[] {
  if (weeks.length === 0) return [];

  // Ascending by week number, keeping a link back to the caller's positions so
  // the returned array lines up with the input regardless of its order.
  const order = weeks
    .map((week, index) => ({ week, index }))
    .sort((a, b) => a.week.weekNumber - b.week.weekNumber);

  const unlocked = new Array<boolean>(weeks.length).fill(false);

  // The first week in course order is always open.
  let previousGatePassed = true;

  for (const { week, index } of order) {
    // The section switch is ANDed onto the progression result, never ORed: a
    // released subject does not skip the quiz chain, and a passed quiz does not
    // open a withheld subject. Both must agree before a week is open.
    unlocked[index] = previousGatePassed && isWeekNumberEnabled(week.weekNumber, sections);

    // The PROGRESSION chain is advanced from the quiz result alone, deliberately
    // ignoring the section state. A student who passed the HTML quiz has passed
    // that gate; closing the CSS subject withholds CSS, it does not un-pass the
    // week before it. Folding the section state in here instead would mean
    // re-opening a subject later left every week behind it wrongly shut.
    const passedThisWeek =
      week.quizBestPercent != null &&
      Number.isFinite(week.quizBestPercent) &&
      shouldUnlockNextWeek(week.quizBestPercent);
    previousGatePassed = previousGatePassed && passedThisWeek;
  }

  return unlocked;
}

/**
 * Highest week number the student may currently open. Null when there are no
 * weeks at all (empty course) — callers must render an empty state rather than
 * linking to week `NaN`.
 */
export function currentWeekNumber<T extends UnlockInput>(
  weeks: readonly T[],
  sections?: readonly CurriculumSection[],
): number | null {
  const unlocked = deriveUnlocked(weeks, sections);
  let best: number | null = null;
  weeks.forEach((week, i) => {
    if (unlocked[i] && (best == null || week.weekNumber > best)) best = week.weekNumber;
  });
  return best;
}
