// =============================================================================
// Leaderboard URL builder. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// The tabs and the sortable column headers are plain <a> links, not client-side
// state. That is a deliberate choice: it keeps the whole leaderboard a server
// component (no hydration, no fetch-on-mount spinner), every view is a
// bookmarkable and shareable URL, and sorting still works with JavaScript off.
// The cost is a round trip per sort click — negligible for one 50-80 row table,
// and the alternative would ship the entire cohort's scores to the browser to
// re-sort locally.
// =============================================================================

import type {
  LeaderboardScope,
  LeaderboardSortKey,
  SortDirection,
} from "@/lib/leaderboard/types";

export const LEADERBOARD_PATH = "/leaderboard";

export interface LeaderboardLinkState {
  scope: LeaderboardScope;
  weekId: number | null;
  cohortId: number | null;
  sort: LeaderboardSortKey;
  direction: SortDirection;
}

/**
 * Build a /leaderboard URL from the current state plus an override.
 * Defaults are omitted from the query string so the canonical view is a clean
 * `/leaderboard` rather than `/leaderboard?scope=overall&sort=rank&dir=asc`.
 */
export function leaderboardHref(
  state: LeaderboardLinkState,
  override: Partial<LeaderboardLinkState> = {},
): string {
  const next = { ...state, ...override };
  const params = new URLSearchParams();

  if (next.scope !== "overall") params.set("scope", next.scope);
  if (next.scope === "week" && next.weekId !== null) {
    params.set("weekId", String(next.weekId));
  }
  if (next.cohortId !== null) params.set("cohortId", String(next.cohortId));
  if (next.sort !== "rank") params.set("sort", next.sort);
  if (!(next.sort === "rank" && next.direction === "asc")) {
    params.set("dir", next.direction);
  }

  const qs = params.toString();
  return qs ? `${LEADERBOARD_PATH}?${qs}` : LEADERBOARD_PATH;
}
