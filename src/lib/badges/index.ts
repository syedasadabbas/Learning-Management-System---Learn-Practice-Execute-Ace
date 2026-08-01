// =============================================================================
// BADGES BARREL — what other streams may import. Owner: badges stream.
// -----------------------------------------------------------------------------
// Import from "@/lib/badges", not from a file inside it, so that the internal
// split (catalogue / facts / evaluate / award / service) stays free to move.
//
// A NOTE ON THE WORD "BADGE", because this codebase now uses it for two things:
//   * `Badge` in @/components/ui is a PILL — a visual label primitive.
//   * a badge here is an AWARDED ACHIEVEMENT.
// The components in @/components/badges are therefore named Achievement*, and they
// reuse the `Badge` primitive for rendering rather than forking its styles.
// =============================================================================

export {
  BADGE_CATALOGUE,
  BADGE_LIST,
  BADGE_RARITIES,
  BADGE_TYPES,
  CODING_GENIUS_PROBLEMS,
  RARITY_TONE,
  badgeDefinition,
  highScoreThreshold,
  isBadgeType,
} from "./catalogue";
export type { BadgeDefinition, BadgeRarity, BadgeType } from "./catalogue";

export { evaluateBadges } from "./evaluate";
export type { BadgeFacts, EarnedBadge } from "./evaluate";

export { loadBadgeFacts } from "./facts";

export {
  awardBadge,
  awardBadges,
  countBadgesForStudents,
  listStudentBadges,
} from "./award";
export type { AwardResult, AwardRow } from "./award";

export { evaluateAndAwardBadges } from "./service";
export type { EvaluationReport } from "./service";

/**
 * The trigger. Called by src/lib/leaderboard/on-scoring-event.ts, which is the
 * single fan-out point for "a student's score changed" — see that call site and
 * ./on-scoring-event.ts for why no second event mechanism was built.
 */
export { awardBadgesForScoringEvent } from "./on-scoring-event";

export { getBadgeView, toBadgeViewJson } from "./queries";
export type { BadgeView, BadgeViewEntry, BadgeViewJson } from "./queries";
