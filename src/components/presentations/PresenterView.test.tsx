import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import type { Slide, SlideDeck } from "@/lib/presentations/types";

import { PresenterView, formatElapsed } from "./PresenterView";

const slides: Slide[] = [
  {
    id: "a",
    slideNumber: 1,
    type: "title",
    title: "Alpha",
    speakerNotes: "Welcome the cohort",
  },
  { id: "b", slideNumber: 2, type: "title", title: "Beta" },
];

const deck: SlideDeck = {
  slides,
  metadata: { theme: "lms", transition: "slide", width: 1280, height: 720 },
};

describe("formatElapsed", () => {
  it("formats under an hour as M:SS", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_000)).toBe("1:05");
  });

  it("formats over an hour as H:MM:SS", () => {
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  it("treats a negative interval as zero rather than printing -1:-1", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

describe("PresenterView", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the current slide's notes and the next slide's label", () => {
    render(<PresenterView deck={deck} currentIndex={0} onNavigate={vi.fn()} />);

    expect(screen.getByTestId("presenter-notes")).toHaveTextContent(
      "Welcome the cohort",
    );
    expect(screen.getByTestId("presenter-next")).toHaveTextContent("Beta");
    expect(screen.getByTestId("presenter-position")).toHaveTextContent("1 / 2");
  });

  it("says so when a slide has no notes and when the deck ends", () => {
    render(<PresenterView deck={deck} currentIndex={1} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("presenter-notes")).toHaveTextContent(
      "No notes for this slide.",
    );
    expect(screen.getByTestId("presenter-next")).toHaveTextContent(
      "End of presentation",
    );
  });

  it("navigates through the callback rather than owning the index", () => {
    const onNavigate = vi.fn();
    render(<PresenterView deck={deck} currentIndex={0} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(onNavigate).toHaveBeenCalledWith(1);
    // Still on slide 1 — the parent decides.
    expect(screen.getByTestId("presenter-position")).toHaveTextContent("1 / 2");
  });

  it("advances the elapsed timer from an injected clock", () => {
    let clock = 1_000_000;
    render(
      <PresenterView
        deck={deck}
        currentIndex={0}
        onNavigate={vi.fn()}
        now={() => clock}
      />,
    );

    expect(screen.getByTestId("presenter-elapsed")).toHaveTextContent("0:00");

    clock += 90_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId("presenter-elapsed")).toHaveTextContent("1:30");
  });

  it("stops accumulating when paused", () => {
    let clock = 0;
    render(
      <PresenterView
        deck={deck}
        currentIndex={0}
        onNavigate={vi.fn()}
        now={() => clock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    clock += 60_000;
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByTestId("presenter-elapsed")).toHaveTextContent("0:00");
  });

  it("renders an empty deck without crashing", () => {
    render(
      <PresenterView
        deck={{ ...deck, slides: [] }}
        currentIndex={0}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByTestId("presenter-position")).toHaveTextContent(
      "No slides",
    );
  });
});
