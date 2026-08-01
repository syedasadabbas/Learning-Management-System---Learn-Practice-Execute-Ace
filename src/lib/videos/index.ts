// =============================================================================
// VIDEO-INGESTION BARREL — what other streams may import.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// DELIBERATELY NARROW. The pure modules (oembed, sources, rss, harvest, read) are
// re-exported; `store.ts`, `actions.ts` and `access.ts` are NOT, because:
//   * store.ts can see every status, including unreviewed candidates. The only
//     legitimate consumer is this stream's own admin screen, which deep-imports it.
//   * actions.ts is `"use server"`; re-exporting it here would drag a server-action
//     module into any client bundle that touched this barrel.
//
// FOR THE course-content OWNER (the lecture page is your file, not mine): the two
// things you need are `resolveLectureVideo` — or the ready-made
// `<TopicVideoSection>` in `@/components/videos` — and nothing else. Both hand a
// bare id to your existing `VideoEmbed`, which keeps the nocookie host, the id
// validation and the "video coming soon" placeholder exactly as they are.
// =============================================================================

export {
  oembedUrl,
  thumbnailUrlFor,
  validateVideo,
  isTransient,
  OEMBED_TIMEOUT_MS,
  TRANSIENT_REASONS,
} from "./oembed";
export type {
  FetchLike,
  ValidationResult,
  VideoMetadata,
  VideoRejectReason,
} from "./oembed";

export {
  isTopicKey,
  normaliseTopicKey,
  parseCuratedCsv,
  parseCuratedJson,
  parseCuratedSource,
  TOPIC_KEY_MAX_LENGTH,
} from "./sources";
export type { CuratedEntry, ParsedSource, SourceProblem } from "./sources";

export {
  assignEntriesToTopics,
  channelFeedUrl,
  isChannelId,
  matchTopicKey,
  parseChannelFeed,
  RSS_FEED_TYPICAL_ITEM_COUNT,
} from "./rss";
export type { RssAssignment, RssAssignmentResult, RssEntry } from "./rss";

export { formatReport, harvest, mergeSources } from "./harvest";
export type {
  CandidateRow,
  CandidateWriter,
  HarvestOptions,
  HarvestReport,
  RejectedVideo,
  UpsertOutcome,
} from "./harvest";

export {
  formatDuration,
  getApprovedVideo,
  resolveLectureVideo,
  selectApproved,
} from "./read";
export type { ApprovableRow, StudentVideo } from "./read";
