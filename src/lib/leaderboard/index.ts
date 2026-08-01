// =============================================================================
// LEADERBOARD BARREL. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// `on-scoring-event` is deliberately NOT re-exported here. Its callers
// (quizzes, submissions) import it by its exact path
// `@/lib/leaderboard/on-scoring-event` on their own branches; funnelling them
// through a barrel would drag ./queries.ts — and therefore the whole read model
// — into the grading path's module graph for no reason.
// =============================================================================

export {
  COLUMN_FOR_SOURCE,
  ZERO_SCORES,
  applyPoints,
  assignRanks,
  compareForRank,
  componentCaps,
  isMeaningfulEvent,
  rankOf,
  totalOf,
} from "./ranking";
export type { ComponentKey, ComponentScores, RankableRow, Ranked } from "./ranking";

export {
  defaultDirectionFor,
  parseDirection,
  parseSortKey,
  sortEntries,
  sortWeeklyEntries,
} from "./sorting";

export {
  getCohortEntries,
  getLeaderboardView,
  getMyStanding,
  getWeeklyEntries,
  resolveCohortId,
} from "./queries";
export type { LeaderboardQuery } from "./queries";

export { applyScoringEvent, rebuildLeaderboard, renumberCohort } from "./rebuild";
export type { ApplyResult, RebuildResult, Tx } from "./rebuild";

export { SORT_KEYS } from "./types";
export type {
  LeaderboardCohortOption,
  LeaderboardEntry,
  LeaderboardScope,
  LeaderboardSortKey,
  LeaderboardView,
  LeaderboardWeekOption,
  MyStanding,
  SortDirection,
  WeeklyLeaderboardEntry,
} from "./types";
