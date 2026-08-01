"use client";

// =============================================================================
// FLEXBOX PLAYGROUND — the property, the picture and the code, side by side
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THE GENERATED CSS IS NOT OPTIONAL DECORATION
// A student who only sees the boxes move learns "the third dropdown spreads
// things out". A student who sees `justify-content: space-between` appear as
// they do it learns the property name — which is the part they have to type
// from memory in the exercise ten minutes later. The code panel is the lesson;
// the boxes are the feedback. `showCode` can turn it off because the spec asks
// for the prop, but the default is on for that reason.
//
// WHY EVERY ITEM IS NUMBERED
// Under `flex-direction: row-reverse` the visual order stops matching the
// source order. That divergence IS the concept, and it is invisible if the
// items are identical squares. The numbers make it legible — and they make it
// legible to a screen reader too, which reads the items in DOM order and would
// otherwise have no way to convey that the picture disagrees.
// =============================================================================

import * as React from "react";

import {
  CodePanel,
  LiveRegion,
  RangeControl,
  SelectControl,
  VizFigure,
  useAnnouncer,
} from "./controls";

export const FLEX_DIRECTIONS = ["row", "row-reverse", "column", "column-reverse"] as const;
export const JUSTIFY_VALUES = [
  "flex-start",
  "flex-end",
  "center",
  "space-between",
  "space-around",
  "space-evenly",
] as const;
export const ALIGN_VALUES = ["stretch", "flex-start", "flex-end", "center", "baseline"] as const;
export const WRAP_VALUES = ["nowrap", "wrap", "wrap-reverse"] as const;

export type FlexDirection = (typeof FLEX_DIRECTIONS)[number];
export type JustifyContent = (typeof JUSTIFY_VALUES)[number];
export type AlignItems = (typeof ALIGN_VALUES)[number];
export type FlexWrap = (typeof WRAP_VALUES)[number];

export interface FlexboxConfig {
  flexDirection?: FlexDirection;
  /** Typed as string in the specification; narrowed on read, see `coerce`. */
  justifyContent?: string;
  alignItems?: string;
  flexWrap?: FlexWrap;
  gap?: number;
}

export interface FlexboxPlaygroundProps {
  initialConfig?: FlexboxConfig;
  interactive?: boolean;
  showCode?: boolean;
  numItems?: number;
  className?: string;
  idPrefix?: string;
}

/** The spec types justify/align as bare `string`; anything unknown falls back. */
function coerce<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

const GAP = { min: 0, max: 48, step: 4 } as const;
/** Enough items to make wrapping observable at 360 px, few enough to stay legible. */
const MAX_ITEMS = 12;

