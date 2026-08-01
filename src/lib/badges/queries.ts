// =============================================================================
// BADGE READ MODEL — what /badges and GET /api/me/badges both render from.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// ONE function serves the page and the API route, for the reason
// src/app/(app)/leaderboard/page.tsx:5-9 states for `getLeaderboardView`: a server
// component that fetched its own HTTP endpoint would pay an extra round trip and
// have to forward the session cookie by hand, and two independent queries for one
// screen is how a page and its API start disagreeing.
//
// -----------------------------------------------------------------------------
// THE VIEW SHOWS UNEARNED BADGES TOO, AND THAT IS THE POINT.
//
// A grid of only-what-you-have is a trophy cabinet; a grid that also shows what is
// available, with the threshold spelled out, is the thing that produces the
// 10-15% re-engagement the feature is justified by (INTEGRATION_SUMMARY.md:109).
// So the catalogue is the spine of the view and the awards are joined onto it —
// which is also why an award row for a badge this build does not know about simply
// does not appear (./award.ts#listStudentBadges drops it).
// =============================================================================

import {
  BADGE_LIST,
  RARITY_TONE,
  type BadgeDefinition,
  type BadgeRarity,
  type BadgeType,
} from "./catalogue";
import { listStudentBadges, type Db } from "./award";
import { evaluateAndAwardBadges } from "./service";

/** One card on the /badges page: a definition plus this student's state for it. */
export interface BadgeViewEntry extends BadgeDefinition {
  earned: boolean;
  /** Null when unearned. */
  awardedAt: Date | null;
  /** The numbers that justified the award. Null when unearned. */
  evidence: Record<string, unknown> | null;
}

export interface BadgeView {
  studentId: number;
  entries: BadgeViewEntry[];
  earnedCount: number;
  totalCount: number;
  /**
   * Badges awarded by THIS read, if the read re-evaluated. Lets the page say
   * "you just earned X" rather than silently gaining a card. Empty is the norm.
   */
  newlyAwarded: BadgeType[];
}

/** Rarity -> tone, re-exported so a component never re-derives the mapping. */
export { RARITY_TONE };
export type { BadgeRarity };

/**
 * The full badge view for one student.
 *
 * `evaluate: true` RE-EVALUATES THE CRITERIA BEFORE READING, which means a GET can
 * write. That is a deliberate choice and here is the justification, because "a read
 * that writes" is normally a smell:
 *
 *   * It is the BACKFILL PATH. A student who earned something before this feature
 *     shipped, or before a badge was added to the catalogue, has no award row and no
 *     pending scoring event to produce one — their course may be over. Without this,
 *     the only way to get them their badge is an operator script.
 *   * It is IDEMPOTENT AND CHEAP. One facts query plus up to five INSERTs that all
 *     conflict and change nothing (./service.ts:14-21). It cannot produce a
 *     duplicate however many times it runs, because the uniqueness decision is the
 *     unique index's and not this code's — which is the same property that makes it
 *     safe for two students' browsers to refresh at the same instant.
 *   * It CANNOT FAIL THE PAGE. `evaluateAndAwardBadges` never throws.
 *
 * The page is `force-dynamic` and per-session anyway, so nothing is being cached
 * that this invalidates. Pass `evaluate: false` for a read that must not write —
 * an instructor viewing someone else's profile, for instance, where awarding on
 * another user's behalf from a staff page would be surprising.
 */
export async function getBadgeView(
  studentId: number,
  options: { evaluate?: boolean; client?: Db } = {},
): Promise<BadgeView> {
  const id = Math.trunc(studentId);
  const shouldEvaluate = options.evaluate ?? true;

  const newlyAwarded = shouldEvaluate
    ? (await evaluateAndAwardBadges(id, { client: options.client })).newlyAwarded
    : [];

  const awards = await listStudentBadges(id, options.client);
  const byType = new Map(awards.map((a) => [a.type, a]));

  // Catalogue order, not award order: the page is a stable grid, so cards must not
  // reshuffle when a badge is earned. `awardedAt` carries the recency for anything
  // that wants to sort by it.
  const entries: BadgeViewEntry[] = BADGE_LIST.map((definition) => {
    const award = byType.get(definition.type);
    return {
      ...definition,
      earned: award !== undefined,
      awardedAt: award?.awardedAt ?? null,
      evidence: award?.evidence ?? null,
    };
  });

  return {
    studentId: id,
    entries,
    earnedCount: entries.filter((e) => e.earned).length,
    totalCount: entries.length,
    newlyAwarded,
  };
}

/**
 * JSON-safe form of the view, for the API route.
 *
 * Dates become ISO 8601 strings explicitly rather than relying on
 * `JSON.stringify`'s implicit `toJSON`, so the wire shape is declared in one place
 * and a client cannot start depending on a `Date` that only exists server-side.
 */
export interface BadgeViewJson {
  studentId: number;
  entries: Array<Omit<BadgeViewEntry, "awardedAt"> & { awardedAt: string | null }>;
  earnedCount: number;
  totalCount: number;
  newlyAwarded: BadgeType[];
}

export function toBadgeViewJson(view: BadgeView): BadgeViewJson {
  return {
    studentId: view.studentId,
    entries: view.entries.map(({ awardedAt, ...rest }) => ({
      ...rest,
      awardedAt: awardedAt ? awardedAt.toISOString() : null,
    })),
    earnedCount: view.earnedCount,
    totalCount: view.totalCount,
    newlyAwarded: view.newlyAwarded,
  };
}
