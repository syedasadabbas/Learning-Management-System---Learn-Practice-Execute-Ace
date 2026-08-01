// =============================================================================
// CODING-PROBLEMS BARREL — pure modules only. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// `service.ts` is deliberately NOT re-exported. It imports `@/db` (node-postgres)
// and dynamically imports the Piston client, so putting it on the barrel would
// drag Drizzle and the database credentials' code path into any client component
// that wanted a type or the output comparator. Server callers import it directly:
//
//     import { listProblems } from "@/lib/problems/service";
//
// This mirrors the rule the execution stream states for `runOnPiston` — one
// sanctioned deep import, so the boundary is visible at every call site.
// =============================================================================

export {
  BANK_BASE_PATH,
  bankOf,
  isLevel,
  isProblemBank,
  isProblemTrack,
  LEVELS,
  PROBLEM_BANKS,
  PROBLEM_TRACKS,
  TRACK_LABELS,
} from "./types";
export type {
  AttemptSummary,
  ProblemBank,
  ProblemSummary,
  ProblemTrack,
  StudentProblem,
  SubmitOutcome,
  TestOutcome,
  VisibleTest,
} from "./types";

export {
  buildRunRequest,
  canonicalise,
  canonicaliseSqlOutput,
  comparisonModeFor,
  gradeMarkupTest,
  gradeTest,
  isExecutable,
  normaliseOutput,
  outputMatches,
  requiresServerRuntime,
  tallyTests,
} from "./grading";
export type { ComparisonMode, GradableTest, GradedRun, GradedTest, RunOutcomeLike } from "./grading";

// Markup grading is pure and has no dependencies, so the client bundle pays only
// for what it imports — MarkupWorkbench uses the same functions the server grader
// uses, which is the point (see markup.ts on Run/Submit not disagreeing).
export {
  DEFAULT_MARKUP_PATH,
  describeCheck,
  evaluateMarkupTest,
  indexMarkup,
  isMarkupLanguage,
  joinMarkupBundle,
  MARKUP_LANGUAGES,
  orderBundlePaths,
  parseMarkupAssertions,
  splitMarkupBundle,
  summariseExpectations,
  summariseResults,
} from "./markup";
export type {
  CheckResult,
  MarkupAssertion,
  MarkupCheck,
  MarkupIndex,
  MarkupLanguage,
  MarkupTestResult,
} from "./markup";

export { attemptCountsByProblem, attemptPassed, isSolved, solvedProblemIds } from "./completion";

// `availability.ts` is NOT re-exported: it performs a network probe and is server
// -only, like service.ts. Server callers import it directly.
export type { AttemptCounts } from "./completion";

export {
  emptyTallies,
  isLevelUnlocked,
  LEVEL_UNLOCK_THRESHOLD,
  levelProgression,
  previousLevel,
  talliesFor,
  unlockedLevels,
} from "./progression";
export type { LevelState, LevelTallies, LevelTally } from "./progression";

export {
  mayRevealSolution,
  stringArray,
  toAttemptSummary,
  toProblemSummary,
  toStudentProblem,
  trackOf,
} from "./payload";
export type { AttemptRowLike, ProblemRowLike, TestRowLike } from "./payload";

export {
  assertValidCatalogue,
  catalogueCounts,
  validateCatalogue,
  withOrderIndexes,
} from "./validate";
export type { CatalogueProblem, SeedProblem, SeedProblemTest, ValidationError } from "./validate";
