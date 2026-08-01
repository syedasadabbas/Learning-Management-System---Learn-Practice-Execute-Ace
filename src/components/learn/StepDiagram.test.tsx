// =============================================================================
// STEP DIAGRAM TESTS — reduced motion must remove movement, never information.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// The e2e spec "reduced motion degrades the diagram to a static one without
// losing information" was one of the four that shipped red on 2026-07-30, and the
// CHANGELOG recorded prefers-reduced-motion as UNVERIFIED ANYWHERE. It was red
// for a navigation reason (the runner had resumed past the only step with a
// diagram — see tests/e2e/interactive-learning/learn.spec.ts), but the note about
// coverage was fair: nothing asserted the degradation itself outside Playwright.
//
// This file asserts it with `matchMedia` stubbed, following the house pattern in
// src/components/exercises/ConceptAnimation.test.tsx. jsdom has no matchMedia at
// all, so the stub is also the only way to reach the branch.
//
// WHAT REMAINS PLAYWRIGHT'S JOB: the REAL media feature. A stub proves the
// component honours what `usePrefersReducedMotion` reports; only a browser proves
// that hook reports what the operating system actually says.
// =============================================================================

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REDUCED_MOTION_QUERY, STEP_TRANSITION_MS } from "@/lib/exercises/reduced-motion";
import type { ExplainExpectation } from "@/lib/learn";

import { StepDiagram } from "./StepDiagram";

/** Install a matchMedia stub reporting the given reduced-motion preference. */
function withReducedMotion(reduce: boolean) {
  Object.assign(globalThis, {
    matchMedia: vi.fn((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY ? reduce : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  });
}

/** The seeded step-1 diagram of oop-objects-and-state, in shape if not in prose. */
const EXPLAIN: ExplainExpectation = {
  kind: "explain",
  diagramTitle: "Parallel arrays versus one object",
  frames: [
    { label: "Two arrays, one unwritten rule", caption: "Nothing enforces the alignment." },
    { label: "The rule breaks", caption: "Sorting one array desynchronises the other." },
    { label: "One object per customer", caption: "There is no second array to fall out of step." },
  ],
};

/** Frame text, whitespace-normalised — the same comparison the e2e spec makes. */
function frameTexts(): string[] {
  return screen
    .getAllByTestId("learn-diagram-frame")
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
}

afterEach(() => {
  cleanup();
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

describe("StepDiagram — reduced motion", () => {
  it("reports the preference on the element the e2e spec reads", () => {
    withReducedMotion(true);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    expect(screen.getByTestId("learn-step-diagram")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
  });

  it('reports "false", not an absent attribute, when motion is allowed', () => {
    withReducedMotion(false);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    expect(screen.getByTestId("learn-step-diagram")).toHaveAttribute(
      "data-reduced-motion",
      "false",
    );
  });

  it("keeps every frame, with identical text, in both modes", () => {
    withReducedMotion(false);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    const animated = frameTexts();
    cleanup();

    withReducedMotion(true);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    const still = frameTexts();

    expect(animated).toHaveLength(EXPLAIN.frames.length);
    expect(still).toEqual(animated);
    // The e2e spec additionally asserts more than one frame, because a one-frame
    // "diagram" would satisfy an equality check while proving nothing.
    expect(still.length).toBeGreaterThan(1);
  });

  it("drops the transition to 0 ms rather than dropping the diagram", () => {
    withReducedMotion(true);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    for (const frame of screen.getAllByTestId("learn-diagram-frame")) {
      expect((frame as HTMLElement).style.transitionDuration).toBe("0ms");
      // Nothing is faded out either: a dimmed future frame is movement-adjacent
      // styling, and with motion off every frame is at full opacity.
      expect((frame as HTMLElement).style.opacity).toBe("1");
    }
    // And it says so in words, in metric units on the animated side.
    expect(screen.getByTestId("learn-diagram-motion-state")).toHaveTextContent(/motion off/i);
  });

  it("animates over the shared duration constant when motion is allowed", () => {
    withReducedMotion(false);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    for (const frame of screen.getAllByTestId("learn-diagram-frame")) {
      expect((frame as HTMLElement).style.transitionDuration).toBe(`${STEP_TRANSITION_MS}ms`);
    }
    expect(screen.getByTestId("learn-diagram-motion-state")).toHaveTextContent(
      `${STEP_TRANSITION_MS} ms`,
    );
  });

  it("marks the current frame in text, not only by colour", () => {
    withReducedMotion(true);
    render(<StepDiagram explain={EXPLAIN} diagramId="learn-diagram-1" />);
    expect(screen.getByText("(current)")).toBeInTheDocument();
    expect(screen.getAllByTestId("learn-diagram-frame")[0]).toHaveAttribute(
      "data-current",
      "true",
    );
  });
});
