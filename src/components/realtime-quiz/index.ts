// =============================================================================
// REALTIME-QUIZ COMPONENT BARREL.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// Consumers should import `RealtimeCheckPanel` — it is the whole integration
// surface. `InlineKnowledgeCheck` is exported too, for a caller that already has
// a stripped `InlineCheck` and its own checker (the component tests do).
//
// NOTE for anyone importing from a client component: `RealtimeCheckPanel` is an
// async server component and pulls in the server action and the pg pool. Import
// `./InlineKnowledgeCheck` directly in that case, not this barrel.
// =============================================================================

export { InlineKnowledgeCheck } from "./InlineKnowledgeCheck";
export type { InlineKnowledgeCheckProps } from "./InlineKnowledgeCheck";

export { RealtimeCheckPanel } from "./RealtimeCheckPanel";
export type { RealtimeCheckPanelProps } from "./RealtimeCheckPanel";
