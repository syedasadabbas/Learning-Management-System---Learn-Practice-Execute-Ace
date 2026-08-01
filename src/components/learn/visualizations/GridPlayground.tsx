"use client";

// =============================================================================
// GRID PLAYGROUND — two-dimensional layout, and the span that makes it grid
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THIS IS NOT JUST THE FLEXBOX PLAYGROUND WITH A DIFFERENT `display`
// The reason students reach for flexbox when they need grid is that they have
// only ever seen grid described as "flexbox in two directions". The thing that
// is actually different — placing one item across several tracks — is missing
// from that description. So this playground carries a column-span and row-span
// control for a single selected item. That is the concept; the track counts and
// the gap are just the setting it happens in.
//
// WHY TRACK COUNTS ARE SLIDERS AND NOT A FREE-TEXT `grid-template-columns`
// A text field would let a student write `repeat(auto-fill, minmax(200px, 1fr))`
// and learn nothing when it silently does not parse. A slider that generates
// `repeat(3, 1fr)` in the code panel teaches the shorthand and cannot produce
// an invalid grid. Free-form template authoring is deliberately out of scope.
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

export const JUSTIFY_ITEMS_VALUES = ["stretch", "start", "end", "center"] as const;
export type GridJustifyItems = (typeof JUSTIFY_ITEMS_VALUES)[number];

export interface GridPlaygroundConfig {
  columns?: number;
  rows?: number;
  gap?: number;
  justifyItems?: string;
  /** 1-based index of the item that the span controls act on. */
  featuredItem?: number;
  columnSpan?: number;
  rowSpan?: number;
}

export interface GridPlaygroundProps {
  initialConfig?: GridPlaygroundConfig;
  interactive?: boolean;
  showCode?: boolean;
  className?: string;
  idPrefix?: string;
}

const LIMITS = {
  columns: { min: 1, max: 6, step: 1 },
  rows: { min: 1, max: 5, step: 1 },
  gap: { min: 0, max: 40, step: 4 },
} as const;

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}

