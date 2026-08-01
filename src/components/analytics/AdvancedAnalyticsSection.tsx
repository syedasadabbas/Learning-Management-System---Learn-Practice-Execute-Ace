// =============================================================================
// THE FEATURE-7 SECTION — one component, composed into both existing pages.
// -----------------------------------------------------------------------------
// WHY A SINGLE SECTION RATHER THAN SIX IMPORTS IN EACH PAGE:
// /instructor/analytics and /admin/analytics must show the SAME numbers in the
// SAME order for the same cohort. The admin page differs from the instructor one
// only by a cohort switcher; if each page composed the panels itself, the two
// would drift the first time one of them gained a panel, and "the admin page says
// something different" is the exact failure this extension was told to avoid.
// Both pages render this one component.
//
// SERVER COMPONENT. No "use client" anywhere in src/components/analytics, no
// charting dependency, so this section adds 0 kB of client JavaScript. See the
// note at the top of CourseProgressChart.tsx for the measured reason that matters
// in this repo.
// =============================================================================

import type { AdvancedAnalytics } from "@/lib/analytics/queries";

import { ActivityHeatmap } from "./ActivityHeatmap";
import { CourseProgressChart, type WeekProgressRow } from "./CourseProgressChart";
import { EngagementPanel } from "./EngagementPanel";
import { PerformanceDistribution } from "./PerformanceDistribution";
import { ProblemDifficultyTable } from "./ProblemDifficultyTable";
import { RiskAlerts } from "./RiskAlerts";

export interface AdvancedAnalyticsSectionProps {
  advanced: AdvancedAnalytics;
  /**
   * The per-week rows from `getCohortAnalytics`. Passed in rather than re-queried:
   * the completion chart is a second rendering of the array the page already has,
   * which is what makes it impossible for the chart and the table to disagree.
   */
  weeks: readonly WeekProgressRow[];
}

export function AdvancedAnalyticsSection({
  advanced,
  weeks,
}: AdvancedAnalyticsSectionProps) {
  return (
    <section className="space-y-6" data-testid="advanced-analytics">
      <header className="border-t border-line pt-6">
        <h2 className="text-lg font-semibold text-ink">Engagement and difficulty</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Aggregated in {advanced.computeMs} ms in {advanced.queryCount} database
          round trip{advanced.queryCount === 1 ? "" : "s"}
          {advanced.cohortId === null ? " across all cohorts" : ""}.
        </p>
      </header>

      <EngagementPanel engagement={advanced.engagement} daily={advanced.daily} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CourseProgressChart weeks={weeks} />
        <PerformanceDistribution grades={advanced.grades} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityHeatmap heatmap={advanced.heatmap} />
        <RiskAlerts risk={advanced.risk} />
      </div>

      <ProblemDifficultyTable problems={advanced.problems} />
    </section>
  );
}
