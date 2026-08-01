// =============================================================================
// ACTIVITY LOG FILTERS — activity-logs stream.
// -----------------------------------------------------------------------------
// FILTERS ARE LINKS, NOT CLIENT STATE, following the convention
// src/components/instructor/QueueTable.tsx:4-6 established for the grading queue.
// For an audit surface that choice is worth more than it is there:
//
//   * a filtered view is a URL, so an investigator can paste "every failed login
//     for actor 7 between these dates" into a ticket and a colleague sees exactly
//     the same rows;
//   * the CSV export can be handed the same query string, so the file matches the
//     screen it was taken from — an export that quietly applies a different filter
//     is a compliance artefact nobody actually reviewed;
//   * the table stays a server component with no hydration cost, which matters on
//     the largest table in the database.
//
// NO NEW CONSOLE. This renders inside (staff)/admin/* with the shared AppShell,
// the same StatTile row and the same chip-link vocabulary as /admin/videos and
// /admin/course-requests, per the brief's instruction to match the existing admin
// surface rather than invent one.
// =============================================================================

import Link from "next/link";

import { buttonClasses } from "@/components/ui";
import {
  ACTIVITY_CATEGORIES,
  actionLabel,
  actionsInCategory,
  type ActivityActionName,
  type ActivityCategory,
  type ActivityFilter,
} from "@/lib/activity";

export interface ActivityFiltersProps {
  filter: ActivityFilter;
  /** The active category, when the URL selected one. Chips highlight from this. */
  activeCategory: ActivityCategory | null;
  /** Actors seen in the log, most active first. Derived from the log, not `users`. */
  actors: ReadonlyArray<{ id: number; name: string; email: string; events: number }>;
  /** Per-action counts inside the summary window, for the chip badges. */
  actionCounts: Partial<Record<ActivityActionName, number>>;
  basePath?: string;
}

/** Day-range shortcuts. Whole days, because the retention policy is in days. */
const DAY_RANGES = [1, 7, 30, 90] as const;

/**
 * Build a URL preserving the other filters.
 *
 * `before` is dropped on every change on purpose: keeping a keyset cursor across a
 * filter change would page from a row that the new filter may not even include, and
 * the result would be a window with a silently missing head — the one defect an
 * audit table must not have.
 */
function href(
  basePath: string,
  filter: ActivityFilter,
  patch: Partial<Record<string, string | null>>,
): string {
  const params = new URLSearchParams();
  if (filter.actorId !== null) params.set("actor", String(filter.actorId));
  if (filter.status) params.set("status", filter.status);
  if (filter.entityType) params.set("entityType", filter.entityType);
  if (filter.entityId !== null) params.set("entityId", String(filter.entityId));
  if (filter.from) params.set("from", filter.from.toISOString());
  if (filter.to) params.set("to", filter.to.toISOString());

  for (const [key, value] of Object.entries(patch)) {
    // `undefined` and `null` both mean "remove this parameter": a chip that clears a
    // filter and one that never set it must produce the same URL, or the "All" chip
    // stops being idempotent.
    if (value === null || value === undefined) params.delete(key);
    else params.set(key, value);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  identity: "Identity",
  assessment: "Assessment",
  coursework: "Coursework",
  administration: "Administration",
  audit: "Audit trail",
};

export function ActivityFilters({
  filter,
  activeCategory,
  actors,
  actionCounts,
  basePath = "/admin/activity",
}: ActivityFiltersProps) {
  const activeActions = filter.actions;
  const singleAction =
    activeActions && activeActions.length === 1 ? activeActions[0] : null;

  return (
    <div className="space-y-3" data-testid="activity-filters">
      {/* --- category ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase text-ink-muted">Category</span>
        <Link
          href={href(basePath, filter, { category: null, action: null })}
          data-testid="filter-category-all"
          aria-current={activeCategory === null && !activeActions ? "page" : undefined}
          className={buttonClasses(
            activeCategory === null && !activeActions ? "primary" : "secondary",
            "sm",
          )}
        >
          All
        </Link>
        {ACTIVITY_CATEGORIES.map((category) => (
          <Link
            key={category}
            href={href(basePath, filter, { category, action: null })}
            data-testid={`filter-category-${category}`}
            aria-current={activeCategory === category ? "page" : undefined}
            className={buttonClasses(
              activeCategory === category ? "primary" : "secondary",
              "sm",
            )}
          >
            {CATEGORY_LABEL[category]}
          </Link>
        ))}
      </div>

      {/* --- action, scoped to the chosen category ------------------------- */}
      {activeCategory && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase text-ink-muted">Action</span>
          {actionsInCategory(activeCategory).map((action) => (
            <Link
              key={action}
              href={href(basePath, filter, { category: activeCategory, action })}
              data-testid={`filter-action-${action}`}
              aria-current={singleAction === action ? "page" : undefined}
              className={buttonClasses(singleAction === action ? "primary" : "secondary", "sm")}
            >
              {actionLabel(action)}
              <span className="ml-1 tabular-nums opacity-70">{actionCounts[action] ?? 0}</span>
            </Link>
          ))}
        </div>
      )}

      {/* --- outcome ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase text-ink-muted">Outcome</span>
        <Link
          href={href(basePath, filter, { status: null })}
          data-testid="filter-status-all"
          aria-current={filter.status === null ? "page" : undefined}
          className={buttonClasses(filter.status === null ? "primary" : "secondary", "sm")}
        >
          Any
        </Link>
        {(["success", "failure"] as const).map((status) => (
          <Link
            key={status}
            href={href(basePath, filter, { status })}
            data-testid={`filter-status-${status}`}
            aria-current={filter.status === status ? "page" : undefined}
            className={buttonClasses(filter.status === status ? "primary" : "secondary", "sm")}
          >
            {status === "success" ? "Succeeded" : "Failed"}
          </Link>
        ))}
      </div>

      {/* --- time range ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase text-ink-muted">Range</span>
        <Link
          href={href(basePath, filter, { days: null, from: null, to: null })}
          data-testid="filter-range-all"
          aria-current={filter.from === null ? "page" : undefined}
          className={buttonClasses(filter.from === null ? "primary" : "secondary", "sm")}
        >
          All time
        </Link>
        {DAY_RANGES.map((days) => (
          <Link
            key={days}
            href={href(basePath, filter, { days: String(days), from: null, to: null })}
            data-testid={`filter-range-${days}`}
            className={buttonClasses("secondary", "sm")}
          >
            {days === 1 ? "Last 24 h" : `Last ${days} days`}
          </Link>
        ))}
      </div>

      {/* --- actor --------------------------------------------------------- */}
      {actors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase text-ink-muted">Actor</span>
          <Link
            href={href(basePath, filter, { actor: null })}
            data-testid="filter-actor-all"
            aria-current={filter.actorId === null ? "page" : undefined}
            className={buttonClasses(filter.actorId === null ? "primary" : "secondary", "sm")}
          >
            Anyone
          </Link>
          {actors.map((actor) => (
            <Link
              key={actor.id}
              href={href(basePath, filter, { actor: String(actor.id) })}
              data-testid={`filter-actor-${actor.id}`}
              aria-current={filter.actorId === actor.id ? "page" : undefined}
              className={buttonClasses(
                filter.actorId === actor.id ? "primary" : "secondary",
                "sm",
              )}
              // The address is shown to an admin who is already authorised to see
              // it, and only as a tooltip — the visible label is the name, so a
              // screenshot of this console does not spread addresses further.
              title={actor.email}
            >
              {actor.name}
              <span className="ml-1 tabular-nums opacity-70">{actor.events}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
