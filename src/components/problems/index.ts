// =============================================================================
// PROBLEM COMPONENT BARREL. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// There are now two client workbenches — `ProblemWorkbench` (textarea + Run +
// Submit, for problems that execute) and `MarkupWorkbench` (Sandpack editor + live
// preview + Submit, for HTML and CSS) — plus the `SubmitPanel` they share. They are
// exported for completeness, but pages should compose `ProblemView`.
//
// WHAT KEEPS SANDPACK OUT OF THE BUNDLE — and it is NOT the server-side branch in
// ProblemView, which is what this comment used to say. A route has one webpack
// client entry and every client component reachable from it shares that entry's
// chunk group, so the branch chose the component while webpack shipped both; all
// four problem routes measured 353 kB First Load JS against ~116 kB for their
// peers. It is `LazyMarkupWorkbench` (a next/dynamic boundary with `ssr: false`)
// that keeps it out. The measurements and the manifest evidence are in
// LazyMarkupWorkbench.tsx and in the branch comment in ProblemView.tsx.
//
// So: importing `MarkupWorkbench` from this barrel into anything a route can reach
// puts Sandpack (~240 kB) back into that route's entry. Import
// `LazyMarkupWorkbench`, or compose `ProblemView`, which already does.
// =============================================================================

export { ProblemBrowser } from "./ProblemBrowser";
export type { ProblemBrowserProps } from "./ProblemBrowser";

export { ProblemView } from "./ProblemView";
export type { ProblemViewProps } from "./ProblemView";

export { ProblemWorkbench } from "./ProblemWorkbench";
export type { ProblemWorkbenchProps } from "./ProblemWorkbench";

export { MarkupWorkbench } from "./MarkupWorkbench";
export type { MarkupWorkbenchProps } from "./MarkupWorkbench";

/** The deferred form. Prefer this anywhere a route can reach it — see above. */
export { LazyMarkupWorkbench } from "./LazyMarkupWorkbench";

export { SubmitPanel } from "./SubmitPanel";
export type { SubmitPanelProps } from "./SubmitPanel";
