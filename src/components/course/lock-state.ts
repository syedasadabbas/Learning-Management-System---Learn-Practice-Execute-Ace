// =============================================================================
// WEEK LOCK-STATE DERIVATION — pure, unit-tested, no React, no database.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// This module does NOT decide the unlock RULE — `shouldUnlockNextWeek` in
// src/lib/contracts/scoring.ts does, and it is the single source of truth. What
// this module does is project that rule across an ordered list of weeks and turn
// the result into something the UI and the route handlers can both consume:
// a locked flag plus a human-readable REASON.
//
// The reason string is not decoration. A padlock with no explanation is a dead
// end — the student cannot tell whether they must pass a quiz, wait for a date,
// or contact staff. Every locked week here says exactly what to do.
//
// FAIL-CLOSED. `getWeekProgress` is owned by the progress-tracking stream and
// currently returns []. With no progress data the only safe projection is
// "first week open, everything after it locked" — the opposite default would
// hand every student the whole course the moment the read model hiccuped.
// =============================================================================

import type { WeekProgress } from "@/lib/contracts/events";
import { QUIZ_PASS_PERCENT, shouldUnlockNextWeek } from "@/lib/contracts/scoring";
import {
  getCurriculumSections,
  isWeekNumberEnabled,
  sectionLockReason,
  type CurriculumSection,
} from "./sections";

/** The minimum a week row must expose for lock derivation. */
export interface WeekLockInput {
  id: number;
  weekNumber: number;
  title: string;
  /** Number of lectures in the week; used for the completion bar. */
  lectureTotal?: number;
}

export interface WeekLockState {
  weekId: number;
  weekNumber: number;
  title: string;
  locked: boolean;
  /** Why it is locked. Null exactly when `locked` is false. */
  reason: string | null;
  /**
   * Which layer refused the week.
   *   "section"     — its subject is not released; no quiz result opens it.
   *   "progression" — the subject is open but the previous week is unpassed.
   *   null          — not locked.
   *
   * The UI uses this to avoid telling a student to "pass the previous quiz"
   * when passing it would change nothing.
   */
  lockedBy: "section" | "progression" | null;
  quizBestPercent: number | null;
  lecturesCompleted: number;
  lectureTotal: number;
  /** Lectures completed as a whole percent, 0 when the week has no lectures. */
  completionPercent: number;
}

/** Percentage required to unlock the following week. Re-exported for UI copy. */
export const UNLOCK_THRESHOLD_PERCENT = QUIZ_PASS_PERCENT;

function completionPercentOf(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(completed, total) / total) * 100);
}

/**
 * Build the lock reason shown for week N, given week N-1's state.
 *
 * Split out so the three call sites (week card, week page, API) cannot drift into
 * three differently-worded explanations of the same rule.
 */
function lockReason(
  previous: WeekLockInput | undefined,
  previousProgress: WeekProgress | undefined,
): string {
  if (!previous) {
    // Should be unreachable: only week index 0 has no predecessor, and that week
    // is unconditionally unlocked. Kept as an honest message rather than a throw.
    return "This week is not yet available.";
  }

  const best = previousProgress?.quizBestPercent ?? null;

  if (best == null) {
    return `Locked until you pass the Week ${previous.weekNumber} quiz (${UNLOCK_THRESHOLD_PERCENT}% or higher).`;
  }

  return `Locked: your best Week ${previous.weekNumber} quiz score is ${best}%. You need ${UNLOCK_THRESHOLD_PERCENT}% to unlock this week.`;
}