export function GridPlayground({
  initialConfig,
  interactive = true,
  showCode = true,
  className,
  idPrefix = "grid",
}: GridPlaygroundProps) {
  const [columns, setColumns] = React.useState(() => clampInt(initialConfig?.columns, 1, 6, 3));
  const [rows, setRows] = React.useState(() => clampInt(initialConfig?.rows, 1, 5, 3));
  const [gap, setGap] = React.useState(() => clampInt(initialConfig?.gap, 0, 40, 8));
  const [justifyItems, setJustifyItems] = React.useState<GridJustifyItems>(() =>
    (JUSTIFY_ITEMS_VALUES as readonly string[]).includes(initialConfig?.justifyItems ?? "")
      ? (initialConfig?.justifyItems as GridJustifyItems)
      : "stretch",
  );
  const [columnSpan, setColumnSpan] = React.useState(() =>
    clampInt(initialConfig?.columnSpan, 1, 6, 2),
  );
  const [rowSpan, setRowSpan] = React.useState(() => clampInt(initialConfig?.rowSpan, 1, 5, 1));

  const cellCount = columns * rows;
  const featured = clampInt(initialConfig?.featuredItem, 1, cellCount, 1);

  // A span longer than the remaining tracks would overflow the grid and make
  // the demo look broken rather than instructive, so it is capped, and the cap
  // is visible in the generated CSS so the student sees why.
  const effectiveColumnSpan = Math.min(columnSpan, columns);
  const effectiveRowSpan = Math.min(rowSpan, rows);

  // The spanned item swallows cells that would otherwise be filled; rendering
  // the full count anyway would push a trailing item onto a new implicit row.
  const renderedCount = Math.max(
    1,
    cellCount - (effectiveColumnSpan * effectiveRowSpan - 1),
  );
  const items = React.useMemo(
    () => Array.from({ length: renderedCount }, (_, index) => index + 1),
    [renderedCount],
  );

  const { message, announce } = useAnnouncer();
  const titleId = `${idPrefix}-title`;

  const css = [
    ".grid {",
    "  display: grid;",
    `  grid-template-columns: repeat(${columns}, 1fr);`,
    `  grid-template-rows: repeat(${rows}, minmax(48px, auto));`,
    `  gap: ${gap}px;`,
    `  justify-items: ${justifyItems};`,
    "}",
    "",
    `.grid > :nth-child(${featured}) {`,
    `  grid-column: span ${effectiveColumnSpan};`,
    `  grid-row: span ${effectiveRowSpan};`,
    "}",
  ].join("\n");

  return (
    <VizFigure
      title="CSS Grid playground"
      description="Grid places items in two directions at once. Change the tracks, then make one item span several of them."
      titleId={titleId}
      testId="grid-playground"
      className={className}
    >
      <LiveRegion message={message} testId="grid-live" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <div
            data-testid="grid-container"
            data-columns={columns}
            data-rows={rows}
            data-gap={gap}
            aria-hidden="true"
            className="rounded-md border-2 border-dashed border-line bg-surface p-2"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: "minmax(48px, auto)",
              gap: `${gap}px`,
              justifyItems,
            }}
          >
            {items.map((n) => {
              const isFeatured = n === featured;
              return (
                <div
                  key={n}
                  data-testid="grid-item"
                  data-featured={isFeatured ? "true" : undefined}
                  className={
                    isFeatured
                      ? "flex min-h-11 w-full items-center justify-center rounded border-2 border-solid border-brand bg-panel px-2 text-sm font-semibold text-ink"
                      : "flex min-h-11 w-full items-center justify-center rounded border border-dotted border-ink-muted bg-panel px-2 text-sm text-ink"
                  }
                  style={
                    isFeatured
                      ? {
                          gridColumn: `span ${effectiveColumnSpan}`,
                          gridRow: `span ${effectiveRowSpan}`,
                        }
                      : undefined
                  }
                >
                  {/* The spanned item says so in words: a thicker border is a
                      colour/weight cue, and the text is the one that survives. */}
                  {isFeatured ? `${n} — spans ${effectiveColumnSpan}x${effectiveRowSpan}` : n}
                </div>
              );
            })}
          </div>

          <p data-testid="grid-summary" className="text-xs text-ink-muted">
            {columns} column{columns === 1 ? "" : "s"} by {rows} row{rows === 1 ? "" : "s"}, {gap} px
            gap. Item {featured} spans {effectiveColumnSpan} column
            {effectiveColumnSpan === 1 ? "" : "s"} and {effectiveRowSpan} row
            {effectiveRowSpan === 1 ? "" : "s"}.
          </p>
        </div>

        {interactive ? (
          <div className="grid min-w-0 gap-2 self-start rounded-md border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-1">
            <RangeControl
              id={`${idPrefix}-columns`}
              label="Columns"
              value={columns}
              {...LIMITS.columns}
              unit="tracks"
              onChange={(value) => {
                setColumns(value);
                announce(`${value} columns.`);
              }}
            />
            <RangeControl
              id={`${idPrefix}-rows`}
              label="Rows"
              value={rows}
              {...LIMITS.rows}
              unit="tracks"
              onChange={(value) => {
                setRows(value);
                announce(`${value} rows.`);
              }}
            />
            <RangeControl
              id={`${idPrefix}-gap`}
              label="gap"
              value={gap}
              {...LIMITS.gap}
              onChange={(value) => {
                setGap(value);
                announce(`gap is now ${value} pixels.`);
              }}
            />
            <RangeControl
              id={`${idPrefix}-column-span`}
              label={`Item ${featured} column span`}
              value={columnSpan}
              min={1}
              max={6}
              step={1}
              unit="tracks"
              onChange={(value) => {
                setColumnSpan(value);
                announce(
                  `Item ${featured} spans ${Math.min(value, columns)} columns.`,
                );
              }}
            />
            <RangeControl
              id={`${idPrefix}-row-span`}
              label={`Item ${featured} row span`}
              value={rowSpan}
              min={1}
              max={5}
              step={1}
              unit="tracks"
              onChange={(value) => {
                setRowSpan(value);
                announce(`Item ${featured} spans ${Math.min(value, rows)} rows.`);
              }}
            />
            <SelectControl
              id={`${idPrefix}-justify-items`}
              label="justify-items"
              value={justifyItems}
              options={JUSTIFY_ITEMS_VALUES}
              onChange={(value) => {
                setJustifyItems(value);
                announce(`justify-items is now ${value}.`);
              }}
            />
          </div>
        ) : null}
      </div>

      {showCode ? <CodePanel code={css} label="Generated grid CSS" testId="grid-code" /> : null}
    </VizFigure>
  );
}

export default GridPlayground;
