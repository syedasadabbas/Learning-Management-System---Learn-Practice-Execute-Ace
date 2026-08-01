// =============================================================================
// /admin/activity — the audit trail, readable. activity-logs stream.
// -----------------------------------------------------------------------------
// ADMIN ONLY, at two levels and on purpose. The `(staff)` layout already applied
// `requireRole("instructor")`, which admits instructors too
// (`ROLES_SATISFYING.instructor` is ["instructor","admin"]). This page restates
// `requireRole("admin")` for the same reason /admin/videos and
// /admin/course-requests do, and with a sharper edge: this table shows every act of
// every user in the cohort, including instructors' own grading decisions and role
// changes. An instructor who could read it could audit their colleagues and see
// which of their own acts had been reviewed. That is oversight, not teaching, and
// ROUTE_AUTH "admin" (ROLES_SATISFYING.admin is ["admin"] alone) is the level for it.
//
// PLACED UNDER /admin RATHER THAN AS A NEW CONSOLE, per the brief: (staff)/admin/*
// with the shared AppShell from the (staff) layout, `dynamic = "force-dynamic"`, a
// StatTile row, and the chip-link filter vocabulary /admin/videos and
// /admin/course-requests already use. No new console, no new layout, no second
// navigation.
//
// `force-dynamic` is not boilerplate here. A cached audit view is a stale audit
// view: an investigator refreshing during an incident must see what happened
// thirty seconds ago, and any caching layer between them and the table makes the
// absence of a row unreliable — which is the one thing this page must never be.
//
// AN INVALID FILTER RENDERS AN ERROR, NOT AN UNFILTERED TABLE. `?action=logn`
// returns a panel saying so. Silently widening a mistyped filter would show every
// row and let the reader conclude the event they searched for never happened; in an
// investigation that false negative is worse than an error message. Same rule the
// API route and src/app/api/admin/jobs/route.ts:44-49 apply.
// =============================================================================

import type { Metadata } from "next";

import { ActivityFilters, ActivityTable, CoverageNotice } from "@/components/activity";
import { StatTile } from "@/components/instructor";
import { Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import {
  activityActionCounts,
  activityActors,
  activitySummary,
  filterToQuery,
  isActivityCategory,
  isFiltered,
  listActivity,
  parseActivityFilter,
  retentionDays,
  unwiredActions,
  type ActivityCategory,
} from "@/lib/activity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activity log",
};

/**
 * Next 15 hands `searchParams` as a promise of possibly-repeated values.
 * Normalised into `URLSearchParams` so the page and the API route share ONE parser
 * (src/lib/activity/filter.ts) — a second, subtly different implementation for the
 * page is how a filter that works on screen stops working in the export.
 */
function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    // Last wins for a repeated key, matching URLSearchParams.get().
    params.set(key, Array.isArray(value) ? (value[value.length - 1] ?? "") : value);
  }
  return params;
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin");

  const raw = toSearchParams(await searchParams);
  const parsed = parseActivityFilter(raw);

  if (!parsed.ok) {
    return (
      <div className="space-y-6" data-testid="admin-activity">
        <Header />
        <Card title="That filter was rejected" data-testid="activity-filter-error">
          <p className="max-w-prose text-sm text-ink-muted">
            {parsed.error} (<code>{parsed.code}</code>)
          </p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            The filter is refused rather than ignored on purpose: showing you every
            row instead would look like an answer, and &ldquo;no matching
            events&rdquo; must never be something a typo can produce.
          </p>
        </Card>
      </div>
    );
  }

  const filter = parsed.filter;
  const categoryRaw = raw.get("category");
  const activeCategory: ActivityCategory | null = isActivityCategory(categoryRaw)
    ? categoryRaw
    : null;

  // Issued CONCURRENTLY. Four sequential round trips would each cost ~245 ms on a
  // warm pooled connection (measured in src/db/index.ts:63); the pool pre-warms
  // three connections precisely so a page with this fan-out does not pay a
  // handshake mid-request.
  const [page, summary, actors, actionCounts] = await Promise.all([
    listActivity(filter),
    activitySummary(),
    activityActors({ days: 30, limit: 12 }),
    activityActionCounts({ days: 30 }),
  ]);

  const query = filterToQuery(filter).toString();
  const exportHref = `/api/admin/activity/export${query ? `?${query}` : ""}`;

  return (
    <div className="space-y-6" data-testid="admin-activity">
      <Header />

      <div className="grid gap-3 sm:grid-cols-4">
        {/* An ESTIMATE, labelled as one. An exact count(*) on the largest table in
            the database would run on every load of this page — the likeliest way
            this feature becomes the performance problem it exists to watch. */}
        <StatTile label="Events (estimated)" value={summary.total} muted={summary.total === 0} />
        <StatTile label="Last 24 h" value={summary.last24h} muted={summary.last24h === 0} />
        <StatTile
          label="Failures, last 24 h"
          value={summary.failuresLast24h}
          muted={summary.failuresLast24h === 0}
        />
        <StatTile
          label="Actors, last 24 h"
          value={summary.actorsLast24h}
          muted={summary.actorsLast24h === 0}
        />
      </div>

      <ActivityFilters
        filter={filter}
        activeCategory={activeCategory}
        actors={actors}
        actionCounts={actionCounts}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          href={exportHref}
          data-testid="activity-export"
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-panel"
          // A plain anchor, not next/link: this is a file download, and the client
          // router would try to render the CSV as a route.
          download
        >
          Export this view (CSV)
        </a>
        <span className="text-xs text-ink-muted">
          The export applies exactly the filter shown above, and is itself recorded
          as an <code>activity_export</code> event before any bytes are sent.
        </span>
      </div>

      <ActivityTable
        rows={page.rows}
        filtered={isFiltered(filter)}
        nextCursor={page.nextCursor}
        query={query}
      />

      <CoverageNotice unwired={unwiredActions()} retentionDays={retentionDays()} />
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold">Activity log</h1>
      <p className="max-w-prose text-sm text-ink-muted">
        An append-only record of acts, for compliance and security review. Rows are
        never edited; the only deletion is the retention prune, which records itself.
        Times are UTC.
      </p>
    </header>
  );
}
