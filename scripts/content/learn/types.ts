// =============================================================================
// LEARN SEED SHAPES — the authoring format for concept modules.
// Owner: interactive-learning stream (this subtree only; scripts/content/** at
// large belongs to the curriculum-content stream).
// -----------------------------------------------------------------------------
// Authored against docs/research/CURRICULUM_PLAN.md: slugs, titles, module ladder
// and per-step kind/subject come from that plan wherever it covers a track, so the
// two do not diverge. See index.ts for exactly which tracks came from the plan and
// which were outlined here because the plan had not reached them.
//
// ORIGINAL PROSE ONLY. W3Schools, MDN, the Python docs, the PostgreSQL manual and
// OWASP were read to decide WHICH topics matter and in what order. Not one sentence
// below is copied from any of them; `refs` carries the URLs so a student can go and
// read the source in its own words.
//
// The authoring shape is intentionally NOT the database shape. `execution` is
// derived (a lab runs in the browser, everything else runs nowhere), `stepNumber`
// is the array index, and `expectation` is assembled from the fields a step kind
// actually uses. Deriving those removes the three things an author would otherwise
// get wrong by hand.
// =============================================================================

export type SeedLevel = "beginner" | "intermediate" | "advanced";
export type SeedLabLanguage = "javascript" | "python" | "sql";

/** One frame of an `explain` step's diagram. */
export interface SeedFrame {
  label: string;
  caption: string;
  code?: string;
}

interface SeedStepBase {
  title: string;
  /** Markdown. Rendered by the shared lecture markdown renderer. */
  body: string;
}

export interface SeedExplainStep extends SeedStepBase {
  kind: "explain";
  /** Optional: a step may be prose only. Two frames minimum when present. */
  diagram?: { title: string; frames: SeedFrame[] };
}

export interface SeedLabStep extends SeedStepBase {
  kind: "lab";
  language: SeedLabLanguage;
  /** What the student should end up having done. */
  goal: string;
  starterCode: string;
  hint?: string;
  /** stdin for JS/Python; the schema + fixture script for SQL (SQLite has no stdin). */
  setup?: string;
  /** Set on any lab that implements a primitive for teaching. */
  notProductionReady?: boolean;
}

export interface SeedCheckStep extends SeedStepBase {
  kind: "check";
  prompt: string;
  /** Exactly one option carries `correct: true`; the validator enforces it. */
  options: { text: string; correct?: boolean }[];
  explanation: string;
}

export type SeedStep = SeedExplainStep | SeedLabStep | SeedCheckStep;

export interface SeedModule {
  /** Globally unique, track-prefixed, from the curriculum plan's conventions. */
  slug: string;
  track: string;
  title: string;
  summary: string;
  level: SeedLevel;
  /** Median completion time for a beginner-to-intermediate learner, in minutes. */
  estimatedMinutes: number;
  /** Position within the track. Set by the loader from array order if omitted. */
  orderIndex?: number;
  /**
   * Draft modules seed with `published = false` and are invisible to students —
   * the filter is in the query, not the UI. Every module in this starter set is
   * published; the flag exists so half-written content can still land.
   */
  published?: boolean;
  /** Reference URLs. Link targets for further reading, never a content source. */
  refs?: string[];
  steps: SeedStep[];
}
