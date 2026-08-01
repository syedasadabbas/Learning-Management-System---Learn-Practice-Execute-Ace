// =============================================================================
// Progress component barrel. Owner: progress-tracking stream.
// Import from "@/components/progress"; do not deep-import a file.
// =============================================================================

export { ProgressSummary } from "./ProgressSummary";
export type { ProgressSummaryProps } from "./ProgressSummary";

export { WeekProgressCard } from "./WeekProgressCard";
export type { WeekProgressCardProps } from "./WeekProgressCard";

export { WeekProgressList, lockReasonFor } from "./WeekProgressList";
export type { WeekProgressListProps } from "./WeekProgressList";

export {
  DISPLAY_LOCALE,
  DISPLAY_TIME_ZONE,
  formatDate,
  isoAttribute,
  lectureCountLabel,
  lecturePercent,
  quizPercentLabel,
  relativeDays,
} from "./format";
