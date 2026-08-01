// =============================================================================
// Reduced-motion branch tests.
// -----------------------------------------------------------------------------
// jsdom does NOT implement window.matchMedia, which is precisely why the "no
// matchMedia at all" case is tested first: if that branch threw, every concept
// explainer would crash the page in a server render and in older browsers.
// =============================================================================

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREVIEW_DEBOUNCE_MS,
  REDUCED_MOTION_QUERY,
  STEP_TRANSITION_MS,
  prefersReducedMotion,
  stepTransition,
  usePrefersReducedMotion,
  type MinimalMediaQueryList,
} from "./reduced-motion";

/** A controllable matchMedia stub that can flip the preference mid-session. */
function mediaStub(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql: MinimalMediaQueryList = {
    matches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    scope: { matchMedia: vi.fn(() => mql) },
    set(next: boolean) {
      mql.matches = next;
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  // The hook reads the global; make sure a stub never leaks into another test.
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

describe("prefersReducedMotion", () => {
  it("returns false when matchMedia does not exist (jsdom, server render)", () => {
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
  });

  it("returns false when matchMedia throws", () => {
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("no");
        },
      }),
    ).toBe(false);
  });

  it("reads the reduce preference and queries the right media string", () => {
    const reduced = mediaStub(true);
    expect(prefersReducedMotion(reduced.scope)).toBe(true);
    expect(reduced.scope.matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);

    expect(prefersReducedMotion(mediaStub(false).scope)).toBe(false);
  });
});

describe("usePrefersReducedMotion", () => {
  it("stays false when the environment has no matchMedia", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reports true after mount when the user asked for reduced motion", () => {
    const stub = mediaStub(true);
    Object.assign(globalThis, { matchMedia: stub.scope.matchMedia });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("tracks a mid-session preference change", () => {
    const stub = mediaStub(false);
    Object.assign(globalThis, { matchMedia: stub.scope.matchMedia });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => stub.set(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const stub = mediaStub(true);
    Object.assign(globalThis, { matchMedia: stub.scope.matchMedia });
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(stub.listenerCount()).toBe(1);
    unmount();
    expect(stub.listenerCount()).toBe(0);
  });
});

describe("stepTransition", () => {
  it("collapses to 0 ms when reduced motion is requested", () => {
    expect(stepTransition(true).duration).toBe(0);
  });

  it("uses the declared step duration otherwise (declared in ms, passed in s)", () => {
    expect(STEP_TRANSITION_MS).toBe(450);
    expect(stepTransition(false).duration).toBeCloseTo(STEP_TRANSITION_MS / 1000);
  });

  it("keeps the preview debounce inside a human-perceptible budget", () => {
    // Above ~500 ms the preview stops feeling live; 0 would recompile per keypress.
    expect(PREVIEW_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(PREVIEW_DEBOUNCE_MS).toBeLessThanOrEqual(500);
  });
});
