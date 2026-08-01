// =============================================================================
// LEARN PROGRESS — derivation only. No storage, no database, no React.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// THE RULE THIS FILE EXISTS TO ENFORCE: a percentage is never stored.
//
// `learning_progress` holds one row per (student, step) and nothing else — no
// percent column, no module-level rollup. Every number a student sees is
// computed here from those rows on read. A stored percentage has exactly one
// property that matters: it can be wrong. A denormalised counter that drifts from
// its source is the bug `dbms-read-models-and-denormalisation` teaches students
// to look for, and there is no read-path pressure here that would justify paying
// for it (a track is tens of steps, not millions of rows).
//
// Pure functions, so all of this is unit-tested without touching src/db, which
// tests/setup.ts forbids anyway.
// =============================================================================

/** Just enough of a module to compute its progress. */
export interface ModuleProgressInput {
  stepCount: number;
  completedSteps: number;
}

export type ModuleStatus = "not_started" | "in_progress" | "complete";

export interface ModuleProgress {
  stepCount: number;
  /** Clamped into [0, stepCount] — "7 of 5 steps" must be impossible. */
  completedSteps: number;
  /** Integer 0-100, derived. */
  percent: number;
  status: ModuleStatus;
}

function toCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Derive one module's progress.
 *
 * `completedSteps` is clamped to `stepCount` rather than trusted. Two writers
 * can never disagree here (only this stream writes `learning_progress`), but a
 * step deleted after a student completed it leaves a row behind, and "6 of 5"
 * on screen is worse than a silently capped 100 %.
 *
 * A module with zero steps is `complete` at 100 %: it is authored content with
 * nothing left to do, and reporting 0 % would make a track's total unreachable.
 */
export function moduleProgress(input: ModuleProgressInput): ModuleProgress {
  const stepCount = toCount(input.stepCount);
  const completedSteps = Math.min(stepCount, toCount(input.completedSteps));

  if (stepCount === 0) {
    return { stepCount: 0, completedSteps: 0, percent: 100, status: "complete" };
  }

  const percent = Math.round((completedSteps / stepCount) * 100);
  const status: ModuleStatus =
    completedSteps === 0 ? "not_started" : completedSteps >= stepCount ? "complete" : "in_progress";

  return { stepCount, completedSteps, percent, status };
}

export interface TrackProgress {
  moduleCount: number;
  modulesComplete: number;
  stepCount: number;
  completedSteps: number;
  /** Integer 0-100, derived from STEPS, not from an average of module percents. */
  percent: number;
}

/**
 * Roll a track's modules up into one figure.
 *
 * Deliberately steps/steps, NOT the mean of the per-module percentages. The mean
 * makes a 3-step module count as much as a 30-step one, so finishing three tiny
 * modules would read as more progress than most of the long one. Steps are the
 * unit a student actually spends time on, so steps are the unit of the ratio.
 */
export function trackProgress(modules: readonly ModuleProgressInput[]): TrackProgress {
  let stepCount = 0;
  let completedSteps = 0;
  let modulesComplete = 0;

  for (const entry of modules) {
    const p = moduleProgress(entry);
    stepCount += p.stepCount;
    completedSteps += p.completedSteps;
    if (p.status === "complete") modulesComplete += 1;
  }

  return {
    moduleCount: modules.length,
    modulesComplete,
    stepCount,
    completedSteps,
    percent: stepCount === 0 ? 0 : Math.round((completedSteps / stepCount) * 100),
  };
}

/**
 * Index of the first step this student has not completed.
 *
 * This is how a reopened tab lands the student where they stopped instead of at
 * step 1 — the point of per-step completion. Returns 0 for an untouched module
 * and the LAST index for a finished one, because sending a returning student
 * past the end of the module would be a blank page.
 */
export function firstIncompleteIndex(
  stepIds: readonly number[],
  completed: ReadonlySet<number>,
): number {
  if (stepIds.length === 0) return 0;
  const index = stepIds.findIndex((id) => !completed.has(id));
  return index === -1 ? stepIds.length - 1 : index;
}

/**
 * The sentence the live region announces after a step is completed.
 *
 * Progress must be audible, not only visible (the accessibility requirement for
 * this stream), and it must not be colour-only. The wording states the counts
 * as well as the percentage so a screen-reader user gets the same information a
 * sighted user reads off the bar.
 */
export function progressAnnouncement(progress: ModuleProgress): string {
  if (progress.stepCount === 0) return "This module has no steps.";
  if (progress.status === "complete") {
    return `Module complete. All ${progress.stepCount} steps done.`;
  }
  return `Step ${progress.completedSteps} of ${progress.stepCount} complete — ${progress.percent} per cent.`;
}

/**
 * Group modules by level, in ladder order, dropping levels with no modules.
 *
 * Generic over the module shape so both the track page (full summaries) and a
 * test (bare objects) can use it.
 */
export function groupByLevel<T extends { level: string; orderIndex: number }>(
  modules: readonly T[],
  levels: readonly string[],
): { level: string; modules: T[] }[] {
  return levels
    .map((level) => ({
      level,
      modules: modules
        .filter((m) => m.level === level)
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex),
    }))
    .filter((group) => group.modules.length > 0);
}
