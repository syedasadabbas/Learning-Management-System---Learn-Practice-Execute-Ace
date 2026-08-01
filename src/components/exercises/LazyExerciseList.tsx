"use client";

// =============================================================================
// LAZY EXERCISE LIST — defers the Sandpack bundle until an exercise is rendered.
// -----------------------------------------------------------------------------
// Added at integration, for a measured reason. Mounting ExerciseList on the
// lecture page with a static import took that route's First Load JS from ~115 kB
// to 377 kB — Sandpack is a bundler, a CodeMirror editor and an iframe runtime.
//
// A static import puts that weight in the route bundle whether or not the
// component renders, and 8 of the 12 seeded lectures carry no sandpack resource.
// The lecture page is the most-visited page in the app, so the common case was
// paying triple for a feature it does not use.
//
// next/dynamic here (not in the page) because `ssr: false` is only valid inside a
// client component. Sandpack cannot server-render anyway: it needs iframes,
// cross-frame postMessage and a service worker.
// =============================================================================

import dynamic from "next/dynamic";

import type { ExerciseListProps, ExercisePanelProps } from "./ExercisePanel";

const ExerciseList = dynamic(
  () => import("./ExercisePanel").then((mod) => ({ default: mod.ExerciseList })),
  {
    ssr: false,
    // A sized placeholder, not a spinner: the editor is tall, and collapsing to
    // nothing then expanding shifts every heading below it on the page.
    loading: () => (
      <div
        data-testid="exercise-list-loading"
        role="status"
        aria-live="polite"
        className="flex min-h-[320px] items-center justify-center rounded-lg border border-line bg-panel text-sm text-ink-muted"
      >
        Loading the live editor…
      </div>
    ),
  },
);

export function LazyExerciseList(props: ExerciseListProps) {
  return <ExerciseList {...props} />;
}

/**
 * The same deferral for a SINGLE exercise panel.
 *
 * Added for the concept explainer page, which measured 378 kB First Load JS. Deep
 * importing `ExercisePanel` instead of the barrel was not enough: ExercisePanel
 * statically imports LiveEditor, so Sandpack came with it either way. A page whose
 * purpose is an animated diagram was shipping a bundler to every visitor, and the
 * optional starter exercise below the diagram is the only part that needs it.
 */
const ExercisePanelDynamic = dynamic(
  () => import("./ExercisePanel").then((mod) => ({ default: mod.ExercisePanel })),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="exercise-panel-loading"
        role="status"
        aria-live="polite"
        className="flex min-h-[320px] items-center justify-center rounded-lg border border-line bg-panel text-sm text-ink-muted"
      >
        Loading the live editor…
      </div>
    ),
  },
);

export function LazyExercisePanel(props: ExercisePanelProps) {
  return <ExercisePanelDynamic {...props} />;
}
