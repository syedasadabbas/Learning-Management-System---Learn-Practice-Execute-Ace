// =============================================================================
// ENGAGEMENT PANEL — active students, submission pattern, and a 14-day sparkline.
// -----------------------------------------------------------------------------
// WHAT IS NOT HERE, AND WHY. The roadmap asks for "login frequency". There is no
// login, session or audit table in this schema (activity logs are Phase 1
// feature 4 and are not built), so login frequency is not answerable and is not
// approximated with something else and relabelled. What is answerable is
// ACTIVE STUDENTS: distinct students with at least one recorded event, over 7 and
// 30 days. That is stated on the card.
//
// The sparkline is an inline <svg> polyline — about 20 lines of markup against
// ~95 kB gzipped for recharts, on a server component that ships no client JS.
// See CourseProgressChart.tsx for the measured precedent.
//
// RATES REUSE THE EXISTING WIDGETS. `RateTile` and `rate()` come from the
// instructor-admin stream, so "no data" is worded identically to the four tiles
// already on this page instead of a second phrasing appearing halfway down it.
// =============================================================================

// DEEP IMPORT, DELIBERATELY. The `@/components/instructor` barrel re-exports
// AdminForms, which is a "use server" module chain reaching next-auth, so pulling
// the barrel in drags a server-action graph into anything that renders this panel
// — it fails outright under vitest ("Cannot find module 'next/server'"), which is
// how it was found. StatTile.tsx has no such dependency, so this file imports the
// two widgets from it directly. Reusing them rather than writing new tiles is the
// point: "no data" must be worded identically to the four tiles already on the
// page, and a second phrasing halfway down it reads as two different products.
import { RateTile, StatTile } from "@/components/instructor/StatTile";
import { Card } from "@/components/ui";
import type { DailyActivity, EngagementSummary } from "@/lib/analytics/queries";
import { rate } from "@/lib/instructor/rates";

export interface EngagementPanelProps {
  engagement: EngagementSummary;
  daily: readonly DailyActivity[];
}

/** Sparkline geometry, in SVG user units (unitless; the viewBox scales them). */
const SPARK_W = 280;
const SPARK_H = 48;

function Sparkline({ daily }: { daily: readonly DailyActivity[] }) {
  const peak = daily.reduce((n, d) => Math.max(n, d.activeStudents), 0);

  // A flat zero series has no shape to draw. Saying so beats a straight line at
  // the bottom of a chart, which reads as a rendering failure.
  if (daily.length < 2 || peak === 0) {
    return (
      <p className="text-xs text-ink-muted" data-testid="spark-empty">
        No activity in the last {daily.length} days.
      </p>
    );
  }

  const step = SPARK_W / (daily.length - 1);
  const points = daily
    .map((d, i) => {
      const x = i * step;
      // Inverted: SVG y grows downward. A 2-unit inset keeps the stroke of a
      // peak-value point inside the viewBox instead of clipping it in half.
      const y = SPARK_H - 2 - (d.activeStudents / peak) * (SPARK_H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Active students per day over the last ${daily.length} days, peak ${peak}`}
      data-testid="engagement-sparkline"
      data-peak={peak}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-brand"
        // vectorEffect keeps the stroke 2px after preserveAspectRatio="none"
        // stretches the horizontal axis; without it a wide card draws a
        // noticeably fatter line than a narrow one.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function EngagementPanel({ engagement, daily }: EngagementPanelProps) {
  const {
    activeStudents7d,
    activeStudents30d,
    cohortStudentCount,
    eventCount,
    lastEventAt,
    submissionCount,
    lateSubmissionCount,
  } = engagement;

  return (
    <section className="space-y-4" data-testid="analytics-engagement">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RateTile
          testId="engagement-active-7d"
          label="Active in 7 days"
          rate={rate(activeStudents7d, cohortStudentCount)}
          denominatorNoun="students"
        />
        <RateTile
          testId="engagement-active-30d"
          label="Active in 30 days"
          rate={rate(activeStudents30d, cohortStudentCount)}
          denominatorNoun="students"
        />
        <RateTile
          testId="engagement-late-share"
          label="Submitted late"
          rate={rate(lateSubmissionCount, submissionCount)}
          denominatorNoun="submissions"
        />
        <StatTile
          testId="engagement-events"
          label="Recorded events"
          value={eventCount}
          hint={
            lastEventAt
              ? `most recent ${lastEventAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
              : "nothing recorded yet"
          }
          muted={eventCount === 0}
        />
      </div>

      <Card
        padded
        title="Active students per day"
        subtitle="Distinct students with at least one recorded event. Not logins — this schema has no login record."
        data-testid="analytics-daily-card"
      >
        <div className="mt-2">
          <Sparkline daily={daily} />
        </div>
        {daily.length > 0 && (
          <p className="mt-1 flex justify-between text-[11px] text-ink-muted">
            <span data-testid="daily-first">{daily[0]!.day}</span>
            <span data-testid="daily-last">{daily[daily.length - 1]!.day}</span>
          </p>
        )}
      </Card>
    </section>
  );
}
