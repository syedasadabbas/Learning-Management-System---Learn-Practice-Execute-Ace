// =============================================================================
// ANALYTICS EXTENSION BARREL.
// -----------------------------------------------------------------------------
// This directory EXTENDS the shipped analytics surface; it does not replace it.
// The cohort figures (pass rates, quiz histogram, per-week completion, the
// penalty-based at-risk list) still come from
// `getCohortAnalytics` in src/lib/instructor/analytics.ts, and both
// /instructor/analytics and /admin/analytics still render them. Import that for
// those numbers. Import this for the feature-7 additions.
// =============================================================================

export {
  getAdvancedAnalytics,
  DAILY_WINDOW_DAYS,
  type AdvancedAnalytics,
  type EngagementSummary,
  type DailyActivity,
  type ProblemDifficulty,
} from "./queries";

export {
  gradeDistribution,
  buildHeatmap,
  LETTERS,
  HOUR_BLOCKS,
  ISO_DAYS,
  type GradeDistribution,
  type GradeBucket,
  type Heatmap,
  type HeatmapCell,
  type HeatmapCellRow,
  type Letter,
} from "./distribution";

export {
  assessRisk,
  rankRisk,
  bandFor,
  daysSilentWeight,
  type RiskSignals,
  type RiskAssessment,
  type RiskBand,
} from "./risk";

export { redactEmail, redactEmails, containsEmailAddress } from "./privacy";
