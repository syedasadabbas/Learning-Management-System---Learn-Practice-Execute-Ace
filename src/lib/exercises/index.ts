// =============================================================================
// INTERACTIVE EXERCISES — public surface of the lib layer
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// Server components may import from here freely: every module re-exported below
// is pure (no React state, no browser APIs). `./reduced-motion` is deliberately
// NOT re-exported — it is a "use client" module, and pulling it into this barrel
// would drag a client hook into any server page that only wanted the parser.
// Import it directly from "@/lib/exercises/reduced-motion" in client components.
// =============================================================================

export type {
  Diagnostic,
  ExerciseEntry,
  ExerciseFile,
  ExerciseLanguage,
  ExerciseProblem,
  RawResource,
  SandpackExercise,
} from "./types";

export {
  ENTRY_FILE,
  countSandpackResources,
  extensionOf,
  hasSandpackResources,
  isLinkResource,
  isRunnablePath,
  isSandpackResource,
  languageForPath,
  normaliseFilePath,
  normaliseStarterCode,
  orderFilePaths,
  parseLectureIdParam,
  parseSandpackResources,
  usableExercises,
  warningsAsDiagnostics,
} from "./parse";
export type { NormalisedStarterCode, StarterCodeResult } from "./parse";

export { diagnoseFiles, referencedAssets } from "./diagnostics";

export {
  CONCEPTS,
  CONCEPT_IDS,
  conceptById,
  conceptExercise,
  conceptsForLecture,
} from "./registry";
export type { ConceptId, ConceptMeta } from "./registry";
