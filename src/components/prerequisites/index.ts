// =============================================================================
// Barrel for the prerequisites components.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// SAFE FOR SERVER PAGES. Every module below imports only from
// `@/lib/prerequisites/labels` (the zero-import pure module),
// `@/lib/prerequisites/actions` (a "use server" module, which Next.js turns into a
// reference rather than inlining) and `@/components/ui`. None of them reaches
// ./policy or ./store, so none can drag `pg` into a client bundle — the hazard
// src/lib/prerequisites/labels.ts's header documents.
// =============================================================================

export { PrerequisiteNotice } from "./PrerequisiteNotice";
export type {
  PrerequisiteNoticeProps,
  PrerequisiteOverrideNotice,
} from "./PrerequisiteNotice";

export { PrerequisiteRules } from "./PrerequisiteRules";
export type { PrerequisiteRulesProps, RuleView, CourseOption } from "./PrerequisiteRules";

export { OverridePanel } from "./OverridePanel";
export type { OverridePanelProps, OverrideView, StudentOption } from "./OverridePanel";
