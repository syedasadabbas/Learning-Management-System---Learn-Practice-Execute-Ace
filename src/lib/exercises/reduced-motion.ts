"use client";

// =============================================================================
// REDUCED MOTION — the accessibility switch for every concept explainer
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// The rule this stream follows: reduced motion must degrade an explainer to a
// STATIC DIAGRAM, never remove it. The information in "content -> padding ->
// border -> margin" is the diagram, not the movement; a user who asks for less
// motion is asking for a calmer page, not a less complete lesson. So every
// explainer keeps all of its labels and layers, drops the transition to 0 ms,
// and relies on the step buttons for pacing.
//
// The pure predicate is separated from the hook so the branch can be unit-tested
// without rendering anything (jsdom provides no `matchMedia` at all, which is
// itself a case that must not crash — see reduced-motion.test.ts).
// =============================================================================

import { useEffect, useState } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Minimal shape we need from a MediaQueryList; avoids a DOM-lib dependency. */
export interface MinimalMediaQueryList {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  /** Safari < 14 fallback. */
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export interface MatchMediaCapable {
  matchMedia?: (query: string) => MinimalMediaQueryList;
}

/**
 * Does this environment ask for reduced motion?
 *
 * Returns false when there is no `matchMedia` (server render, jsdom, very old
 * browser). False is the correct default: it renders the animated version, which
 * the hook then corrects on mount if the real preference says otherwise. The
 * opposite default would flash a static diagram for every user.
 */
export function prefersReducedMotion(scope?: MatchMediaCapable | null): boolean {
  const target = scope ?? (typeof globalThis === "undefined" ? null : (globalThis as MatchMediaCapable));
  if (!target || typeof target.matchMedia !== "function") return false;
  try {
    return Boolean(target.matchMedia(REDUCED_MOTION_QUERY).matches);
  } catch {
    // A stubbed matchMedia that throws must not break the lecture page.
    return false;
  }
}

/** Subscribe/unsubscribe across both the modern and the legacy MediaQueryList API. */
function subscribe(mql: MinimalMediaQueryList, listener: () => void): () => void {
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener?.("change", listener);
  }
  if (typeof mql.addListener === "function") {
    mql.addListener(listener);
    return () => mql.removeListener?.(listener);
  }
  return () => {};
}

/**
 * Live reduced-motion preference. Starts `false` so server and client markup
 * match on the first paint, then corrects itself in an effect and keeps tracking
 * the preference if the user changes it mid-session.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const scope = globalThis as MatchMediaCapable;
    if (typeof scope.matchMedia !== "function") return;

    let mql: MinimalMediaQueryList;
    try {
      mql = scope.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      return;
    }

    setReduced(Boolean(mql.matches));
    return subscribe(mql, () => setReduced(Boolean(mql.matches)));
  }, []);

  return reduced;
}

// ---------------------------------------------------------------------------
// Timing (metric: milliseconds everywhere, per house rule 5)
// ---------------------------------------------------------------------------

/** Duration of one explainer step transition, in milliseconds. */
export const STEP_TRANSITION_MS = 450;
/** Debounce between an edit and the preview reload, in milliseconds. */
export const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Framer Motion transition for an explainer, honouring the preference.
 * 0 ms is used rather than omitting the transition so layout still settles in one
 * frame instead of being animated by Framer's spring default.
 */
export function stepTransition(reduced: boolean): { duration: number; ease: "easeInOut" } {
  return { duration: reduced ? 0 : STEP_TRANSITION_MS / 1000, ease: "easeInOut" };
}
