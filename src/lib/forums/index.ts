// =============================================================================
// FORUMS MODULE BARREL. Owner: forums stream.
// -----------------------------------------------------------------------------
// `policy.ts` is re-exported wholesale because it is pure and safe to import from
// anywhere, including a client component that needs a length cap or a refusal
// string.
//
// `store.ts` and `actions.ts` are NOT re-exported here. Both are server-only —
// store.ts imports the Drizzle client and actions.ts is a "use server" module —
// and a barrel that mixed them with the pure policy would make one careless
// `import { TOPIC_TITLE_MAX } from "@/lib/forums"` in a client component pull `pg`
// into the browser bundle. That is the same reason `REQUEST_MESSAGE_MAX` lives in
// src/lib/courses/labels.ts rather than in that stream's policy file. Import the
// server modules by their own path, at which point the cost is visible.
// =============================================================================

export * from "./policy";
export type { TopicListItem, PostView, TopicDetail, WeekForumSummary } from "./store";
