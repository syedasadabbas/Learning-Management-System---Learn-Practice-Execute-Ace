// =============================================================================
// VIDEO COMPONENT BARREL — video-ingestion stream.
// -----------------------------------------------------------------------------
// `ReviewQueue` is admin-only UI; `TopicVideoSection` is the one-line integration
// the course-content owner drops into the lecture page (see that file's header).
// No embed is reimplemented here — both paths end at
// `@/components/course/VideoEmbed`.
// =============================================================================

export { ReviewQueue } from "./ReviewQueue";
export type { ReviewQueueItem, ReviewQueueProps } from "./ReviewQueue";

export { TopicVideoSection } from "./TopicVideoSection";
export type { TopicVideoSectionProps } from "./TopicVideoSection";
