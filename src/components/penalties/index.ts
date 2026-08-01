// Penalty components — owned by the `penalties-attendance` stream.
// `PenaltyList` and `SeverityBadge` are presentational and server-safe; they take
// plain data, so the instructor-admin and progress-tracking streams can compose
// them on any page without importing this stream's services.
export { SeverityBadge, PENALTY_TYPE_LABELS } from "./SeverityBadge";
export type { SeverityBadgeProps } from "./SeverityBadge";

export { PenaltyList } from "./PenaltyList";
export type { PenaltyListProps, PenaltyListItem } from "./PenaltyList";

export { ResolvePenaltyButton } from "./ResolvePenaltyButton";
export type { ResolvePenaltyButtonProps } from "./ResolvePenaltyButton";
