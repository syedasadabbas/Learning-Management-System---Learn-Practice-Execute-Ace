"use client";

// =============================================================================
// LAZY CODE RUNNER — the import other streams should use on a content page.
// Owner: code-execution stream.
// -----------------------------------------------------------------------------
// CodeRunner is already light (a textarea, not Sandpack), so this wrapper is not
// about its own weight — it is about everything reachable from it. `runCode` pulls
// in the browser dispatcher, and a page that statically imports the runner puts
// that graph in the route bundle whether or not a student ever presses Run. Most
// lectures carry no runnable snippet at all, so the common case would pay for a
// feature it does not use. That is the exact regression LazyExerciseList was
// written to undo (377 kB → 116 kB on the lecture page); this follows its shape
// on purpose, including `ssr: false` and a SIZED placeholder rather than a spinner
// so nothing below the runner jumps when it mounts.
//
// `ssr: false` for a second reason as well: the browser runners need Worker and
// Blob URLs, neither of which exists during a server render.
// =============================================================================

import dynamic from "next/dynamic";

import type { CodeRunnerProps } from "./CodeRunner";

const Runner = dynamic(
  () => import("./CodeRunner").then((mod) => ({ default: mod.CodeRunner })),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="code-runner-loading"
        role="status"
        aria-live="polite"
        className="flex min-h-[240px] items-center justify-center rounded-lg border border-line bg-panel text-sm text-ink-muted"
      >
        Loading the code runner…
      </div>
    ),
  },
);

export function LazyCodeRunner(props: CodeRunnerProps) {
  return <Runner {...props} />;
}
