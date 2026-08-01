// =============================================================================
// INTERACTIVE EXERCISES — shared types
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// These types describe the *client-side* view of `lectures.resources` (a jsonb
// column, therefore `unknown` until proven otherwise). The DB shape is frozen in
// src/db/schema.ts:
//
//   Array<{ title: string; type: "link" | "sandpack"; url?: string;
//           starterCode?: object }>
//
// This stream owns ONLY `type: "sandpack"` entries. The `link` entries are
// rendered by course-content (they point out to W3Schools, which cannot be
// iframed — see docs/DECISIONS.md), and are deliberately not rendered here so a
// lecture does not show the same link twice.
// =============================================================================

/** A resource entry as it comes out of jsonb: nothing is guaranteed. */
export type RawResource = unknown;

/** Language mode used to label a file in the editor UI. */
export type ExerciseLanguage =
  | "html"
  | "css"
  | "javascript"
  | "json"
  | "markdown"
  | "text";

/** A single starter file after normalisation. */
export interface ExerciseFile {
  /** Sandpack path, always absolute (leading "/"). */
  path: string;
  code: string;
  language: ExerciseLanguage;
  /** True when the file was synthesised by us rather than supplied by the seed. */
  synthesised?: boolean;
}

/** A validated, renderable exercise. */
export interface SandpackExercise {
  /** Stable id: `${lectureId}-${resourceIndex}`. Used in URLs and test hooks. */
  id: string;
  title: string;
  lectureId: number;
  /** Sandpack `files` prop: path -> source. */
  files: Record<string, string>;
  /** Tabs to show, in a deliberate order (HTML first, then CSS, then JS). */
  visibleFiles: string[];
  /** Tab focused on mount. */
  activeFile: string;
  /** Non-fatal notes worth showing the student (e.g. an unknown extension). */
  warnings: string[];
}

/** Why a resource could not be turned into an exercise. */
export interface ExerciseProblem {
  id: string;
  title: string;
  /** Student-readable sentence. Never a stack trace. */
  reason: string;
}

/**
 * Result of parsing one `sandpack` resource. A malformed resource yields
 * `ok: false` rather than throwing, because a bad jsonb blob must not take the
 * whole lecture page down with it.
 */
export type ExerciseEntry =
  | { ok: true; exercise: SandpackExercise }
  | { ok: false; problem: ExerciseProblem };

/** A diagnostic surfaced under the editor instead of a blank preview frame. */
export interface Diagnostic {
  /** File the problem was found in, or null for whole-sandbox problems. */
  file: string | null;
  severity: "error" | "warning";
  message: string;
}
