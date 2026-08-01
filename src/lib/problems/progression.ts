// =============================================================================
// LEVEL PROGRESSION — one function, one rule. Pure. Owner: coding-problems.
// -----------------------------------------------------------------------------
// THE RULE, stated once so it can be changed in one place:
//
//   * `beginner` is always unlocked.
//   * A level is unlocked when the student has SOLVED at least
//     LEVEL_UNLOCK_THRESHOLD problems at the level immediately below it, within
//     the same track AND the same bank.
//   * The requirement is capped at the number of GRADEABLE problems that level
//     actually contains: `min(THRESHOLD, gradeableCount)`. Two consequences,
//     both deliberate:
//       - a level holding only two executable problems is satisfied by solving
//         both, instead of being permanently unreachable;
//       - a level holding NO executable problems (the HTML and CSS tracks, whose
//         languages have no runtime on the execution allow-list, so every problem
//         is `execution: "none"` and no passing run can ever exist) has a
//         requirement of zero and does not gate the level above it. Gating on a
//         condition the content makes unsatisfiable would present an open track
//         as locked forever, which is a lie about the product.
//
// WHY per track AND per bank. A student grinding JavaScript should not thereby
// unlock advanced SQL, and interview drills are a separate surface with their own
// ladder — /problems and /interview render from the same table but are not the
// same journey.
//
// WHY DERIVED rather than a stored level. Same argument as completion.ts: the
// input is already the derived solved set, so storing a level would be a mirror of
// a mirror. Change THRESHOLD below and every student's ladder recomputes on the
// next request, with no backfill.
// =============================================================================

import type { ProficiencyLevel } from "@/db/schema";

import { LEVELS } from "./types";

/** Solved problems required at a level to unlock the next. Change here only. */
export const LEVEL_UNLOCK_THRESHOLD = 3;

/** The level directly below `level`, or null for `beginner`. */
export function previousLevel(level: ProficiencyLevel): ProficiencyLevel | null {
  const index = LEVELS.indexOf(level);
  return index <= 0 ? null : LEVELS[index - 1];
}

/** Per-level counts for ONE (track, bank) pair. */
export interface LevelTally {
  /** Problems at this level that can produce a passing run (execution != none). */
  gradeable: number;
  /** Of those, how many this student has solved. */
  solved: number;
}

export type LevelTallies = Record<ProficiencyLevel, LevelTally>;

export function emptyTallies(): LevelTallies {
  return {
    beginner: { gradeable: 0, solved: 0 },
    intermediate: { gradeable: 0, solved: 0 },
    advanced: { gradeable: 0, solved: 0 },
  };
}

export interface LevelState {
  level: ProficiencyLevel;
  unlocked: boolean;
  /** Solved count at the level BELOW, and what it must reach. Both 0 for beginner. */
  solvedBelow: number;
  requiredBelow: number;
  gradeable: number;
  solved: number;
}

/**
 * The ladder for one (track, bank) pair. THE one place the rule lives.
 *
 * Levels are evaluated in order and a locked level locks everything above it:
 * `advanced` cannot be reached by solving beginner problems alone, even if
 * `intermediate` happens to be empty — an empty intermediate level makes its own
 * requirement zero, so it unlocks, and the ladder continues honestly from there.
 */
export function levelProgression(tallies: LevelTallies): LevelState[] {
  const states: LevelState[] = [];
  let previousUnlocked = true;

  for (const level of LEVELS) {
    const below = previousLevel(level);
    const belowTally = below ? tallies[below] : null;

    const requiredBelow = belowTally
      ? Math.min(LEVEL_UNLOCK_THRESHOLD, belowTally.gradeable)
      : 0;
    const solvedBelow = belowTally ? belowTally.solved : 0;

    const unlocked: boolean = previousUnlocked && solvedBelow >= requiredBelow;

    states.push({
      level,
      unlocked,
      solvedBelow,
      requiredBelow,
      gradeable: tallies[level].gradeable,
      solved: tallies[level].solved,
    });
    previousUnlocked = unlocked;
  }

  return states;
}

/** Convenience: the set of unlocked levels, for a filter or a lock badge. */
export function unlockedLevels(tallies: LevelTallies): Set<ProficiencyLevel> {
  const set = new Set<ProficiencyLevel>();
  for (const state of levelProgression(tallies)) {
    if (state.unlocked) set.add(state.level);
  }
  return set;
}

/** Is one specific level open for this (track, bank)? */
export function isLevelUnlocked(tallies: LevelTallies, level: ProficiencyLevel): boolean {
  return levelProgression(tallies).some((s) => s.level === level && s.unlocked);
}

/**
 * Build the tallies from the raw ingredients: every problem in one (track, bank),
 * and the student's derived solved set. Keeps the ladder's input assembly in the
 * same file as the rule, so a caller cannot mis-assemble it.
 */
export function talliesFor(
  problems: readonly { id: number; level: ProficiencyLevel; gradeable: boolean }[],
  solved: ReadonlySet<number>,
): LevelTallies {
  const tallies = emptyTallies();
  for (const problem of problems) {
    if (!problem.gradeable) continue;
    tallies[problem.level].gradeable += 1;
    if (solved.has(problem.id)) tallies[problem.level].solved += 1;
  }
  return tallies;
}