/**
 * Project the unlock rule across every week of the course.
 *
 * @param weeks    all weeks of the course, any order — sorted by weekNumber here
 * @param progress rows from `getWeekProgress(studentId)`; may be empty
 *
 * Rules, in precedence order:
 *   0. SECTION RELEASE. If the week's subject section is not enabled — or no
 *      section claims the week at all — it is locked, full stop. This is checked
 *      FIRST and overrides every rule below it, including rule 1 and including a
 *      stored `unlocked: true`. Anything less makes the release switch advisory:
 *      a student who had already unlocked week 3 would keep it after the owner
 *      closed the JavaScript section, which is the opposite of what closing it
 *      means. See sections.ts for why the two locks are separate concepts.
 *   1. The first week (lowest weekNumber) is always unlocked. A student who has
 *      just enrolled has no progress rows at all and must still be able to start.
 *   2. Otherwise, if the read model has already recorded `unlocked: true` for the
 *      week, trust it. progress.week_unlocked is written transactionally by the
 *      quizzes stream on the unlock event and survives a later quiz retake.
 *   3. Otherwise derive it from the previous week's best quiz percentage via
 *      `shouldUnlockNextWeek`.
 *   4. Otherwise locked.
 *
 * `sections` is injectable so the unit tests can state a configuration inline
 * rather than depending on whatever appConfig currently ships. Production
 * callers omit it and get the configured sections.
 *
 * NOTE ON RULE 1 + RULE 0 TOGETHER: "week 1 is always unlocked" is now scoped to
 * "the first week of the whole course, IF its section is open". With the shipped
 * config the HTML section is open and holds week 1, so a newly enrolled student
 * still lands on an unlocked week 1 — the zero-activity path the dashboard tests
 * assert is unchanged.
 */
export function deriveWeekLockStates(
  weeks: readonly WeekLockInput[],
  progress: readonly WeekProgress[],
  sections: readonly CurriculumSection[] = getCurriculumSections(),
): WeekLockState[] {
  const ordered = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const byWeekId = new Map<number, WeekProgress>();
  for (const row of progress) byWeekId.set(row.weekId, row);

  return ordered.map((week, index) => {
    const own = byWeekId.get(week.id);
    const previous = index > 0 ? ordered[index - 1] : undefined;
    const previousProgress = previous ? byWeekId.get(previous.id) : undefined;

    // Rule 0 — the section release switch. Evaluated before anything else and
    // never overridden by progress; see the precedence note in the doc comment.
    const sectionOpen = isWeekNumberEnabled(week.weekNumber, sections);

    let locked: boolean;
    let lockedBy: WeekLockState["lockedBy"];

    if (!sectionOpen) {
      locked = true;
      lockedBy = "section";
    } else if (index === 0) {
      locked = false;
      lockedBy = null;
    } else if (own?.unlocked === true) {
      locked = false;
      lockedBy = null;
    } else {
      const previousBest = previousProgress?.quizBestPercent;
      locked =
        previousBest == null ? true : !shouldUnlockNextWeek(previousBest);
      lockedBy = locked ? "progression" : null;
    }

    // Prefer the read model's lecture total (it counts the same lectures the
    // dashboard counts); fall back to the count carried on the week row.
    const lectureTotal = own?.lectureTotal ?? week.lectureTotal ?? 0;
    const lecturesCompleted = own?.lecturesCompleted ?? 0;

    return {
      weekId: week.id,
      weekNumber: week.weekNumber,
      title: week.title,
      locked,
      lockedBy,
      // A section refusal must NOT say "pass the previous quiz" — no quiz score
      // opens a closed subject, and sending a student to retake one is a waste
      // of their one remaining attempt.
      reason: !locked
        ? null
        : lockedBy === "section"
          ? sectionLockReason(week.weekNumber, sections)
          : lockReason(previous, previousProgress),
      quizBestPercent: own?.quizBestPercent ?? null,
      lecturesCompleted,
      lectureTotal,
      completionPercent: completionPercentOf(lecturesCompleted, lectureTotal),
    };
  });
}

/**
 * Lock state for one week, or null when that week is not part of the list.
 *
 * Callers gating a route MUST treat null as "deny": an unknown week id is either
 * a typo or a probe, and neither should be answered with content.
 */
export function lockStateForWeek(
  weekId: number,
  weeks: readonly WeekLockInput[],
  progress: readonly WeekProgress[],
  sections?: readonly CurriculumSection[],
): WeekLockState | null {
  return (
    deriveWeekLockStates(weeks, progress, sections).find((s) => s.weekId === weekId) ?? null
  );
}
