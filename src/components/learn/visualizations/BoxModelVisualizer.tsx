"use client";

// =============================================================================
// BOX MODEL VISUALIZER — content / padding / border / margin, live
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY A COMPONENT AND NOT A PARAGRAPH
// The box model is not hard to state — it is hard to believe. A student reads
// "padding is inside the border, margin is outside" and still cannot predict
// why their 200 px box occupies 260 px. The only thing that fixes that is
// changing one number and watching the total move. So the computed total is a
// first-class output here, not a footnote.
//
// NOT COLOUR-ONLY (WCAG 1.4.1). The four layers are told apart by THREE
// redundant signals: a text label inside each layer, a distinct border style
// (solid / dashed / dotted / double), and a distinct diagonal hatch. Print the
// component in greyscale and it still reads. The hue is the least important of
// the four cues, which is the point.
//
// UNITS. CSS pixels throughout — the metric unit of the medium. No inches, no
// points, anywhere in this file.
// =============================================================================

import * as React from "react";

import { cn } from "@/components/ui";

import {
  CodePanel,
  LiveRegion,
  RangeControl,
  VizFigure,
  useAnnouncer,
} from "./controls";

/** A CSS box side quartet in the CSS order: top, right, bottom, left. */
export type BoxSides = [number, number, number, number];

export interface BoxModelElement {
  width?: number;
  height?: number;
  padding?: number | BoxSides;
  border?: number;
  margin?: number | BoxSides;
}

/**
 * What `onDimensionsChange` receives.
 *
 * The specification typed this callback's argument as `any`. It is given a real
 * shape here instead: a caller that declared `(dims: any) => void` still type
 * checks against this, so nothing downstream breaks, and a caller that wants
 * the fields gets them.
 */
export interface BoxModelDimensions {
  width: number;
  height: number;
  padding: BoxSides;
  border: number;
  margin: BoxSides;
  /** Border-box width: content + horizontal padding + both borders. */
  borderBoxWidth: number;
  borderBoxHeight: number;
  /** Space actually occupied on the page, margins included. */
  totalWidth: number;
  totalHeight: number;
}

export interface BoxModelVisualizerProps {
  element: BoxModelElement;
  interactive?: boolean;
  labels?: boolean;
  onDimensionsChange?: (dims: BoxModelDimensions) => void;
  className?: string;
  /** Disambiguates control ids when two visualizers share a page. */
  idPrefix?: string;
}

const DEFAULTS = {
  width: 200,
  height: 120,
  padding: 16,
  border: 4,
  margin: 24,
} as const;

const LIMITS = {
  width: { min: 0, max: 400, step: 10 },
  height: { min: 0, max: 300, step: 10 },
  padding: { min: 0, max: 60, step: 2 },
  border: { min: 0, max: 24, step: 1 },
  margin: { min: 0, max: 60, step: 2 },
} as const;

/** Normalise `number | BoxSides` to a quartet, tolerating a malformed tuple. */
export function toSides(value: number | BoxSides | undefined, fallback: number): BoxSides {
  if (Array.isArray(value)) {
    const sides = value.map((n) => (Number.isFinite(n) && n >= 0 ? n : 0));
    return [sides[0] ?? 0, sides[1] ?? 0, sides[2] ?? 0, sides[3] ?? 0];
  }
  const n = Number.isFinite(value) && (value as number) >= 0 ? (value as number) : fallback;
  return [n, n, n, n];
}

/** Every derived number the diagram and the announcement need. */
export function computeDimensions(state: {
  width: number;
  height: number;
  padding: BoxSides;
  border: number;
  margin: BoxSides;
}): BoxModelDimensions {
  const [pt, pr, pb, pl] = state.padding;
  const [mt, mr, mb, ml] = state.margin;
  const borderBoxWidth = state.width + pl + pr + state.border * 2;
  const borderBoxHeight = state.height + pt + pb + state.border * 2;
  return {
    ...state,
    borderBoxWidth,
    borderBoxHeight,
    totalWidth: borderBoxWidth + ml + mr,
    totalHeight: borderBoxHeight + mt + mb,
  };
}

