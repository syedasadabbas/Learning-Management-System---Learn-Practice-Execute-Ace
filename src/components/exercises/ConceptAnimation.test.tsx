// =============================================================================
// Animated concept explainer tests — including the reduced-motion branch.
// -----------------------------------------------------------------------------
// framer-motion is NOT mocked here: it renders plain elements in jsdom, and the
// point of these tests is that the explainer is still complete and operable when
// motion is switched off. Mocking the animation library away would test nothing.
// =============================================================================

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConceptAnimation } from "./ConceptAnimation";
import { CONCEPT_IDS } from "@/lib/exercises";
import { REDUCED_MOTION_QUERY } from "@/lib/exercises/reduced-motion";

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

afterEach(() => {
  cleanup();
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

describe("ConceptAnimation — dispatch", () => {
  it("mounts a diagram for every registered concept", () => {
    for (const id of CONCEPT_IDS) {
      const { unmount } = render(<ConceptAnimation conceptId={id} />);
      const container = screen.getByTestId("concept-animation");
      expect(container).toHaveAttribute("data-concept-id", id);
      expect(screen.getByTestId("concept-stage")).toBeInTheDocument();
      unmount();
    }
  });

  it("explains an unknown concept id instead of throwing", () => {
    render(<ConceptAnimation conceptId="not-a-concept" />);
    expect(screen.getByTestId("concept-animation-missing")).toBeInTheDocument();
    expect(screen.getByText(/no animated explainer called/i)).toBeInTheDocument();
  });

  it("can render without its surrounding card", () => {
    render(<ConceptAnimation conceptId="box-model" bare />);
    expect(screen.queryByTestId("concept-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("concept-animation")).toBeInTheDocument();
  });
});

describe("ConceptAnimation — stepping is keyboard operable", () => {
  it("starts on step 1 with Previous disabled", () => {
    render(<ConceptAnimation conceptId="box-model" />);
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/Step 1 of 5/);
    expect(screen.getByTestId("concept-prev")).toBeDisabled();
    expect(screen.getByTestId("concept-next")).not.toBeDisabled();
  });

  it("advances, goes back, and restarts", () => {
    render(<ConceptAnimation conceptId="box-model" />);
    fireEvent.click(screen.getByTestId("concept-next"));
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/Step 2 of 5/);
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/Padding/i);

    fireEvent.click(screen.getByTestId("concept-prev"));
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/Step 1 of 5/);

    fireEvent.click(screen.getByTestId("concept-next"));
    fireEvent.click(screen.getByTestId("concept-next"));
    fireEvent.click(screen.getByTestId("concept-restart"));
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/Step 1 of 5/);
  });

  it("stops at the last step with Next disabled", () => {
    render(<ConceptAnimation conceptId="flex-axes" />);
    const next = screen.getByTestId("concept-next");
    for (let i = 0; i < 10; i += 1) if (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
    expect(next).toBeDisabled();
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/flex-direction: column/i);
  });

  it("announces the caption politely so stepping is not silent", () => {
    render(<ConceptAnimation conceptId="http-cycle" />);
    expect(screen.getByTestId("concept-caption")).toHaveAttribute("aria-live", "polite");
  });

  it("teaches the box-model arithmetic in text, not only in the picture", () => {
    render(<ConceptAnimation conceptId="box-model" />);
    fireEvent.click(screen.getByTestId("concept-next"));
    fireEvent.click(screen.getByTestId("concept-next"));
    // 200 content + 2x20 padding + 2x10 border = 260 px on screen.
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/260 px/);
  });
});

describe("ConceptAnimation — prefers-reduced-motion", () => {
  it("reports motion off and keeps the whole diagram on screen", () => {
    withReducedMotion(true);
    render(<ConceptAnimation conceptId="box-model" />);

    expect(screen.getByTestId("concept-animation")).toHaveAttribute("data-reduced-motion", "true");
    expect(screen.getByTestId("concept-motion-state")).toHaveTextContent(/Motion off/i);
    // Degrades to a static diagram — it does NOT vanish.
    expect(screen.getByTestId("concept-stage")).toBeInTheDocument();
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/Step 1 of 5/);
  });

  it("still steps through every stage with motion off", () => {
    withReducedMotion(true);
    render(<ConceptAnimation conceptId="http-cycle" />);
    fireEvent.click(screen.getByTestId("concept-next"));
    fireEvent.click(screen.getByTestId("concept-next"));
    fireEvent.click(screen.getByTestId("concept-next"));
    expect(screen.getByTestId("concept-caption")).toHaveTextContent(/status code/i);
    expect(screen.getByTestId("http-packet")).toBeInTheDocument();
  });

  it("keeps both flexbox axis labels visible with motion off", () => {
    withReducedMotion(true);
    render(<ConceptAnimation conceptId="flex-axes" />);
    // Present on the diagram itself, and restated in the caption.
    expect(screen.getAllByText(/main axis/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cross axis/i).length).toBeGreaterThan(0);
  });

  it("animates and states the duration in milliseconds when motion is allowed", () => {
    withReducedMotion(false);
    render(<ConceptAnimation conceptId="box-model" />);
    expect(screen.getByTestId("concept-animation")).toHaveAttribute("data-reduced-motion", "false");
    expect(screen.getByTestId("concept-motion-state")).toHaveTextContent(/450 ms/);
  });

  it("does not crash when the browser has no matchMedia at all", () => {
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
    render(<ConceptAnimation conceptId="flex-axes" />);
    expect(screen.getByTestId("concept-animation")).toHaveAttribute(
      "data-reduced-motion",
      "false",
    );
  });
});
