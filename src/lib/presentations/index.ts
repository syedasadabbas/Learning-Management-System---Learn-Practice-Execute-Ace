// Public surface of the presentations logic layer. Pure client-side types,
// validation and theming — no database access lives under this directory, by
// design: the renderer must be usable from a Storybook, a test, or an export
// worker with no request context.

export * from "./types";
export * from "./theme";
export type {
  RevealApi,
  RevealFactory,
  RevealOptions,
  SlideChangedDetail,
} from "./reveal-api";
export { isSlideChangedEvent } from "./reveal-api";
