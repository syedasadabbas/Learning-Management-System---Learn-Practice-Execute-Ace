"use client";

// =============================================================================
// STEP DIAGRAM — the animated explainer for a `explain` step.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// REDUCED MOTION, AND WHY THIS FILE DOES NOT RE-DERIVE THE RULE.
//
// `src/lib/exercises/reduced-motion.ts` already states it: a reduced-motion
// preference degrades an explainer to a STATIC DIAGRAM and never removes
// information, because "the information is the diagram, not the movement". This
// component imports that module's predicate and its duration constant rather
// than calling `matchMedia` again — a second copy of the predicate is a second
// thing that can disagree about what "reduce" means, and its jsdom/no-matchMedia
// fallback is already tested there.
//
// The concrete degradation here:
//   * EVERY frame's label and caption is on screen in BOTH modes. Nothing is
//     hidden behind an animation, so nothing is lost when the animation is off.
//     Stepping changes which frame is *emphasised*, not which frames exist.
//   * With motion allowed, that emphasis moves over STEP_TRANSITION_MS.
//   * With motion reduced, the transition is 0 ms and the frames are laid out as
//     one static stack. The stepper stays — it is the pacing control, and it is
//     the reason this is keyboard operable at all (two buttons, not a timeline).
//
// NOT COLOUR-ONLY. The emphasised frame carries a text marker ("current") and a
// heavier border and ring, so which frame is active survives greyscale and does
// not depend on the brand hue.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import {
  STEP_TRANSITION_MS,
  usePrefersReducedMotion,
} from "@/lib/exercises/reduced-motion";
import type { ExplainExpectation } from "@/lib/learn";

export interface StepDiagramProps {
  explain: ExplainExpectation;
  /** Distinguishes several diagrams on one page in the DOM and in tests. */
  diagramId: string;
  className?: string;
}

export function StepDiagram({ explain, diagramId, className }: StepDiagramProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [frameIndex, setFrameIndex] = React.useState(0);

  const frames = explain.frames;
  const lastIndex = frames.length - 1;
  const current = Math.min(frameIndex, lastIndex);
  const transitionMs = reducedMotion ? 0 : STEP_TRANSITION_MS;

  const headingId = `${diagramId}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="learn-step-diagram"
      data-diagram-id={diagramId}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-frame={current}
      className={cn("space-y-3 rounded-lg border border-line bg-surface p-4", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {explain.diagramTitle}
        </h3>
        <p className="text-xs text-ink-muted" data-testid="learn-diagram-motion-state">
          {reducedMotion
            ? "Motion off (system setting) — the full diagram is shown at once."
            : `Frame transitions: ${STEP_TRANSITION_MS} ms.`}
        </p>
      </div>

      {/* The frames. `ol` because the order is the lesson — a screen reader gets
          "1 of 4" for free, and no aria-hidden is needed because every label and
          caption is real text rather than a shape to interpret. */}
      <ol className="space-y-2" data-testid="learn-diagram-frames">
        {frames.map((frame, index) => {
          const isCurrent = index === current;
          const isPast = index < current;
          return (
            <li
              key={`${frame.label}-${index}`}
              data-testid="learn-diagram-frame"
              data-current={isCurrent ? "true" : "false"}
              aria-current={isCurrent ? "step" : undefined}
              style={{
                transitionDuration: `${transitionMs}ms`,
                // Past frames stay fully legible; only the *future* ones are
                // dimmed, and never below 4.5:1 body contrast (ink-muted on
                // surface is 5.1:1, and 0.75 opacity keeps large-text AA).
                opacity: reducedMotion || isCurrent || isPast ? 1 : 0.75,
              }}
              className={cn(
                "rounded-md border bg-panel p-3 transition-[opacity,border-color,box-shadow] motion-reduce:transition-none",
                isCurrent
                  ? "border-brand ring-2 ring-brand/30"
                  : "border-line",
              )}
            >
              <p className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink">
                <span>
                  {index + 1}. {frame.label}
                </span>
                {isCurrent && (
                  /* Text, not a colour: the active frame is identifiable in
                     greyscale and to a screen reader. */
                  <span className="text-xs font-normal text-ink-muted">(current)</span>
                )}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{frame.caption}</p>
              {frame.code && (
                <pre className="mt-2 overflow-x-auto rounded border border-line bg-surface p-2 text-xs text-ink">
                  <code>{frame.code}</code>
                </pre>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          data-testid="learn-diagram-prev"
          disabled={current === 0}
          onClick={() => setFrameIndex((i) => Math.max(0, i - 1))}
        >
          Previous frame
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="learn-diagram-next"
          disabled={current === lastIndex}
          onClick={() => setFrameIndex((i) => Math.min(lastIndex, i + 1))}
        >
          Next frame
        </Button>
        <p className="ml-auto text-xs text-ink-muted" aria-live="polite">
          Frame {current + 1} of {frames.length}
        </p>
      </div>
    </section>
  );
}

export default StepDiagram;
