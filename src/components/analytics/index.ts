// =============================================================================
// ANALYTICS COMPONENT BARREL — the feature-7 panels.
// -----------------------------------------------------------------------------
// The panels the shipped analytics pages already had (AnalyticsSummary,
// WeekAnalyticsTable, QuizDistribution, AtRiskList) live in
// src/components/instructor and are unchanged. Pages import both barrels: this
// directory extends that surface, it does not fork it.
//
// Every component here is a server component. No charting dependency, no
// "use client" — the section adds 0 kB of client JavaScript.
// =============================================================================

export { AdvancedAnalyticsSection } from "./AdvancedAnalyticsSection";
export type { AdvancedAnalyticsSectionProps } from "./AdvancedAnalyticsSection";

export { CourseProgressChart } from "./CourseProgressChart";
export type { CourseProgressChartProps, WeekProgressRow } from "./CourseProgressChart";

export { PerformanceDistribution } from "./PerformanceDistribution";
export type { PerformanceDistributionProps } from "./PerformanceDistribution";

export { ActivityHeatmap } from "./ActivityHeatmap";
export type { ActivityHeatmapProps } from "./ActivityHeatmap";

export { EngagementPanel } from "./EngagementPanel";
export type { EngagementPanelProps } from "./EngagementPanel";

export { ProblemDifficultyTable } from "./ProblemDifficultyTable";
export type { ProblemDifficultyTableProps } from "./ProblemDifficultyTable";

export { RiskAlerts } from "./RiskAlerts";
export type { RiskAlertsProps } from "./RiskAlerts";
