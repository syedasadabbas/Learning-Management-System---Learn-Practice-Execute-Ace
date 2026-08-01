// =============================================================================
// Barrel for the courses / access-requests stream.
// -----------------------------------------------------------------------------
// SERVER-ONLY. This re-exports `./store` (which imports `@/db` and therefore
// `pg`) and `./policy` (which imports `@/lib/guard` -> `@/lib/auth`). A "use
// client" component MUST NOT import from here — it should import
// `@/lib/courses/labels` for constants and `@/lib/courses/actions` for the
// mutations, which is the split src/lib/courses/labels.ts explains.
// =============================================================================

export * from "./policy";
export * from "./store";
export {
  CourseAccessForbiddenError,
  requireCourseApprover,
  requireCourseRequester,
} from "./access";
