// =============================================================================
// MOTION TOKENS — the durations and class names the shared primitives animate on
// -----------------------------------------------------------------------------
// Owner: ui-shell stream.
//
// WHY THIS FILE EXISTS AT ALL
// Before this, animation lived as three unrelated magic numbers scattered across
// the primitives: `transition-colors duration-150` (Button.tsx:41),
// `transition-shadow duration-150` (Card.tsx:40), `transition-[width]
// duration-300` (ProgressBar.tsx:94) and `transition-transform duration-150`
// (StarRating.tsx:184). Four call sites, three values, no name for any of them,
// and — the part that mattered — nothing that a test could read. This module
// gives the scale ONE name per step so a reviewer can see that a hover and a
// press are the same speed on purpose, and so the reduced-motion behaviour can
// be asserted instead of assumed.
//
// RELATIONSHIP TO THE EXISTING HOUSE PATTERN
// src/lib/exercises/reduced-motion.ts is the established implementation of the
// preference itself (the predicate, the live hook, the legacy-Safari
// MediaQueryList fallback). It is NOT duplicated here. Where a ui-shell
// component needs the preference in JavaScript it re-exports from there — one
// implementation, one set of tests, two consumers. This file adds only what
// that module deliberately does not cover: the ui-shell duration scale and the
// CSS class contract, because the exercises stream animates through Framer
// Motion and ui-shell animates through plain CSS (see the kB note below).
//
// WHY PLAIN CSS AND NOT FRAMER MOTION
// framer-motion IS already a dependency (package.json, ^11.15.0) so "adding a
// dependency" is not the cost here — the cost is the BUNDLE. It is currently
// reachable only under the dynamic import in
// src/components/exercises/LazyExerciseList.tsx, which exists because a static
// import of the exercise stack took a route from ~115 kB to 377 kB of First
// Load JS. The primitives in src/components/ui are imported by essentially
// every route in the app; making any of them import framer-motion statically
// would pull that weight onto EVERY page, including /login, to move a progress
// bar. Every animation added by this stream is therefore a CSS keyframe or a
// CSS transition declared in globals.css: 0 kB of JavaScript, no hydration
// dependency, and it runs before React has mounted.
//
// SOURCE OF TRUTH: the values below are mirrored into src/app/globals.css as
// custom properties (--motion-fast etc.), exactly like the branding colours are
// mirrored from app.config.ts, and for the same reason — CSS cannot import from
// TypeScript. tokens.test.ts reads globals.css off disk and fails if the two
// drift, so the mirror cannot rot silently.
//
// UNITS: milliseconds, integers, everywhere (house rule 5, metric). The same
// convention the exercises stream already uses — STEP_TRANSITION_MS = 450.
// =============================================================================

export {
  prefersReducedMotion,
  usePrefersReducedMotion,
  REDUCED_MOTION_QUERY,
} from "../exercises/reduced-motion";

/**
 * The ui-shell duration scale, in milliseconds.
 *
 * Four steps, not a continuum. Anything that needs a fifth value is either
 * mis-scaled or is a bespoke animation that does not belong in a primitive.
 *
 *  - `fast`      state feedback the finger/pointer is still on: hover, press,
 *                colour changes. Must be under ~200 ms or the control feels
 *                laggy rather than responsive.
 *  - `base`      an element arriving or leaving: a toast, a disclosure.
 *  - `slow`      a value being *counted up* rather than switched: the progress
 *                fill. Long enough to read as "this much progress was earned",
 *                short enough that nobody waits for it.
 *  - `ambient`   one cycle of a looping placeholder shimmer. Loops, so it is
 *                deliberately the slowest — a fast loop is a distraction that
 *                never ends.
 */
export const MOTION_MS = {
  fast: 150,
  base: 250,
  slow: 400,
  ambient: 1200,
} as const;

export type MotionSpeed = keyof typeof MOTION_MS;

/**
 * Effective duration once the user's preference is applied, in milliseconds.
 *
 * Returns 0 — not a small number — under reduced motion. The blanket rule in
 * globals.css uses 1 ms because a `transition-duration: 0` inside a `*` rule
 * can suppress `transitionend` events that unrelated code may be waiting on;
 * this helper is for JavaScript that is choosing a duration outright, where 0
 * is the honest answer and avoids scheduling a timer for a frame nobody sees.
 */
export function motionDurationMs(speed: MotionSpeed, reduced: boolean): number {
  return reduced ? 0 : MOTION_MS[speed];
}

/**
 * The CSS classes declared in globals.css that carry ui-shell animation.
 *
 * Referenced by name from the primitives so that a rename breaks the build
 * instead of silently removing an animation, and so the e2e spec can assert the
 * computed `animation-name` of a real element rather than trusting a class
 * string it copy-pasted.
 *
 * Each of these is defined so that THE STATIC STYLE IS ALREADY CORRECT and the
 * animation only alters the *entry* into it. A keyframe block that only
 * specifies `from` with no fill-mode leaves the element at its natural style
 * before and after the run. That is what makes `animation: none` a safe
 * reduced-motion override: nothing is left half-drawn, and content is never
 * waiting on a keyframe to become readable.
 */
export const MOTION_CLASS = {
  /** Progress fill grows from zero width on mount. */
  progressFill: "ui-anim-progress-fill",
  /** Toast fades and rises into place on mount. */
  toastIn: "ui-anim-toast-in",
  /** Hover raises the element by 2 px; press returns it. */
  lift: "ui-lift",
  /** Press scales the element to 98%. */
  press: "ui-press",
  /** Looping placeholder shimmer for loading skeletons. */
  skeleton: "ui-skeleton",
} as const;

/** The CSS custom property that mirrors each duration, for the drift test. */
export const MOTION_CSS_VAR: Record<MotionSpeed, string> = {
  fast: "--motion-fast",
  base: "--motion-base",
  slow: "--motion-slow",
  ambient: "--motion-ambient",
};