/** `16px` or `8px 16px 8px 16px` — the shorthand a student would actually write. */
function sidesToCss([t, r, b, l]: BoxSides): string {
  return t === r && r === b && b === l ? `${t}px` : `${t}px ${r}px ${b}px ${l}px`;
}

// Diagonal hatches at four different angles. These are the greyscale-safe cue:
// two layers can never be confused even if the viewer sees no colour at all.
const HATCH: Record<"margin" | "border" | "padding" | "content", string> = {
  margin:
    "repeating-linear-gradient(45deg, var(--color-line) 0 4px, transparent 4px 10px)",
  border:
    "repeating-linear-gradient(135deg, var(--color-ink-muted) 0 3px, transparent 3px 7px)",
  padding:
    "repeating-linear-gradient(90deg, var(--color-accent) 0 3px, transparent 3px 9px)",
  content: "none",
};

export function BoxModelVisualizer({
  element,
  interactive = true,
  labels = true,
  onDimensionsChange,
  className,
  idPrefix = "box-model",
}: BoxModelVisualizerProps) {
  const [width, setWidth] = React.useState(() =>
    Number.isFinite(element.width) ? Math.max(0, element.width as number) : DEFAULTS.width,
  );
  const [height, setHeight] = React.useState(() =>
    Number.isFinite(element.height) ? Math.max(0, element.height as number) : DEFAULTS.height,
  );
  const [padding, setPadding] = React.useState<BoxSides>(() =>
    toSides(element.padding, DEFAULTS.padding),
  );
  const [border, setBorder] = React.useState(() =>
    Number.isFinite(element.border) ? Math.max(0, element.border as number) : DEFAULTS.border,
  );
  const [margin, setMargin] = React.useState<BoxSides>(() =>
    toSides(element.margin, DEFAULTS.margin),
  );

  const dims = computeDimensions({ width, height, padding, border, margin });

  const { message, announce } = useAnnouncer();
  const titleId = `${idPrefix}-title`;

  // Fire the callback on every settled change, not on every render, so a
  // parent that persists the dimensions is not written to on mount.
  const onChangeRef = React.useRef(onDimensionsChange);
  onChangeRef.current = onDimensionsChange;
  const signature = `${width}|${height}|${padding.join(",")}|${border}|${margin.join(",")}`;
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onChangeRef.current?.(computeDimensions({ width, height, padding, border, margin }));
    // `signature` is the intentional dependency: it is the value identity of
    // the five pieces of state, and depending on the arrays directly would
    // re-fire on every render because a fresh tuple is never referentially equal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /** One announcement shape for every control, so the total is always spoken. */
  const announceChange = (what: string, value: number, next: BoxModelDimensions) => {
    announce(
      `${what} ${value} pixels. Total occupied space ${next.totalWidth} by ${next.totalHeight} pixels.`,
    );
  };

  const setUniform =
    (
      what: string,
      apply: (value: number) => Parameters<typeof computeDimensions>[0],
      commit: (value: number) => void,
    ) =>
    (value: number) => {
      commit(value);
      announceChange(what, value, computeDimensions(apply(value)));
    };

  const css = [
    ".box {",
    `  width: ${width}px;`,
    `  height: ${height}px;`,
    `  padding: ${sidesToCss(padding)};`,
    `  border: ${border}px solid;`,
    `  margin: ${sidesToCss(margin)};`,
    "}",
    "",
    `/* border-box: ${dims.borderBoxWidth}px x ${dims.borderBoxHeight}px */`,
    `/* occupies:   ${dims.totalWidth}px x ${dims.totalHeight}px */`,
  ].join("\n");

  return (
    <VizFigure
      title="Box model"
      description="Change any layer and watch the space the element actually occupies change with it. All sizes are CSS pixels."
      titleId={titleId}
      testId="box-model-visualizer"
      className={className}
    >
      <LiveRegion message={message} testId="box-model-live" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* --- the diagram ------------------------------------------------- */}
        <div className="min-w-0 overflow-x-auto">
          <div
            data-testid="box-model-margin"
            data-layer="margin"
            aria-hidden="true"
            className="inline-block border-2 border-dashed border-line"
            style={{
              padding: `${margin[0]}px ${margin[1]}px ${margin[2]}px ${margin[3]}px`,
              backgroundImage: HATCH.margin,
            }}
          >
            <div
              data-testid="box-model-border"
              data-layer="border"
              className="border-ink-muted"
              style={{
                borderStyle: "double",
                borderWidth: `${border}px`,
                backgroundImage: HATCH.border,
              }}
            >
              <div
                data-testid="box-model-padding"
                data-layer="padding"
                className="border border-dotted border-ink-muted"
                style={{
                  padding: `${padding[0]}px ${padding[1]}px ${padding[2]}px ${padding[3]}px`,
                  backgroundImage: HATCH.padding,
                }}
              >
                <div
                  data-testid="box-model-content"
                  data-layer="content"
                  className="flex items-center justify-center border border-solid border-brand bg-panel text-center text-xs font-medium text-ink"
                  style={{ width: `${width}px`, height: `${height}px` }}
                >
                  {labels && width >= 60 && height >= 24 ? (
                    <span>
                      content
                      <br />
                      {width} x {height} px
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* The legend is what makes the diagram readable without colour, and
              it is also the accessible text alternative for the aria-hidden
              picture above. Each row names the layer, its border style and its
              measurement, so nothing is conveyed by the swatch alone. */}
          {labels && (
            <dl
              data-testid="box-model-legend"
              className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"
            >
              <LegendRow term="Margin (dashed outline)" value={sidesToCss(margin)} />
              <LegendRow term="Border (double outline)" value={`${border}px`} />
              <LegendRow term="Padding (dotted outline)" value={sidesToCss(padding)} />
              <LegendRow term="Content (solid outline)" value={`${width}px x ${height}px`} />
            </dl>
          )}

          <p
            data-testid="box-model-total"
            className="mt-3 rounded-md border border-line bg-surface p-2 text-sm font-medium tabular-nums"
          >
            Border box {dims.borderBoxWidth} x {dims.borderBoxHeight} px — occupies{" "}
            {dims.totalWidth} x {dims.totalHeight} px including margin.
          </p>
        </div>

        {/* --- the controls ------------------------------------------------ */}
        {interactive ? (
          <div className="grid min-w-0 gap-2 self-start rounded-md border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-1">
            <RangeControl
              id={`${idPrefix}-width`}
              label="Content width"
              value={width}
              {...LIMITS.width}
              onChange={setUniform(
                "Content width",
                (v) => ({ width: v, height, padding, border, margin }),
                setWidth,
              )}
            />
            <RangeControl
              id={`${idPrefix}-height`}
              label="Content height"
              value={height}
              {...LIMITS.height}
              onChange={setUniform(
                "Content height",
                (v) => ({ width, height: v, padding, border, margin }),
                setHeight,
              )}
            />
            <RangeControl
              id={`${idPrefix}-padding`}
              label="Padding (all sides)"
              value={padding[0]}
              {...LIMITS.padding}
              onChange={setUniform(
                "Padding",
                (v) => ({ width, height, padding: [v, v, v, v], border, margin }),
                (v) => setPadding([v, v, v, v]),
              )}
            />
            <RangeControl
              id={`${idPrefix}-border`}
              label="Border width"
              value={border}
              {...LIMITS.border}
              onChange={setUniform(
                "Border",
                (v) => ({ width, height, padding, border: v, margin }),
                setBorder,
              )}
            />
            <RangeControl
              id={`${idPrefix}-margin`}
              label="Margin (all sides)"
              value={margin[0]}
              {...LIMITS.margin}
              onChange={setUniform(
                "Margin",
                (v) => ({ width, height, padding, border, margin: [v, v, v, v] }),
                (v) => setMargin([v, v, v, v]),
              )}
            />
          </div>
        ) : null}
      </div>

      <CodePanel code={css} label="Generated CSS for the box" testId="box-model-code" />
    </VizFigure>
  );
}

function LegendRow({ term, value }: { term: string; value: string }) {
  return (
    <div className={cn("flex justify-between gap-2 border-b border-line py-0.5")}>
      <dt className="text-ink-muted">{term}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}

export default BoxModelVisualizer;