export function FlexboxPlayground({
  initialConfig,
  interactive = true,
  showCode = true,
  numItems = 5,
  className,
  idPrefix = "flexbox",
}: FlexboxPlaygroundProps) {
  const [direction, setDirection] = React.useState<FlexDirection>(() =>
    coerce(initialConfig?.flexDirection, FLEX_DIRECTIONS, "row"),
  );
  const [justify, setJustify] = React.useState<JustifyContent>(() =>
    coerce(initialConfig?.justifyContent, JUSTIFY_VALUES, "flex-start"),
  );
  const [align, setAlign] = React.useState<AlignItems>(() =>
    coerce(initialConfig?.alignItems, ALIGN_VALUES, "stretch"),
  );
  const [wrap, setWrap] = React.useState<FlexWrap>(() =>
    coerce(initialConfig?.flexWrap, WRAP_VALUES, "nowrap"),
  );
  const [gap, setGap] = React.useState(() =>
    Number.isFinite(initialConfig?.gap) ? Math.max(0, initialConfig?.gap as number) : 8,
  );

  // A zero or negative item count would render an empty container with no hint
  // that anything is wrong; one item is the honest degenerate case and still
  // demonstrates justify-content.
  const itemCount = Math.min(MAX_ITEMS, Math.max(1, Math.floor(numItems) || 1));
  const items = React.useMemo(
    () => Array.from({ length: itemCount }, (_, index) => index + 1),
    [itemCount],
  );

  const { message, announce } = useAnnouncer();
  const titleId = `${idPrefix}-title`;

  const css = [
    ".container {",
    "  display: flex;",
    `  flex-direction: ${direction};`,
    `  justify-content: ${justify};`,
    `  align-items: ${align};`,
    `  flex-wrap: ${wrap};`,
    `  gap: ${gap}px;`,
    "}",
  ].join("\n");

  return (
    <VizFigure
      title="Flexbox playground"
      description="Set a property on the container and watch the items respond. The CSS below is exactly what you would write."
      titleId={titleId}
      testId="flexbox-playground"
      className={className}
    >
      <LiveRegion message={message} testId="flexbox-live" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <div
            data-testid="flexbox-container"
            data-direction={direction}
            data-justify={justify}
            data-align={align}
            data-wrap={wrap}
            data-gap={gap}
            // The container is aria-hidden and described by the code panel and
            // the live region instead: read aloud, "1 2 3 4 5" tells a screen
            // reader user nothing about alignment, and the declaration does.
            aria-hidden="true"
            className="min-h-40 rounded-md border-2 border-dashed border-line bg-surface p-2"
            style={{
              display: "flex",
              flexDirection: direction,
              justifyContent: justify,
              alignItems: align,
              flexWrap: wrap,
              gap: `${gap}px`,
            }}
          >
            {items.map((n) => (
              <div
                key={n}
                data-testid="flexbox-item"
                className="flex min-h-11 min-w-11 items-center justify-center rounded border border-brand bg-panel px-3 text-sm font-semibold text-ink"
                // Varying heights make align-items visible; a row of identical
                // boxes makes `center` and `stretch` look the same.
                style={{ height: align === "stretch" ? undefined : `${32 + (n % 3) * 16}px` }}
              >
                {n}
              </div>
            ))}
          </div>

          <p data-testid="flexbox-summary" className="text-xs text-ink-muted">
            {itemCount} item{itemCount === 1 ? "" : "s"}, laid out {direction}, justified{" "}
            {justify}, aligned {align}, {wrap}, with a {gap} px gap.
          </p>
        </div>

        {interactive ? (
          <div className="grid min-w-0 gap-2 self-start rounded-md border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-1">
            <SelectControl
              id={`${idPrefix}-direction`}
              label="flex-direction"
              value={direction}
              options={FLEX_DIRECTIONS}
              onChange={(value) => {
                setDirection(value);
                announce(`flex-direction is now ${value}.`);
              }}
            />
            <SelectControl
              id={`${idPrefix}-justify`}
              label="justify-content"
              value={justify}
              options={JUSTIFY_VALUES}
              onChange={(value) => {
                setJustify(value);
                announce(`justify-content is now ${value}.`);
              }}
            />
            <SelectControl
              id={`${idPrefix}-align`}
              label="align-items"
              value={align}
              options={ALIGN_VALUES}
              onChange={(value) => {
                setAlign(value);
                announce(`align-items is now ${value}.`);
              }}
            />
            <SelectControl
              id={`${idPrefix}-wrap`}
              label="flex-wrap"
              value={wrap}
              options={WRAP_VALUES}
              onChange={(value) => {
                setWrap(value);
                announce(`flex-wrap is now ${value}.`);
              }}
            />
            <RangeControl
              id={`${idPrefix}-gap`}
              label="gap"
              value={gap}
              {...GAP}
              onChange={(value) => {
                setGap(value);
                announce(`gap is now ${value} pixels.`);
              }}
            />
          </div>
        ) : null}
      </div>

      {showCode ? (
        <CodePanel code={css} label="Generated flexbox CSS" testId="flexbox-code" />
      ) : null}
    </VizFigure>
  );
}

export default FlexboxPlayground;
