// =============================================================================
// EXECUTION COMPONENT BARREL. Owner: code-execution stream.
// -----------------------------------------------------------------------------
// Prefer `LazyCodeRunner` on any page a student might load without pressing Run —
// see LazyCodeRunner.tsx for the measured reason. `CodeRunner` is exported for
// the cases that are already behind a dynamic boundary (a modal, a lab step that
// only mounts when opened), where a second dynamic wrapper would just add a
// loading flash.
// =============================================================================

export { CodeRunner } from "./CodeRunner";
export type { CodeRunnerProps } from "./CodeRunner";

export { LazyCodeRunner } from "./LazyCodeRunner";

export { RunOutput } from "./RunOutput";
export type { RunOutputProps } from "./RunOutput";
