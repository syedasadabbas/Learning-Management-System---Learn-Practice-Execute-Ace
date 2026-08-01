// =============================================================================
// DISPLAY SORTING — pure, no database. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// Separate from ./ranking.ts on purpose. `ranking.ts` decides a student's RANK,
// which is a persisted, cohort-wide fact. This file decides ROW ORDER in the
// table, which is a per-request UI preference. Conflating them is how "sort by
// name" ends up rewriting everyone's rank.
//
// Sorting happens in JavaScript over the already-fetched rows rather than as a
// per-request ORDER BY. A cohort is 50-80 students (see src/db/schema.ts), so
// the whole board is one small result set; sorting it here means the six
// sortable columns need no extra indexes and no dynamic SQL.
// =============================================================================

import type {
  LeaderboardEntry,
  LeaderboardSortKey,
  SortDirection,
  WeeklyLeaderboardEntry,
} from "./types";
import { SORT_KEYS } from "./types";

/** Narrow untrusted query-string input to a real sort key. */
export function parseSortKey(raw: string | null | undefined): LeaderboardSortKey {
  if (raw && (SORT_KEYS as readonly string[]).includes(raw)) {
    return raw as LeaderboardSortKey;
  }
  return "rank";
}

/**
 * Narrow untrusted query-string input to a direction, or null when absent.
 * Null is meaningful: it means "use the column's natural direction", which is
 * resolved once in the query layer so the API and the page cannot disagree.
 */
export function parseDirection(raw: string | null | undefined): SortDirection | null {
  if (raw === "asc" || raw === "desc") return raw;
  return null;
}

/**
 * The direction a column should use when the user first clicks it.
 * Scores read best highest-first; rank and name read best lowest-first.
 */
export function defaultDirectionFor(key: LeaderboardSortKey): SortDirection {
  return key === "rank" || key === "name" ? "asc" : "desc";
}

/**
 * Sentinel returned by `nullsLast` when at least one side is null, meaning
 * "I have decided this pair, do NOT apply the direction sign to my answer".
 *
 * The obvious `value ?? -Infinity` trick is wrong: it puts unrated students last
 * ascending and FIRST descending, so clicking "Stars" to see the best-rated
 * students shows a screenful of "—" instead. Nulls must sink in both directions,
 * which means they cannot go through the sign multiplication at all.
 */
const NOT_DECIDED = Symbol("not-decided");

function nullsLast(a: number | null, b: number | null): number | typeof NOT_DECIDED {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return NOT_DECIDED;
}

/** Which columns a weekly board can actually sort by. */
const WEEKLY_SORTABLE: readonly LeaderboardSortKey[] = ["rank", "name", "total", "stars"];

/** Sort overall-board rows. Returns a new array; the input is not mutated. */
export function sortEntries(
  entries: readonly LeaderboardEntry[],
  key: LeaderboardSortKey,
  direction: SortDirection,
): LeaderboardEntry[] {
  const sign = direction === "asc" ? 1 : -1;

  return [...entries].sort((a, b) => {
    let cmp: number;
    switch (key) {
      case "name":
        cmp = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
        break;
      case "total":
        cmp = a.totalScore - b.totalScore;
        break;
      case "quiz":
        cmp = a.quizScore - b.quizScore;
        break;
      case "assignment":
        cmp = a.assignmentScore - b.assignmentScore;
        break;
      case "participation":
        cmp = a.participationScore - b.participationScore;
        break;
      case "finalProject":
        cmp = a.finalProjectScore - b.finalProjectScore;
        break;
      case "stars": {
        const nulls = nullsLast(a.avgStars, b.avgStars);
        if (nulls !== NOT_DECIDED) return nulls === 0 ? a.ranking - b.ranking : nulls;
        cmp = (a.avgStars as number) - (b.avgStars as number);
        break;
      }
      case "rank":
      default:
        cmp = a.ranking - b.ranking;
        break;
    }
    // Rank is the tiebreak for every other column, so equal values keep the
    // canonical cohort order instead of whatever order the driver returned.
    if (cmp === 0) return a.ranking - b.ranking;
    return cmp * sign;
  });
}

/**
 * Sort per-week rows.
 *
 * A weekly board has no component breakdown, so a `sort=quiz` carried over from
 * the overall tab is not applicable. It degrades to rank order in the column's
 * NATURAL direction rather than inheriting `dir=desc`, which would otherwise
 * silently show the weekly board upside down (last place first).
 */
export function sortWeeklyEntries(
  entries: readonly WeeklyLeaderboardEntry[],
  key: LeaderboardSortKey,
  direction: SortDirection,
): WeeklyLeaderboardEntry[] {
  const supported = WEEKLY_SORTABLE.includes(key);
  const effectiveKey: LeaderboardSortKey = supported ? key : "rank";
  const sign = (supported ? direction : defaultDirectionFor("rank")) === "asc" ? 1 : -1;

  return [...entries].sort((a, b) => {
    let cmp: number;
    switch (effectiveKey) {
      case "name":
        cmp = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
        break;
      case "total":
        cmp = a.weekScore - b.weekScore;
        break;
      case "stars": {
        const nulls = nullsLast(a.avgStars, b.avgStars);
        if (nulls !== NOT_DECIDED) return nulls === 0 ? a.ranking - b.ranking : nulls;
        cmp = (a.avgStars as number) - (b.avgStars as number);
        break;
      }
      case "rank":
      default:
        cmp = a.ranking - b.ranking;
        break;
    }
    if (cmp === 0) return a.ranking - b.ranking;
    return cmp * sign;
  });
}
