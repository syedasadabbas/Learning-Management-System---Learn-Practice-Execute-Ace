// =============================================================================
// ACHIEVEMENT COMPONENT BARREL. Owner: badges stream.
// -----------------------------------------------------------------------------
// NOT called "Badge*". `Badge` in @/components/ui is a visual PILL primitive; a
// badge in this feature is an AWARDED ACHIEVEMENT. See ./AchievementCard.tsx:4-17
// for the whole argument. These components REUSE that primitive for their rarity
// pills rather than forking its styles.
// =============================================================================

export { AchievementCard } from "./AchievementCard";
export type { AchievementCardProps } from "./AchievementCard";

export { AchievementGrid, AchievementSummary } from "./AchievementGrid";
export type { AchievementGridProps, AchievementSummaryProps } from "./AchievementGrid";
