// =============================================================================
// INTERACTIVE EXERCISES — component barrel
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream. Other streams (course-content renders
// lectures) should import from here:
//
//   import { ExerciseList, ConceptAnimation } from "@/components/exercises";
//
// and pass `parseSandpackResources(lecture.id, lecture.resources)` in. Do not
// deep-import LiveEditor: ExercisePanel handles the malformed-resource case, and
// bypassing it is how a bad jsonb blob reaches Sandpack unchecked.
// =============================================================================

export { LiveEditor, RESET_ARM_TIMEOUT_MS } from "./LiveEditor";
export type { LiveEditorProps } from "./LiveEditor";

export { ExerciseList, ExercisePanel } from "./ExercisePanel";
export type { ExerciseListProps, ExercisePanelProps } from "./ExercisePanel";

export { ConceptAnimation } from "./ConceptAnimation";
export type { ConceptAnimationProps } from "./ConceptAnimation";

export { ExplainerShell } from "./ExplainerShell";
export type { ExplainerShellProps, ExplainerStep } from "./ExplainerShell";
