// =============================================================================
// ACTIVITY HEATMAP — when this cohort actually works, weekday x 4-hour block.
// -----------------------------------------------------------------------------
// NAMED HONESTLY. The roadmap asks for a "time-on-task heatmap". This schema
// records no dwell time — there is no session, page-view or activity-log table
// (activity logs are Phase 1 feature 4 and are not built) — so what can be drawn
// is EVENTS, not minutes: quiz attempts, submissions, coding runs and register
// entries, counted by when they happened. Calling that time-on-task would be a
// claim the data does not support, so the card says "activity" and the caption
// says what an event is.
//
// UTC IS LABELLED. The timestamps are `timestamptz` and the statement extracts
// the hour in the session time zone (UTC on this Neon instance). Rendering the
// blocks as if they were the viewer's local time would shift every column by
// their offset and invite the conclusion "the cohort works at 02:00".
//
// A 42-cell CSS grid. No charting dependency — see CourseProgressChart.tsx.
// =============================================================================

import { Card } from "@/components/ui";
import { HOUR_BLOCKS, ISO_DAYS, type Heatmap } from "@/lib/analytics/distribution";

export interface ActivityHeatmapProps {
  heatmap: Heatmap;
}

/**
 * Intensity -> a background. Five steps of the brand colour rather than a
 * continuous alpha: discrete steps are readable at this cell size and survive a
 * screenshot, and an empty cell is a distinct surface tone rather than a nearly
 * invisible 2%-alpha tint that reads as a rendering fault.
 */
function cellClass(intensity: number, count: number): string {
  if (count === 0) return "bg-surface";
  if (intensity <= 0.2) return "bg-brand/20";
  if (intensity <= 0.4) return "bg-brand/40";
  if (intensity <= 0.6) return "bg-brand/60";
  if (intensity <= 0.8) return "bg-brand/80";
  return "bg-brand";
}

export function ActivityHeatmap({ heatmap }: ActivityHeatmapProps) {
  const { cells, max, total } = heatmap;

  return (
    <Card
      padded
      title="Activity by time of day"
      subtitle="Events, not minutes — this schema records no dwell time. Hours are UTC."
      data-testid="analytics-heatmap"
      data-total={total}
    >
      {total === 0 ? (
        <p className="mt-3 text-sm text-ink-muted" data-testid="heatmap-empty">
          No recorded activity yet — nothing to plot. A new cohort starts here.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[380px] border-separate border-spacing-1">
            <caption className="sr-only">
              Recorded events per weekday and four-hour block, UTC
            </caption>
            <thead>
              <tr>
                <th className="w-10" />
                {HOUR_BLOCKS.map((block) => (
                  <th
                    key={block.block}
                    scope="col"
                    className="text-[10px] font-normal text-ink-muted tabular-nums"
                  >
                    {block.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ISO_DAYS.map((day) => (
                <tr key={day.dow}>
                  <th
                    scope="row"
                    className="pr-1 text-right text-[11px] font-normal text-ink-muted"
                  >
                    {day.label}
                  </th>
                  {HOUR_BLOCKS.map((block) => {
                    const cell = cells.find(
                      (c) => c.dow === day.dow && c.block === block.block,
                    );
                    const count = cell?.count ?? 0;
                    return (
                      <td key={block.block} className="p-0">
                        <div
                          data-testid={`heat-${day.dow}-${block.block}`}
                          data-count={count}
                          title={`${day.label} ${block.label} UTC — ${count} event(s)`}
                          className={`h-6 w-full rounded ${cellClass(cell?.intensity ?? 0, count)}`}
                        >
                          <span className="sr-only">
                            {day.label} {block.label} UTC: {count} events
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-muted" data-testid="heatmap-caption">
        {total} event{total === 1 ? "" : "s"} · busiest block {max} · an event is a
        quiz attempt, a submission, a coding run or an attendance record. Shading is
        relative to the busiest block, so this shows the shape of the week.
      </p>
    </Card>
  );
}
