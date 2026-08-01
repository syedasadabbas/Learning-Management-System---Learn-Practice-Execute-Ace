import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import type { RevealApi } from "@/lib/presentations/reveal-api";
import type { Slide, SlideDeck } from "@/lib/presentations/types";

import { RevealPresentation } from "./RevealPresentation";

// Minimal engine stand-in. The wrapper's own behaviour (chrome, clamping,
// controlled/uncontrolled) is what is under test here; RevealDeck.test.tsx
// covers the lifecycle.
function fakeApi(): RevealApi {
  return {
    initialize: () => Promise.resolve(undefined as unknown as RevealApi),
    destroy: () => undefined,
    slide: () => undefined,
    sync: () => undefined,
    isReady: () => true,
    getIndices: () => ({ h: 0, v: 0, f: 0 }),
    on: () => undefined,
    off: () => undefined,
  } as unknown as RevealApi;
}

const slides: Slide[] = [
  { id: "a", slideNumber: 1, type: "title", title: "Alpha" },
  { id: "b", slideNumber: 2, type: "title", title: "Beta" },
  { id: "c", slideNumber: 3, type: "title", title: "Gamma" },
];

function deckOf(list: Slide[]): SlideDeck {
  return {
    slides: list,
    metadata: { theme: "lms", transition: "slide", width: 1280, height: 720 },
  };
}

describe("RevealPresentation", () => {
  it("labels itself as a presentation region", () => {
    render(<RevealPresentation deck={deckOf(slides)} title="Week 1" createReveal={fakeApi} />);
    expect(
      screen.getByRole("region", { name: "Week 1" }),
    ).toHaveAttribute("aria-roledescription", "presentation");
  });

  it("advances the counter when uncontrolled", async () => {
    const onSlideChange = vi.fn();
    render(
      <RevealPresentation
        deck={deckOf(slides)}
        onSlideChange={onSlideChange}
        createReveal={fakeApi}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("slide-counter")).toHaveTextContent("1 / 3"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));

    expect(onSlideChange).toHaveBeenCalledWith(1, slides[1]);
    await waitFor(() =>
      expect(screen.getByTestId("slide-counter")).toHaveTextContent("2 / 3"),
    );
  });

  it("does not move itself when controlled", async () => {
    const onSlideChange = vi.fn();
    render(
      <RevealPresentation
        deck={deckOf(slides)}
        currentIndex={0}
        onSlideChange={onSlideChange}
        createReveal={fakeApi}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Next slide" }));

    // The parent is told, and the deck stays where the parent put it.
    expect(onSlideChange).toHaveBeenCalledWith(1, slides[1]);
    expect(screen.getByTestId("slide-counter")).toHaveTextContent("1 / 3");
  });

  it("disables previous on the first slide and next on the last", async () => {
    const { rerender } = render(
      <RevealPresentation deck={deckOf(slides)} currentIndex={0} createReveal={fakeApi} />,
    );
    expect(await screen.findByRole("button", { name: "Previous slide" })).toBeDisabled();

    rerender(
      <RevealPresentation deck={deckOf(slides)} currentIndex={2} createReveal={fakeApi} />,
    );
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
  });

  it("clamps an out-of-range initial index instead of rendering nothing", async () => {
    render(
      <RevealPresentation
        deck={deckOf(slides)}
        initialSlideIndex={99}
        createReveal={fakeApi}
      />,
    );
    expect(await screen.findByTestId("slide-counter")).toHaveTextContent("3 / 3");
  });

  it("hides the chrome for an empty deck rather than showing 1 / 0", () => {
    render(<RevealPresentation deck={deckOf([])} createReveal={fakeApi} />);
    expect(screen.queryByTestId("slide-counter")).not.toBeInTheDocument();
  });

  it("renders a single-slide deck with both arrows disabled", async () => {
    render(
      <RevealPresentation deck={deckOf([slides[0]])} createReveal={fakeApi} />,
    );
    expect(await screen.findByTestId("slide-counter")).toHaveTextContent("1 / 1");
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  });

  it("offers a fullscreen toggle that reports its state", async () => {
    render(<RevealPresentation deck={deckOf(slides)} createReveal={fakeApi} />);
    const button = await screen.findByRole("button", { name: "Fullscreen" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    // jsdom implements no Fullscreen API; the assertion is that clicking is
    // safe, because the handler must not throw when requestFullscreen is absent.
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("shows no chrome in readOnly mode", async () => {
    render(<RevealPresentation deck={deckOf(slides)} readOnly createReveal={fakeApi} />);
    expect(await screen.findByTestId("reveal-preview")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next slide" })).not.toBeInTheDocument();
  });
});
