"use client";

// =============================================================================
// LAZY MARKUP WORKBENCH — defers the Sandpack bundle off the problem routes.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS: a measurement that contradicted the comment it replaces.
//
// ProblemView.tsx used to argue that because it is a SERVER component and takes
// the markup/executed branch there, the unchosen workbench "never appears in the
// RSC payload and its chunk is never fetched". That reasoning is true of the RSC
// payload and false of the chunks, and `next build` was reporting the difference:
//
//   `npm run build`, First Load JS      BEFORE     AFTER
//     /problems                          353 kB     129 kB
//     /problems/[slug]                   353 kB     129 kB
//     /interview                         353 kB     129 kB
//     /interview/[slug]                  353 kB     129 kB
//     /practice/[lectureId]              162 kB     162 kB   <- control, unchanged
//     /practice                          116 kB     116 kB   <- control, unchanged
//
// /practice/[lectureId] mounts the SAME editor and cost 162 kB all along, because
// it reaches it through next/dynamic. It is quoted as a control: other streams were
// committing to this branch between the two builds, and two routes holding still to
// the byte is what says the 224 kB drop belongs to this change and not to theirs.
//
// WHAT THE MANIFESTS SHOW, and why the branch does not help.
// In .next/server/app/(app)/problems/[slug]/page_client-reference-manifest.js the
// `clientModules` entry for ProblemWorkbench.tsx carries an IDENTICAL 12-chunk
// list to the entry for MarkupWorkbench.tsx. Both list:
//     static/chunks/1227-*.js        373 kB   (sandpack + codemirror)
//     static/chunks/363642f4-*.js    174 kB   (codemirror)
//     static/chunks/e58a7f8f-*.js    103 kB   (sandpack)
// That is not a coincidence: a route has ONE webpack client entry, every client
// component reachable from the server graph lands in its chunk group, and the
// manifest records the whole group per module. React's Flight client loads every
// chunk listed for a module reference before it can render it — so resolving
// ProblemWorkbench (a JavaScript problem, which can never show a preview) fetches
// the Sandpack and CodeMirror chunks anyway. The server-side branch decides which
// COMPONENT renders; it does not decide which chunks the browser downloads.
//
// After this change the same manifest lists 7 chunks for ProblemWorkbench totalling
// 72.1 kB, and `grep sandpack` finds nothing in any of them. The Sandpack chunks
// still exist but were renamed to webpack's async form (1227.<hash>.js rather than
// 1227-<hash>.js), which is the build telling you they moved out of the route entry
// and are now fetched only when the markup branch actually mounts.
//
// The route reached BankPages.tsx:32, which imports ProblemView statically, which
// imported MarkupWorkbench statically — so the two *list* pages paid for Sandpack
// too, and they mount no editor at all under any branch. That was the tell: a
// server-side branch cannot explain a cost on a page where neither branch runs.
//
// THE PATTERN, not a new idea: src/components/exercises/LazyExerciseList.tsx
// exists for exactly this regression on the lecture route (~115 kB -> 377 kB) and
// src/components/execution/LazyCodeRunner.tsx for the same on the executed side.
// `ssr: false` is only legal inside a client component, which is why this wrapper
// is a "use client" module rather than a `dynamic()` call in ProblemView.
//
// Sandpack cannot server-render regardless — it needs an iframe, cross-frame
// postMessage and a service worker — so `ssr: false` costs nothing here.
// =============================================================================

import dynamic from "next/dynamic";

import type { MarkupWorkbenchProps } from "./MarkupWorkbench";

const MarkupWorkbenchDynamic = dynamic(
  () => import("./MarkupWorkbench").then((mod) => ({ default: mod.MarkupWorkbench })),
  {
    ssr: false,
    // A sized placeholder, not a spinner, and sized to MarkupWorkbench's own
    // EDITOR_HEIGHT_PX (460) plus its chrome. The reference solution and the
    // attempt history render BELOW the workbench, so collapsing to nothing and
    // then expanding would shift both down the page as the chunk arrives.
    loading: () => (
      <div
        data-testid="problem-markup-editor-loading"
        role="status"
        aria-live="polite"
        className="flex min-h-[520px] items-center justify-center rounded-lg border border-line bg-panel text-sm text-ink-muted"
      >
        Loading the live editor…
      </div>
    ),
  },
);

export function LazyMarkupWorkbench(props: MarkupWorkbenchProps) {
  return <MarkupWorkbenchDynamic {...props} />;
}

export default LazyMarkupWorkbench;
