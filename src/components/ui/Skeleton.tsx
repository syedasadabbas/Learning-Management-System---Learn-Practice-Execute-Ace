import * as React from "react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { cn } from "./cn";

export type SkeletonShape = "text" | "block" | "circle";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: SkeletonShape;
  /** Number of stacked lines. Only meaningful for shape="text". */
  lines?: number;
  /**
   * Accessible description of what is loading, e.g. "Loading your weeks".
   * Spoken once by the live region; the bars themselves are aria-hidden.
   */
  label?: string;
}

// =============================================================================
// SKELETON — the placeholder that admits content is still coming
// -----------------------------------------------------------------------------
// Owner: ui-shell stream.
//
// WHY THIS PRIMITIVE DID NOT EXIST AND NOW DOES. There is no loading.tsx
// anywhere under src/app and no placeholder component in the barrel, so every
// route in this app streams in with nothing on screen: the student clicks
// "Week 3" and looks at the previous page until the server component resolves.
// The single largest perceived-performance win available to a design system is
// not making the wait shorter — the DB work behind these pages was already
// attacked in 25fe2d2 — it is making the wait LEGIBLE. This is the primitive
// that lets any stream do that in one line, without inventing its own grey box.
//
// It is exported and demonstrated on /_ui but not yet placed into a route:
// src/app/(app)/** belongs to other streams and to a concurrent page-transition
// change, so wiring the loading.tsx files is theirs to do. Stated plainly
// rather than half-done — see the CHANGELOG entry.
//
// RESOLVED 2026-07-31 — the TODO that used to sit here said PageSkeleton should
// compose this primitive once both changes were on the branch. Both are, and it
// now does. src/components/nav/PageSkeleton.tsx previously drew its own bars
// with Tailwind's `motion-safe:animate-pulse` (an opacity blink) while this file
// used the `ui-skeleton` sweep from globals.css: two different loading shimmers
// in one product, which is precisely the drift a design system exists to
// prevent. `SkeletonBar` below is the shared vocabulary — ONE bar, ONE shimmer,
// ONE reduced-motion override — and it is what both this component and
// PageSkeleton render. The SHAPES PageSkeleton arranges (week cards, standings
// rows, stat tiles) stay its own concern, because they mirror pages this stream
// does not own.
//
// THE ANIMATION IS THE POINT HERE, unlike everywhere else in this stream. A
// static grey block is indistinguishable from a layout bug or from an empty
// state; the sweep is what says "in progress". So under prefers-reduced-motion,
// where globals.css stops the sweep and flattens the gradient, that meaning has
// to be carried by something else — hence role="status" + aria-busy, which are
// present in BOTH modes and are what a screen-reader user was relying on
// anyway. The component never becomes a silent grey rectangle.
// =============================================================================

/**
 * ONE placeholder bar — the shared shimmer vocabulary.
 *
 * WHY THIS IS EXPORTED rather than kept private to `Skeleton`. Two components
 * need a grey shimmering rectangle: this primitive (which arranges 1..n of them
 * into text/block/circle) and `PageSkeleton` (which arranges them into a
 * per-route page shape). Exporting the BAR rather than the arrangement is what
 * makes those one design instead of two: the sweep, the tint, the rounding and
 * the reduced-motion behaviour are all decided here exactly once.
 *
 * `MOTION_CLASS.skeleton` is `ui-skeleton` in globals.css, which is where the
 * reduced-motion override also lives — `animation: none` plus `background-image:
 * none`, so the bar keeps its size and its flat tint and simply stops moving. A
 * Tailwind `motion-safe:` variant could not do the second half of that, which is
 * why the class is the vocabulary and not a utility string.
 *
 * `aria-hidden` is not optional and is not a prop: a bar carries no information
 * a screen reader can use, and the announcement belongs to the one live region
 * on whichever wrapper is arranging the bars.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton-bar"
      className={cn(MOTION_CLASS.skeleton, "rounded", className)}
    />
  );
}

const SHAPE_CLASSES: Record<SkeletonShape, string> = {
  // h-4 with a rounded end approximates a line of body text at the app's base
  // size; the last line is shortened below so a paragraph does not read as a
  // suspiciously perfect rectangle.
  text: "h-4 rounded",
  block: "h-24 rounded-lg",
  circle: "size-10 rounded-full",
};

export function Skeleton({
  shape = "text",
  lines = 1,
  label = "Loading",
  className,
  ...rest
}: SkeletonProps) {
  // A skeleton for 0 or fewer lines is a caller bug (usually `items.length`
  // before the fetch resolved). Render one line rather than nothing: an empty
  // container would collapse the layout it exists to reserve.
  const count = shape === "text" ? Math.max(1, Math.floor(lines) || 1) : 1;

  return (
    <div
      data-testid="skeleton"
      data-shape={shape}
      data-lines={count}
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("flex w-full flex-col gap-2", className)}
      {...rest}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBar
          key={i}
          className={cn(
            SHAPE_CLASSES[shape],
            // Last line of a multi-line block runs short, the way real text does.
            shape === "text" && count > 1 && i === count - 1 && "w-3/5",
          )}
        />
      ))}
    </div>
  );
}
