// =============================================================================
// THE ACHIEVEMENT GRID plus its summary line. Owner: badges stream.
// -----------------------------------------------------------------------------
// See ./AchievementCard.tsx for why nothing in this directory is called "Badge".
//
// Both server components. The grid is a `<ul>` because it is a list of things, so
// a screen reader announces "list, 5 items" rather than a wall of divs.
// =============================================================================

import * as React from "react";

import { Badge, ProgressBar, cn } from "@/components/ui";
import type { BadgeType, BadgeViewEntry } from "@/lib/badges";

import { AchievementCard } from "./AchievementCard";

export interface AchievementGridProps {
  entries: readonly BadgeViewEntry[];
  /** Types awarded by the request that rendered this page. Highlighted. */
  justEarned?: readonly BadgeType[];
  className?: string;
}

export function AchievementGrid({ entries, justEarned = [], className }: AchievementGridProps) {
  const fresh = new Set(justEarned);

  return (
    <ul
      data-testid="achievement-grid"
      className={cn(
        // Mobile-first, and the breakpoints are chosen so a card never gets
        // narrower than its longest criteria line can wrap to comfortably.
        "grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {entries.map((entry) => (
        <li key={entry.type} className="contents">
          {/* `contents` so the <li> does not become a grid item in its own right
              and break the card's `h-full`. */}
          <AchievementCard entry={entry} justEarned={fresh.has(entry.type)} />
        </li>
      ))}
    </ul>
  );
}

export interface AchievementSummaryProps {
  earnedCount: number;
  totalCount: number;
  className?: string;
}

/**
 * "3 of 5 earned", with a progress bar.
 *
 * Uses the shared `ProgressBar` primitive rather than a hand-rolled div pair, and
 * guards `totalCount === 0` — an empty catalogue would otherwise divide by zero and
 * render NaN% into the DOM.
 */
export function AchievementSummary({
  earnedCount,
  totalCount,
  className,
}: AchievementSummaryProps) {
  const percent = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  return (
    <div
      data-testid="achievement-summary"
      data-earned-count={earnedCount}
      data-total-count={totalCount}
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex items-center gap-2">
        <Badge tone={earnedCount > 0 ? "brand" : "neutral"} size="md">
          {earnedCount} of {totalCount} earned
        </Badge>
        {earnedCount === totalCount && totalCount > 0 && (
          <Badge tone="success" size="md">
            Complete
          </Badge>
        )}
      </div>
      <ProgressBar
        percent={percent}
        tone={earnedCount === totalCount && totalCount > 0 ? "success" : "brand"}
        // `ariaLabel` rather than a visible `label`: the Badge above already states
        // the same thing in text, so a second visible label would be a duplicate —
        // but a bare track has no accessible name at all.
        ariaLabel={`${earnedCount} of ${totalCount} achievements earned`}
        // One bar, rendered once at the top of the page: the sweep is polish here
        // rather than the "dozen bars all sweeping at once" the prop warns about.
        animateFill
      />
    </div>
  );
}
