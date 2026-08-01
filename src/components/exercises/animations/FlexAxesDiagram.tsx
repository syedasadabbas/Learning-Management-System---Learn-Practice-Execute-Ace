"use client";

// =============================================================================
// FLEXBOX AXES EXPLAINER
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// The misconception this targets: students memorise "justify-content centres
// horizontally". It does not — it centres along the MAIN axis, which
// flex-direction can rotate. The final step flips to `column` without touching
// the alignment properties, so the same two declarations visibly do the opposite
// thing. That is the whole lesson, and it is impossible to show in a still image.
//
// The items move with Framer's layout animation; with reduced motion the
// transition is 0 ms, so the arrangement changes instantly and every axis label
// stays on screen.
// =============================================================================

import { motion } from "framer-motion";

import { stepTransition } from "@/lib/exercises/reduced-motion";
import { ExplainerShell, type ExplainerStep } from "../ExplainerShell";

interface FlexState {
  direction: "row" | "column";
  justify: "flex-start" | "center";
  align: "stretch" | "center";
}

const STATES: readonly FlexState[] = [
  { direction: "row", justify: "flex-start", align: "stretch" },
  { direction: "row", justify: "center", align: "stretch" },
  { direction: "row", justify: "center", align: "center" },
  { direction: "column", justify: "center", align: "center" },
];

const STEPS: readonly ExplainerStep[] = [
  {
    label: "display: flex",
    caption:
      "A flex container has two axes. With the default flex-direction: row the MAIN axis runs left to right, and the CROSS axis runs top to bottom. Items line up along the main axis and stretch along the cross axis.",
    code: ".row { display: flex; }",
  },
  {
    label: "justify-content works on the main axis",
    caption:
      "justify-content: center gathers the items at the centre of the MAIN axis. Because the direction is row, that looks horizontal — but that is a consequence, not the definition.",
    code: ".row { justify-content: center; }",
  },
  {
    label: "align-items works on the cross axis",
    caption:
      "align-items: center places the items at the centre of the CROSS axis, and they stop stretching to the container's height. Two properties, two axes: this pair is the whole of 'centre a box'.",
    code: ".row { align-items: center; }",
  },
  {
    label: "flex-direction: column swaps the axes",
    caption:
      "Nothing about justify-content or align-items changed — but the MAIN axis is now vertical, so justify-content centres vertically and align-items centres horizontally. Learn the axes, not the directions.",
    code: ".row { flex-direction: column; }",
  },
];

const ITEMS = ["1", "2", "3"];

export function FlexAxesDiagram() {
  return (
    <ExplainerShell conceptId="flex-axes" steps={STEPS}>
      {({ stepIndex, reducedMotion }) => {
        const state = STATES[stepIndex];
        const transition = stepTransition(reducedMotion);
        const mainIsHorizontal = state.direction === "row";

        return (
          <div className="flex w-full max-w-md flex-col items-center gap-2">
            {/* The container's own flex properties change instantly — it is the
                ITEMS that animate to their new positions, via Framer's layout
                animation, which is what makes the axis switch legible. */}
            <div
              style={{
                display: "flex",
                flexDirection: state.direction,
                justifyContent: state.justify,
                alignItems: state.align,
                gap: 8,
              }}
              className="h-44 w-full rounded border-2 border-dashed border-slate-500 bg-panel p-2"
            >
              {ITEMS.map((item) => (
                <motion.span
                  key={item}
                  layout
                  transition={transition}
                  className="flex min-h-8 min-w-12 items-center justify-center rounded bg-brand px-3 py-2 text-xs font-medium text-white"
                >
                  {item}
                </motion.span>
              ))}
            </div>

            {/* Axis labels. Both are always present — under reduced motion the
                only thing lost is the rotation, never the information. */}
            <div className="flex w-full items-center justify-between text-xs">
              <span className="rounded border border-brand/40 bg-brand/10 px-2 py-1 text-brand">
                main axis: {mainIsHorizontal ? "→ horizontal" : "↓ vertical"} (justify-content)
              </span>
              <span className="rounded border border-line bg-surface px-2 py-1 text-ink-muted">
                cross axis: {mainIsHorizontal ? "↓ vertical" : "→ horizontal"} (align-items)
              </span>
            </div>
          </div>
        );
      }}
    </ExplainerShell>
  );
}
