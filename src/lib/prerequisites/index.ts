// =============================================================================
// Barrel for the prerequisites stream.
// -----------------------------------------------------------------------------
// SERVER-ONLY. This re-exports `./store` (which imports `@/db` and therefore
// `pg`), `./policy` (which imports `@/lib/guard` -> `@/lib/auth`) and `./gate`
// (both). A "use client" component MUST NOT import from here — it should import
// `@/lib/prerequisites/labels` for constants and
// `@/lib/prerequisites/actions` for the mutations. That split, and the reason for
// it, is explained in ./labels.ts.
//
// `./graph` is pure and importable from anywhere, but it is exported here too so
// server callers have one import path.
// =============================================================================

export * from "./graph";
export * from "./policy";
export * from "./store";
export {
  buildFacts,
  describeRequirements,
  evaluateCatalogPrerequisites,
  evaluateCoursePrerequisites,
  type PrerequisiteEvaluation,
} from "./gate";
export { PrerequisiteForbiddenError, requirePrerequisiteAdmin } from "./access";
