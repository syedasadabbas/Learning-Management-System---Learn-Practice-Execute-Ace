"use client";

// =============================================================================
// <ClassCalendar /> — upcoming classes, grouped by day.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// KNOWN DEFECT, SURFACED RATHER THAN HIDDEN: `GET /api/classes/upcoming` HAS NO
// COHORT SCOPING. Every signed-in student sees every scheduled class in the
// system, including ones belonging to cohorts they are not in. The API stream
// flagged it; this component does not paper over it. The note below the list
// says so in plain language, because a student who turns up to somebody else's
// class has been misled by this screen, and a UI that quietly renders a wrong
// list is worse than one that admits the list is wrong. Fixing it is a change
// to that route's WHERE clause, which is outside this stream's blast radius.
//
// WHY A GROUPED LIST AND NOT A MONTH GRID. A seven-by-five grid of cells cannot
// be made to work at 360 px: each cell is 45 px wide, which fits neither a time
// nor a title, and every implementation ends up with a horizontal scroller or a
// tap-to-reveal that hides the content the page exists to show. A list grouped
// by day carries the same information, reads top-to-bottom on a phone, and is
// navigable by a screen reader as nested headings and lists — which a grid of
// divs is not.
//
// DATES ARE FORMATTED IN THE VIEWER'S TIMEZONE, from the UTC instant the API
// returns. That is the correct direction: the class happens at one instant, and
// each student should read it as their own wall clock.
// =============================================================================

import * as React from "react";

import { AsyncSection } from "@/components/async/AsyncSection";
import { Badge, Button, Card, cn } from "@/components/ui";
import { apiPathWithQuery } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";
import type { Paginated } from "@/lib/learning/pagination";

import { ClassStatusBadge } from "./ClassStatusBadge";
import type { LiveClassSummary } from "./types";

const UPCOMING_ROUTE = "GET  /api/classes/upcoming" as const;

/** `days` window accepted by the route: 1..90, default 14. */
export const DEFAULT_WINDOW_DAYS = 14;

/**
 * Group classes into day buckets, preserving the server's ordering within each.
 *
 * The key is the LOCAL date, derived with `toLocaleDateString`, not the ISO
 * date prefix: a class at 23:30 UTC is tomorrow for a student in Karachi, and
 * slicing the ISO string would file it under the wrong heading for exactly the
 * people most likely to be affected.
 *
 * Exported for the unit test — a grouping that only fails across a midnight
 * boundary in one timezone is not something to verify by looking at it.
 */
export function groupByLocalDay(
  classes: readonly LiveClassSummary[],
  locale?: string,
): Array<{ key: string; label: string; items: LiveClassSummary[] }> {
  const buckets = new Map<string, { label: string; items: LiveClassSummary[] }>();

  for (const item of classes) {
    const when = new Date(item.scheduledAt);
    if (Number.isNaN(when.getTime())) continue;

    // `en-CA` yields YYYY-MM-DD, which sorts lexicographically — the one place
    // a locale is pinned, and only because it is being used as a sort key
    // rather than shown to anybody.
    const key = when.toLocaleDateString("en-CA");
    const label = when.toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { label, items: [item] });
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, ...value }));
}

/** Local wall-clock time of a UTC instant, e.g. "14:00". */
export function formatLocalTime(iso: string, locale?: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "time unknown";
  return when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export interface ClassCalendarProps {
  /** How far ahead to look, in days. 1..90. */
  days?: number;
  /** Builds the link to a class page. Supplied by the page, which owns routing. */
  hrefFor?: (classId: number) => string;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function ClassCalendar({
  days = DEFAULT_WINDOW_DAYS,
  hrefFor = (classId) => `/classes/${classId}`,
  className,
  fetchImpl,
}: ClassCalendarProps) {
  const url = React.useMemo(
    () => apiPathWithQuery(UPCOMING_ROUTE, {}, { days, limit: 100 }),
    [days],
  );

  const { state, reload } = useApiResource<Paginated<LiveClassSummary>>(
    UPCOMING_ROUTE,
    url,
    { fetchImpl },
  );

  return (
    <section
      aria-labelledby="class-calendar-heading"
      className={cn("flex flex-col gap-3", className)}
      data-testid="class-calendar"
    >
      <h2 id="class-calendar-heading" className="text-lg font-semibold text-ink">
        {`Classes in the next ${days} days`}
      </h2>

      <AsyncSection
        state={state}
        loadingLabel="Loading upcoming classes"
        loadingLines={4}
        onRetry={() => void reload()}
        isEmpty={(page) => page.items.length === 0}
        emptyTitle="No classes scheduled"
        emptyDescription="Nothing is on the calendar for this window. Live sessions are announced by your instructor."
      >
        {(page) => (
          <div className="flex flex-col gap-5">
            {groupByLocalDay(page.items).map((day) => (
              <div key={day.key}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
                  {day.label}
                </h3>
                <ul className="flex flex-col gap-2">
                  {day.items.map((item) => (
                    <li key={item.id}>
                      <Card
                        padded
                        data-testid={`calendar-class-${item.id}`}
                        title={item.title}
                        subtitle={`${formatLocalTime(item.scheduledAt)} — ${item.durationMinutes} min`}
                        action={<ClassStatusBadge status={item.status} />}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {item.instructorName && (
                            <Badge tone="neutral" size="sm">
                              {item.instructorName}
                            </Badge>
                          )}
                          <Button
                            variant={item.status === "active" ? "primary" : "secondary"}
                            size="sm"
                            onClick={() => {
                              window.location.href = hrefFor(item.id);
                            }}
                          >
                            {item.status === "active" ? "Join now" : "Class details"}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </AsyncSection>

      {/* The honest caveat. See the module header. */}
      <p className="text-xs text-ink-muted" data-testid="calendar-scope-caveat">
        This list is not filtered by cohort yet, so it may include sessions run for other
        groups. Check the instructor and the week before joining.
      </p>
    </section>
  );
}
