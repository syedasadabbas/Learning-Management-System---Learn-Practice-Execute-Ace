// =============================================================================
// Sortable column header. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// Accessibility: the <th> carries `aria-sort` (ascending/descending/none) so a
// screen reader announces the current sort, and the arrow glyph is aria-hidden
// because `aria-sort` already conveys it. A visible-only arrow with no aria-sort
// is the usual mistake here.
// =============================================================================

import Link from "next/link";

import { cn } from "@/components/ui";
import { defaultDirectionFor } from "@/lib/leaderboard/sorting";
import type { LeaderboardSortKey } from "@/lib/leaderboard/types";
import { leaderboardHref, type LeaderboardLinkState } from "./query-link";

export interface SortableHeaderProps {
  columnKey: LeaderboardSortKey;
  label: string;
  state: LeaderboardLinkState;
  /** Right-align numeric columns. */
  numeric?: boolean;
  /** Hidden below the `sm` breakpoint — used for the component-score columns. */
  compact?: boolean;
}

export function SortableHeader({
  columnKey,
  label,
  state,
  numeric = false,
  compact = false,
}: SortableHeaderProps) {
  const active = state.sort === columnKey;

  // Clicking the active column flips it; clicking a new one starts at that
  // column's natural direction (scores high-first, rank and name low-first).
  const nextDirection = active
    ? state.direction === "asc"
      ? "desc"
      : "asc"
    : defaultDirectionFor(columnKey);

  const ariaSort = active
    ? state.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      data-testid={`lb-header-${columnKey}`}
      className={cn(
        "px-3 py-2 text-xs font-semibold tracking-wide text-ink-muted uppercase",
        numeric ? "text-right" : "text-left",
        compact && "hidden sm:table-cell",
      )}
    >
      <Link
        href={leaderboardHref(state, { sort: columnKey, direction: nextDirection })}
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline-2",
          "focus-visible:outline-offset-2 focus-visible:outline-brand",
          active && "text-brand",
        )}
      >
        {label}
        <span aria-hidden="true" className={cn("text-[10px]", !active && "opacity-30")}>
          {active ? (state.direction === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </Link>
    </th>
  );
}
