// =============================================================================
// CLIENT-SIDE SHAPES for the learning-enhancement surfaces.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHY THESE ARE DECLARED AND NOT INFERRED FROM DRIZZLE.
//
// The obvious move is `type Sample = typeof assignmentSamples.$inferSelect`.
// It is wrong here for two reasons that both bite at runtime rather than at
// compile time:
//
//   1. THESE VALUES ARRIVED AS JSON. `createdAt` is a `Date` in the Drizzle
//      type and a STRING in the browser, because it went through
//      JSON.stringify on the way. A component typed from the table calls
//      `.toISOString()` on a string and throws. Every timestamp below is
//      therefore `string`.
//   2. THE jsonb COLUMNS ARE `unknown` BY DESIGN. `code_example`, `features`,
//      `hints`, `test_cases` and `acceptance_criteria` are jsonb, and the
//      schema header says plainly that a stored blob is untrusted input rather
//      than a type. The narrowing functions in this file are where that
//      untrusted input becomes typed, once, instead of at each `.map()`.
//
// The projections these mirror live in src/lib/learning/projection.ts. If one
// changes, this file is the other end of that seam.
// =============================================================================

/** One file inside a sample's `code_example` blob. TECHNICAL_SPECIFICATION.md §311-333. */
export interface CodeExampleFile {
  filename: string;
  language: string;
  code: string;
  explanation?: string;
  /** 1-based line numbers to emphasise. */
  highlighted_lines?: number[];
  /** 1-based line number -> prose. Rendered as a per-line note, not a tooltip. */
  line_explanations?: Record<string, string>;
}

/** A row from `GET /api/assignments/:assignmentId/samples`. */
export interface AssignmentSample {
  id: number;
  assignmentId: number;
  title: string;
  description: string | null;
  sampleOrder: number;
  sampleOutputHtml: string | null;
  screenshotUrl: string | null;
  codeExample: unknown;
  liveUrl: string | null;
  features: unknown;
  videoWalkthroughUrl: string | null;
  createdAt: string;
}

/**
 * Narrow the `code_example` blob to the files the viewer can actually render.
 *
 * Malformed entries are DROPPED rather than rendered defensively. The precedent
 * is `hintsUpTo` in src/lib/learning/projection.ts, and the argument is the
 * same: a file tab labelled `undefined` containing `[object Object]` is worse
 * for the student than one fewer tab, and it hides the authoring mistake
 * instead of surfacing it.
 */
export function readCodeFiles(value: unknown): CodeExampleFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (file): file is CodeExampleFile =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as { filename?: unknown }).filename === "string" &&
      typeof (file as { language?: unknown }).language === "string" &&
      typeof (file as { code?: unknown }).code === "string",
  );
}

/** Narrow the `features` blob to a chip list. Non-strings are dropped. */
export function readFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** One entry of a practice problem's `acceptance_criteria` blob. */
export interface AcceptanceCriterion {
  criteria: string;
  how_to_verify: string;
}

export function readAcceptanceCriteria(value: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is AcceptanceCriterion =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { criteria?: unknown }).criteria === "string" &&
      typeof (item as { how_to_verify?: unknown }).how_to_verify === "string",
  );
}

/** Narrow a `string[]` jsonb column (learning objectives, related concepts). */
export function readStringList(value: unknown): string[] {
  return readFeatures(value);
}
