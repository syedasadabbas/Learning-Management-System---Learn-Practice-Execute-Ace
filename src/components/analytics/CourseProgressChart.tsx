// =============================================================================
// COURSE PROGRESS CHART — per-week completion, as bars.
// Advanced-analytics extension (IMPLEMENTATION_ROADMAP.md feature 7).
// -----------------------------------------------------------------------------
// NO CHARTING LIBRARY, AND THE COST OF ONE IS THE REASON.
// src/components/exercises/LazyExerciseList.tsx exists in this repo because a
// single static import took one route from ~115 kB to 377 kB of client JavaScript.
// recharts is ~95 kB gzipped before its d3 dependencies; victory and chart.js are
// worse. Everything on this page is a bar, a grid cell or a polyline — shapes CSS
// and inline SVG draw for 0 kB — and, being drawn on the server, they add nothing
// to the client bundle at all. This file has no "use client" directive and no
// state; it is a server component rendering divs with width percentages.
//
// IT DOES NOT RECOMPUTE ANYTHING. Every number here comes from the `WeekAnalytics`
// rows `getCohortAnalytics` (src/lib/instructor/analytics.ts) already returns for
// the shipped analytics pages, so this chart and the WeekAnalyticsTable directly
// above it on the page cannot disagree — they are two renderings of one array.
// A zero-denominator week renders "no data", never a full-width bar and never 0%.
// =============================================================================

import { Card } from "@/components/ui";
import { NO_DATA_LABEL, type Rate } from "@/lib/instructor/rates";

/**
 * The subset of `WeekAnalytics` this chart reads. Structural, so it accepts the
 * existing rows without this stream importing another stream's whole type.
 */
export interface WeekProgressRow {
  weekId: number;
  weekNumber: number;
  title: string;
  completionRate: Rate;
  quizPassRate: Rate;
  submissionRate: Rate;
}

export interface CourseProgressChartProps {
  weeks: readonly WeekProgressRow[];
}

/** The three series, in a fixed order so the legend and rows always agree. */
const SERIES = [
  { key: "completionRate", label: "Completed", bar: "bg-brand" },
  { key: "quizPassRate", label: "Quiz passed", bar: "bg-emerald-500" },
  { key: "submissionRate", label: "Submitted", bar: "bg-amber-500" },
] as const;

function Bar({ rate, className }: { rate: Rate; className: string }) {
  const hasData = rate.percent !== null;
  // Clamped, because a rate CAN exceed 100: submissionRate is submissions over
  // enrolled students, and a cohort where some students submitted twice is not a
  // bug in the data. An unclamped width would overflow the track.
  const width = hasData ? Math.min(100, Math.max(0, rate.percent!)) : 0;

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={
          hasData
            ? `${rate.percent!.toFixed(0)} percent, ${rate.numerator} of ${rate.denominator}`
            : NO_DATA_LABEL
        }
      >
        {hasData && (
          <div
            className={`h-full rounded-full ${className}`}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
      <span
        data-testid="progress-bar-value"
        data-has-data={hasData}
        className={
          hasData
            ? "w-20 shrink-0 text-right text-xs tabular-nums text-ink"
            : "w-20 shrink-0 text-right text-xs text-ink-muted"
        }
      >
        {hasData ? `${rate.percent!.toFixed(0)}%` : NO_DATA_LABEL}
      </span>
    </div>
  );
}

export function CourseProgressChart({ weeks }: CourseProgressChartProps) {
  return (
    <Card
      padded
      title="Completion by week"
      subtitle="Same rows as the table above — one array, two renderings, so they cannot disagree."
      data-testid="analytics-progress-chart"
    >
      <ul className="mt-3 space-y-4">
        {weeks.map((week) => (
          <li key={week.weekId} data-testid={`progress-week-${week.weekNumber}`}>
            <p className="text-sm font-medium text-ink">
              Week {week.weekNumber}
              <span className="ml-2 font-normal text-ink-muted">{week.title}</span>
            </p>
            <div className="mt-2 space-y-1.5">
              {SERIES.map((series) => (
                <div key={series.key} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-ink-muted">
                    {series.label}
                  </span>
                  <Bar rate={week[series.key]} className={series.bar} />
                </div>
              ))}
            </div>
          </li>
        ))}
        {weeks.length === 0 && (
          <li className="text-sm text-ink-muted">No weeks are configured yet.</li>
        )}
      </ul>
    </Card>
  );
}
