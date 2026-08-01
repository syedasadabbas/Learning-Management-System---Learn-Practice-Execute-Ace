// =============================================================================
// Overall / per-week tabs, week picker and cohort picker. Owner: leaderboard.
// -----------------------------------------------------------------------------
// Every control is a link (see ./query-link.ts for why). The tab strip uses the
// ARIA tab pattern's roles but NOT its keyboard model, because these are real
// navigations rather than in-page panels — so `role="tablist"` is applied to a
// <nav> and each tab carries `aria-current`, which is what assistive tech
// actually needs for link-based tabs.
// =============================================================================

import Link from "next/link";

import { cn } from "@/components/ui";
import type {
  LeaderboardCohortOption,
  LeaderboardWeekOption,
} from "@/lib/leaderboard/types";
import { leaderboardHref, type LeaderboardLinkState } from "./query-link";

export interface ViewTabsProps {
  state: LeaderboardLinkState;
  weeks: readonly LeaderboardWeekOption[];
  cohorts: readonly LeaderboardCohortOption[];
}

export function ViewTabs({ state, weeks, cohorts }: ViewTabsProps) {
  const firstWeekId = weeks[0]?.weekId ?? null;
  const activeWeekId = state.weekId ?? firstWeekId;

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label="Leaderboard view"
        data-testid="lb-view-tabs"
        className="inline-flex w-fit rounded-lg border border-line bg-panel p-1"
      >
        <TabLink
          href={leaderboardHref(state, { scope: "overall", weekId: null })}
          active={state.scope === "overall"}
          testId="lb-tab-overall"
        >
          Overall
        </TabLink>
        <TabLink
          href={leaderboardHref(state, { scope: "week", weekId: activeWeekId })}
          active={state.scope === "week"}
          testId="lb-tab-week"
        >
          By week
        </TabLink>
      </nav>

      {state.scope === "week" && weeks.length > 0 && (
        <nav
          aria-label="Week"
          data-testid="lb-week-picker"
          className="flex flex-wrap gap-1.5"
        >
          {weeks.map((week) => (
            <TabLink
              key={week.weekId}
              href={leaderboardHref(state, { scope: "week", weekId: week.weekId })}
              active={week.weekId === activeWeekId}
              testId={`lb-week-${week.weekNumber}`}
              title={week.title}
            >
              Week {week.weekNumber}
            </TabLink>
          ))}
        </nav>
      )}

      {/* Staff only — `cohorts` is empty for students by construction in
          queries.ts, so no role check is needed (or possible) here. */}
      {cohorts.length > 0 && (
        <nav
          aria-label="Cohort"
          data-testid="lb-cohort-picker"
          className="flex flex-wrap gap-1.5"
        >
          {cohorts.map((cohort) => (
            <TabLink
              key={cohort.cohortId}
              href={leaderboardHref(state, { cohortId: cohort.cohortId })}
              active={cohort.cohortId === state.cohortId}
              testId={`lb-cohort-${cohort.cohortId}`}
            >
              {cohort.name}
            </TabLink>
          ))}
        </nav>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  testId,
  title,
  children,
}: {
  href: string;
  active: boolean;
  testId: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        active
          ? "bg-brand text-white"
          : "text-ink-muted hover:bg-surface hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
