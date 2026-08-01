"use client";

// =============================================================================
// EXPLAINER SHELL — the frame every animated concept diagram sits in
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// Every explainer in this stream is STEPPED, not looping. Three reasons:
//
//   1. A loop cannot be read. The box model has an order — content, padding,
//      border, margin — and a student needs to stop on "padding" for as long as
//      it takes, not chase it round again.
//   2. Stepping is inherently keyboard operable: two buttons and a caption. A
//      looping animation offers nothing to focus.
//   3. It makes prefers-reduced-motion honest. With motion off, the diagram is
//      still fully usable — the steps just change instantly, and every layer and
//      label is still on screen. The lesson degrades to a static diagram, which is
//      what the guideline asks for; it does not disappear.
//
// All durations are declared in milliseconds (house rule 5) in
// src/lib/exercises/reduced-motion.ts.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import {
  STEP_TRANSITION_MS,
  usePrefersReducedMotion,
} from "@/lib/exercises/reduced-motion";

export interface ExplainerStep {
  /** Short label for the step, used in the progress dots' accessible names. */
  label: string;
  /** One or two sentences explaining what changed and why it matters. */
  caption: React.ReactNode;
  /** The CSS/HTTP line this step corresponds to, shown as code. */
  code?: string;
}

export interface ExplainerRenderArgs {
  stepIndex: number;
  reducedMotion: boolean;
}

export interface ExplainerShellProps {
  conceptId: string;
  steps: readonly ExplainerStep[];
  /** The diagram itself. Receives the current step and the motion preference. */
  children: (args: ExplainerRenderArgs) => React.ReactNode;
  className?: string;
}

export function ExplainerShell({ conceptId, steps, children, className }: ExplainerShellProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [stepIndex, setStepIndex] = React.useState(0);

  const lastIndex = steps.length - 1;
  const step = steps[Math.min(stepIndex, lastIndex)];
  const atStart = stepIndex === 0;
  const atEnd = stepIndex === lastIndex;

  return (
    <div
      data-testid="concept-animation"
      data-concept-id={conceptId}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-step={stepIndex}
      className={cn("space-y-3", className)}
    >
      {/* The stage. aria-hidden because the diagram is decorative *given* the
          caption below: everything it shows is stated in words, so a screen
          reader gets the lesson without having to interpret nested divs. */}
      <div
        aria-hidden="true"
        data-testid="concept-stage"
        className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-md border border-line bg-surface p-4"
      >
        {children({ stepIndex: Math.min(stepIndex, lastIndex), reducedMotion })}
      </div>

      {/* The lesson in text. aria-live so stepping is announced, not silent. */}
      <div aria-live="polite" data-testid="concept-caption">
        <p className="text-sm font-medium text-ink">
          Step {stepIndex + 1} of {steps.length}: {step.label}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{step.caption}</p>
        {step.code && (
          <pre className="mt-2 overflow-x-auto rounded border border-line bg-panel p-2 text-xs">
            <code>{step.code}</code>
          </pre>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          data-testid="concept-prev"
          disabled={atStart}
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
        >
          ← Previous step
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="concept-next"
          disabled={atEnd}
          onClick={() => setStepIndex((i) => Math.min(lastIndex, i + 1))}
        >
          Next step →
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="concept-restart"
          onClick={() => setStepIndex(0)}
        >
          Restart
        </Button>

        <p className="ml-auto text-xs text-ink-muted" data-testid="concept-motion-state">
          {reducedMotion
            ? "Motion off (system setting) — the diagram changes instantly."
            : `Transitions: ${STEP_TRANSITION_MS} ms.`}
        </p>
      </div>
    </div>
  );
}
