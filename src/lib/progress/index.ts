// =============================================================================
// PROGRESS MODULE BARREL — owned by the progress-tracking stream.
// -----------------------------------------------------------------------------
// Other streams should import `getWeekProgress` from "@/lib/progress/read-model"
// (the path named in the frozen events.ts contract) or from here. Both resolve to
// the same function.
//
// Note the layering: `score.ts` and `unlock.ts` are pure and import nothing from
// the database, so importing them does not pull `pg` into a bundle.
// =============================================================================

export { getWeekProgress, getWeekProgressDetail } from "./read-model";
export {
  buildWeekProgress,
  getWeeklyScore,
  getWeeklyScoreBreakdown,
  totalsFrom,
  type WeekProgressDetail,
} from "./aggregate";
export {
  buildDashboard,
  deriveNextAction,
  deriveNextDeadline,
  getDashboard,
  isWeekComplete,
  weekHref,
  assignmentHref,
  WEEK_MAX_POINTS,
  type DashboardModel,
  type NextAction,
  type NextDeadline,
} from "./dashboard";
export {
  overallPercent,
  participationPointsForWeek,
  quizPointsForWeek,
  assignmentPointsForWeek,
  weekScore,
  weekScoreBreakdown,
  type AssignmentScoreInput,
  type WeekScoreBreakdown,
  type WeekScoreInput,
} from "./score";
export { deriveUnlocked, currentWeekNumber, type UnlockInput } from "./unlock";
export { fetchWeekAggregates, type WeekAggregateRow } from "./query";
