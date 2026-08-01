"use client";

// =============================================================================
// VISUALIZATION CONTROLS — the shared input surface for every concept visualizer
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THIS FILE EXISTS
// Six visualizers each need "a labelled slider", "a labelled choice" and "a way
// to tell a screen-reader user that the picture just changed". Six copies of
// that is six chances to forget the live region, and the live region is the
// single accessibility feature most likely to be dropped: a sighted user SEES
// the box resize, so nothing looks broken when the announcement is missing.
// Centralising it here means the announcement is part of the control, not part
// of somebody's discipline.
//
// WHY NATIVE <input type="range"> AND <select>
// A div with role="slider" is a promise to reimplement arrow keys, Home/End,
// PageUp/PageDown, the value announcement and the focus ring by hand. The
// native elements already do all of that and are the only controls guaranteed
// to work with a switch device and with mobile assistive tech. The house
// Button primitive is used wherever the control is genuinely a button; a
// slider is not a button, so it is not hand-rolled out of one.
//
// WHY THE EXPLICIT KEYDOWN HANDLER ON THE RANGE ANYWAY
// Two reasons, neither of them "the browser can't do it":
//   1. jsdom's range input does not implement key handling at all, so the
//      keyboard contract would be untestable — and an untested keyboard path is
//      how drag-only interactions get shipped. The handler makes the contract
//      assertable in a unit test.
//   2. It adds PageUp/PageDown (a coarse step) and Home/End (the extremes),
//      which the native control gives inconsistently across browsers. A student
//      dragging padding from 0 to 100 px should not need 100 key presses.
// The handler calls preventDefault, so the browser's own handling never runs
// twice on top of it.
// =============================================================================

import * as React from "react";

import { cn } from "@/components/ui";

/** Every dimension in this module is CSS pixels — the metric unit of the web. */
export const PX = "px";

// ---------------------------------------------------------------------------
// Live region
// ---------------------------------------------------------------------------

/**
 * A polite live region plus the function that speaks into it.
 *
 * `aria-live="polite"` rather than `assertive`: a student sweeping a slider
 * generates a change per keypress, and an assertive region would interrupt
 * itself into noise. Polite queues behind whatever is being read.
 */
export function useAnnouncer(): {
  message: string;
  announce: (message: string) => void;
} {
  const [message, setMessage] = React.useState("");
  const announce = React.useCallback((next: string) => setMessage(next), []);
  return { message, announce };
}

export interface LiveRegionProps {
  message: string;
  /** Exposed so a test can find the region belonging to one visualizer. */
  testId?: string;
}

export function LiveRegion({ message, testId }: LiveRegionProps) {
  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId ?? "viz-live-region"}
      // Visually hidden but NOT display:none — a hidden-by-display region is
      // never announced. This is the standard clip-rect technique.
      className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]"
    >
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Range control
// ---------------------------------------------------------------------------

export interface RangeControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Suffix shown next to the number and spoken in aria-valuetext, e.g. "px". */
  unit?: string;
  onChange: (value: number) => void;
  className?: string;
}

/** Coarse step for PageUp/PageDown: a tenth of the range, at least one step. */
function coarseStep(min: number, max: number, step: number): number {
  return Math.max(step, Math.round((max - min) / 10));
}

export function clampToRange(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  // Snap to the step grid measured from `min`, so a slider from 4 to 20 in
  // steps of 4 can never land on 5.
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = PX,
  onChange,
  className,
}: RangeControlProps) {
  // A degenerate range (min === max) must not divide by zero or render a
  // control that pretends to be adjustable.
  const usableMax = max > min ? max : min;
  const safeStep = step > 0 ? step : 1;
  const current = clampToRange(value, min, usableMax, safeStep);
  const valueText = `${current} ${unit}`;

  const commit = (next: number) => {
    const clamped = clampToRange(next, min, usableMax, safeStep);
    if (clamped !== current) onChange(clamped);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const big = coarseStep(min, usableMax, safeStep);
    const moves: Record<string, number | "min" | "max"> = {
      ArrowRight: safeStep,
      ArrowUp: safeStep,
      ArrowLeft: -safeStep,
      ArrowDown: -safeStep,
      PageUp: big,
      PageDown: -big,
      Home: "min",
      End: "max",
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    if (move === "min") commit(min);
    else if (move === "max") commit(usableMax);
    else commit(current + move);
  };

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-xs font-medium text-ink"
      >
        <span>{label}</span>
        <span className="tabular-nums text-ink-muted">{valueText}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={usableMax}
        step={safeStep}
        value={current}
        disabled={usableMax === min}
        onChange={(event) => commit(Number(event.target.value))}
        onKeyDown={onKeyDown}
        // aria-valuetext carries the unit; without it a screen reader says
        // "sixteen" and the student has no idea sixteen of what.
        aria-valuetext={valueText}
        // 44 px of vertical target — the WCAG 2.1 AA target-size guidance and
        // the practical minimum for a thumb on a phone. The track is drawn
        // smaller by the UA; the padding is what makes the hit area real.
        className="h-11 w-full cursor-pointer accent-[var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choice control
// ---------------------------------------------------------------------------

export interface SelectControlProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  className?: string;
}

export function SelectControl<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  className,
}: SelectControlProps<T>) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="block text-xs font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 h-11 w-full rounded-md border border-line bg-panel px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generated-code panel
// ---------------------------------------------------------------------------

export interface CodePanelProps {
  code: string;
  /** Names the block for assistive tech, e.g. "Generated CSS". */
  label: string;
  testId?: string;
}

/**
 * The generated CSS next to the controls. This is the whole pedagogical point
 * of a playground — a student who moves a control and reads the resulting
 * declaration learns the property name, which is the thing they have to type
 * later. `tabIndex={0}` because a scrollable region must be reachable by
 * keyboard to be scrollable by keyboard.
 */
export function CodePanel({ code, label, testId }: CodePanelProps) {
  return (
    <pre
      tabIndex={0}
      role="region"
      aria-label={label}
      data-testid={testId ?? "viz-code"}
      className="max-h-64 overflow-auto rounded-md border border-line bg-surface p-3 text-xs leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <code>{code}</code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Figure shell
// ---------------------------------------------------------------------------

export interface VizFigureProps {
  title: string;
  /** One sentence saying what the student is looking at. */
  description: string;
  titleId: string;
  children: React.ReactNode;
  className?: string;
  testId: string;
}

/**
 * The common frame. A `section` with `aria-labelledby` rather than a bare div:
 * a screen-reader user browsing by landmark/heading needs the visualizer to be
 * one navigable thing, not a loose pile of sliders.
 */
export function VizFigure({
  title,
  description,
  titleId,
  children,
  className,
  testId,
}: VizFigureProps) {
  return (
    <section
      aria-labelledby={titleId}
      data-testid={testId}
      className={cn(
        "relative space-y-4 rounded-lg border border-line bg-panel p-4 text-ink",
        className,
      )}
    >
      <header className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-ink-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}
