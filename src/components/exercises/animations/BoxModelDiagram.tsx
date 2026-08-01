"use client";

// =============================================================================
// BOX MODEL EXPLAINER
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// Teaches the one thing beginners get wrong: `width` is the CONTENT width by
// default, so padding and border are added ON TOP of it, and `box-sizing:
// border-box` is what makes `width` mean "the whole box". The diagram animates the
// layers on in the order the cascade applies them, then flips box-sizing so the
// content visibly shrinks while the outer footprint stays put — the exact moment
// the rule becomes obvious.
//
// Numbers are real and metric-free (CSS pixels), and the arithmetic is printed so
// the diagram and the caption cannot drift apart.
// =============================================================================

import { motion } from "framer-motion";

import { stepTransition } from "@/lib/exercises/reduced-motion";
import { ExplainerShell, type ExplainerStep } from "../ExplainerShell";

const CONTENT_WIDTH_PX = 200;
const PADDING_PX = 20;
const BORDER_PX = 10;
const MARGIN_PX = 20;

/** Content width the browser computes once box-sizing: border-box is set. */
const BORDER_BOX_CONTENT_PX = CONTENT_WIDTH_PX - 2 * PADDING_PX - 2 * BORDER_PX; // 140

interface Layer {
  padding: number;
  border: number;
  margin: number;
  contentWidth: number;
  /** Total horizontal space the element occupies, margins excluded. */
  boxWidth: number;
}

const LAYERS: readonly Layer[] = [
  { padding: 0, border: 0, margin: 0, contentWidth: CONTENT_WIDTH_PX, boxWidth: 200 },
  { padding: PADDING_PX, border: 0, margin: 0, contentWidth: CONTENT_WIDTH_PX, boxWidth: 240 },
  { padding: PADDING_PX, border: BORDER_PX, margin: 0, contentWidth: CONTENT_WIDTH_PX, boxWidth: 260 },
  { padding: PADDING_PX, border: BORDER_PX, margin: MARGIN_PX, contentWidth: CONTENT_WIDTH_PX, boxWidth: 260 },
  {
    padding: PADDING_PX,
    border: BORDER_PX,
    margin: MARGIN_PX,
    contentWidth: BORDER_BOX_CONTENT_PX,
    boxWidth: 200,
  },
];

const STEPS: readonly ExplainerStep[] = [
  {
    label: "Content box",
    caption: `width: ${CONTENT_WIDTH_PX}px sets the CONTENT area only. On screen the element is ${CONTENT_WIDTH_PX} px wide — for now.`,
    code: `.box { width: ${CONTENT_WIDTH_PX}px; }`,
  },
  {
    label: "Padding pushes outwards",
    caption: `Padding is space inside the element, around the content. It is added to the width: ${CONTENT_WIDTH_PX} + ${PADDING_PX} + ${PADDING_PX} = ${CONTENT_WIDTH_PX + 2 * PADDING_PX} px on screen.`,
    code: `.box { width: ${CONTENT_WIDTH_PX}px; padding: ${PADDING_PX}px; }`,
  },
  {
    label: "Border wraps the padding",
    caption: `The border sits outside the padding and is also added on: ${CONTENT_WIDTH_PX} + ${2 * PADDING_PX} + ${2 * BORDER_PX} = ${CONTENT_WIDTH_PX + 2 * PADDING_PX + 2 * BORDER_PX} px. This is why a "200 px" box overflows a 250 px column.`,
    code: `.box { width: ${CONTENT_WIDTH_PX}px; padding: ${PADDING_PX}px; border: ${BORDER_PX}px solid; }`,
  },
  {
    label: "Margin is space between elements",
    caption: `Margin is outside the border and is NOT part of the element's own width — it pushes neighbours away, and vertical margins between siblings collapse into the larger of the two.`,
    code: `.box { margin: ${MARGIN_PX}px; }`,
  },
  {
    label: "box-sizing: border-box",
    caption: `Now width means the whole box: padding and border are taken OUT of the ${CONTENT_WIDTH_PX} px instead of added to it, so the content shrinks to ${BORDER_BOX_CONTENT_PX} px and the element is exactly ${CONTENT_WIDTH_PX} px on screen. This is why stylesheets start with * { box-sizing: border-box }.`,
    code: "* { box-sizing: border-box; }",
  },
];

export function BoxModelDiagram() {
  return (
    <ExplainerShell conceptId="box-model" steps={STEPS}>
      {({ stepIndex, reducedMotion }) => {
        const layer = LAYERS[stepIndex];
        const transition = stepTransition(reducedMotion);

        return (
          <div className="flex flex-col items-center gap-2">
            {/* margin box */}
            <motion.div
              animate={{ padding: layer.margin }}
              transition={transition}
              className="rounded border border-dashed border-amber-400 bg-amber-50/60"
            >
              {/* border box */}
              <motion.div
                animate={{ borderWidth: layer.border }}
                transition={transition}
                style={{ borderStyle: "solid" }}
                className="border-slate-600 bg-slate-200"
              >
                {/* padding box */}
                <motion.div
                  animate={{ padding: layer.padding }}
                  transition={transition}
                  className="bg-emerald-100"
                >
                  {/* content box */}
                  <motion.div
                    animate={{ width: layer.contentWidth }}
                    transition={transition}
                    className="flex h-16 items-center justify-center bg-brand text-xs font-medium text-white"
                  >
                    content {layer.contentWidth} px
                  </motion.div>
                </motion.div>
              </motion.div>
            </motion.div>

            <p className="text-xs text-ink-muted">
              element on screen: <strong>{layer.boxWidth} px</strong>
              {layer.margin > 0 && <> · plus {layer.margin} px margin each side</>}
            </p>
          </div>
        );
      }}
    </ExplainerShell>
  );
}
