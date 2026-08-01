"use client";

// =============================================================================
// LAB STEP — the try-it editor inside a module.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// LABS RUN IN THE BROWSER, FULL STOP. `backend="browser"` is passed explicitly
// rather than left on the default "auto". "auto" would fall through to Piston for
// a language with no browser runner, and a concept lab that quietly needs a
// server is a concept lab that stops working when the free public Piston instance
// rate-limits us — which it does. A language this platform cannot run in the
// browser must show as a content bug, and CodeRunner already renders exactly that
// (an inert panel naming the supported languages) instead of a Run button that
// always fails.
//
// PYODIDE MUST NOT ENTER THE PAGE BUNDLE. `LazyCodeRunner` is the import, not
// `CodeRunner`: the runner is behind `next/dynamic` with `ssr: false`, and the
// Python runtime is fetched by the worker from a CDN on the first Run. So loading
// a module page downloads no runtime at all — and a Python lab costs its ~10 MB
// only when a student presses Run. This is the same lesson the lecture page paid
// for once (377 kB -> 116 kB by lazy-loading Sandpack); do not statically import
// CodeRunner here to save a loading flash.
//
// SQL HAS NO STDIN. `expectation.setup` is passed as `stdin`, which is how
// sqljs-worker.ts receives a schema + fixture script. For JS and Python the same
// field is ordinary stdin.
// =============================================================================

import * as React from "react";

import { LazyCodeRunner } from "@/components/execution";
import { Badge, Button, cn } from "@/components/ui";
import type { LabExpectation, LearnStepView } from "@/lib/learn";

export interface LabStepProps {
  step: LearnStepView;
  className?: string;
}

/** Fallback goal text when a lab row carried no usable expectation. */
const DEFAULT_LAB: LabExpectation = {
  kind: "lab",
  goal: "Edit the program and run it. Nothing here is marked.",
};

export function LabStep({ step, className }: LabStepProps) {
  const lab = step.lab ?? DEFAULT_LAB;
  const [hintOpen, setHintOpen] = React.useState(false);

  return (
    <div className={cn("space-y-3", className)} data-testid="learn-lab-step">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand" size="md">
          Lab
        </Badge>
        {step.language && (
          <Badge tone="neutral" size="md" data-testid="learn-lab-language">
            {step.language}
          </Badge>
        )}
        <span className="text-xs text-ink-muted">Runs in your browser. Not marked.</span>
      </div>

      <p className="max-w-prose text-sm text-ink" data-testid="learn-lab-goal">
        <span className="font-semibold">Goal: </span>
        {lab.goal}
      </p>

      {/* The cryptography content rule, rendered. A lab that hand-rolls a
          primitive to show how it works must say on screen that it is not
          production-ready — a student who copies it out of here otherwise has no
          way to know. `role="note"` plus the explicit heading text means this is
          not conveyed by the border colour alone. */}
      {lab.notProductionReady && (
        <div
          role="note"
          data-testid="learn-lab-not-production"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <strong className="font-semibold">Teaching code, not production code. </strong>
          This lab implements the primitive by hand so you can see its shape. Do not
          ship it. In real work, call the platform primitive — for the browser that is
          <code className="mx-1">crypto.subtle</code>— which is reviewed, hardware-accelerated
          and constant-time where it needs to be.
        </div>
      )}

      {lab.hint && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            data-testid="learn-lab-hint-toggle"
            aria-expanded={hintOpen}
            onClick={() => setHintOpen((open) => !open)}
          >
            {hintOpen ? "Hide hint" : "Show hint"}
          </Button>
          {hintOpen && (
            <p
              data-testid="learn-lab-hint"
              className="mt-2 max-w-prose rounded-md border border-line bg-surface p-3 text-sm text-ink-muted"
            >
              {lab.hint}
            </p>
          )}
        </div>
      )}

      <LazyCodeRunner
        language={step.language ?? "javascript"}
        initialSource={step.starterCode ?? ""}
        stdin={lab.setup}
        backend="browser"
        label={step.title}
      />
    </div>
  );
}

export default LabStep;
