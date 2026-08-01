// =============================================================================
// FORUM COMPONENT BARREL. Owner: forums stream.
// -----------------------------------------------------------------------------
// The pages import from "@/components/forums" only, so the split between the
// server components (ForumTopicList, ForumPostViewer) and the client ones
// (PostComposer's exports) is not a thing a page has to know or get wrong.
//
// NOTE the directory is `forums/` (plural), not the `forum/` the roadmap's file
// list writes (IMPLEMENTATION_ROADMAP.md:419-421). Plural matches the ownership
// boundary this stream was given and every sibling directory in
// src/components/** that names a feature area (courses/, exercises/, problems/,
// videos/). One letter, but a stream that half-uses both spellings ends up with
// two directories.
// =============================================================================

export { ForumTopicList } from "./ForumTopicList";
export type { ForumTopicListProps } from "./ForumTopicList";

export { ForumPostViewer } from "./ForumPostViewer";
export type { ForumPostViewerProps } from "./ForumPostViewer";

export {
  NewTopicComposer,
  PostControls,
  ReplyComposer,
  TopicModeration,
} from "./PostComposer";
export type {
  NewTopicComposerProps,
  PostControlsProps,
  ReplyComposerProps,
  TopicModerationProps,
} from "./PostComposer";
