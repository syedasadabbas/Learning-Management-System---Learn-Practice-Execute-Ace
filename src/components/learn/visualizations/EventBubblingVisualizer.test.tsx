import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { EventBubblingVisualizer } from "./EventBubblingVisualizer";

/**
 * The log reveals one entry every 420 ms. Fake timers keep the suite fast and,
 * more importantly, deterministic — a waitFor on a real 2.5 s reveal is a flake
 * waiting to happen on a loaded CI box.
 */
function revealAll() {
  // One act() per reveal: the effect schedules the NEXT timeout only after
  // React has flushed the previous state update, so a single large advance
  // would fire exactly one step.
  for (let i = 0; i < 12; i += 1) {
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }
}

describe("EventBubblingVisualizer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders with default props and an empty log", () => {
    render(<EventBubblingVisualizer />);
    expect(
      screen.getByRole("region", { name: /event capture and bubbling/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("event-bubbling-empty")).toBeInTheDocument();
  });

  it("records capture downwards then bubble upwards from a real click", () => {
    render(<EventBubblingVisualizer />);

    fireEvent.click(screen.getByTestId("event-bubbling-target"));
    revealAll();

    const entries = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent?.replace(/^\d+\.\s*/, ""));
    expect(entries).toEqual([
      "grandparent — capture phase",
      "parent — capture phase",
      "child — capture phase",
      "child — target phase",
      "parent — bubble phase",
      "grandparent — bubble phase",
    ]);
  });

  it("is operable from the keyboard, because the target is a real button", () => {
    render(<EventBubblingVisualizer />);
    const target = screen.getByTestId("event-bubbling-target");
    expect(target.tagName).toBe("BUTTON");

    // Enter on a focused button dispatches a click; assert the propagation ran.
    target.focus();
    fireEvent.click(target, { detail: 0 });
    revealAll();

    expect(screen.getByTestId("event-bubbling-log")).toHaveTextContent("grandparent — capture");
  });

  it("stopPropagation genuinely cuts the sequence short", () => {
    render(<EventBubblingVisualizer />);

    fireEvent.change(screen.getByLabelText(/stopPropagation/i), {
      target: { value: "parent" },
    });
    fireEvent.click(screen.getByTestId("event-bubbling-target"));
    revealAll();

    const entries = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toContain("parent — capture phase");
  });

  it("announces the whole sequence politely", () => {
    render(<EventBubblingVisualizer />);

    fireEvent.click(screen.getByTestId("event-bubbling-target"));

    const live = screen.getByTestId("event-bubbling-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("6 handlers ran");
  });

  it("marks a layer that ran with words, not only a border style", () => {
    render(<EventBubblingVisualizer />);

    fireEvent.click(screen.getByTestId("event-bubbling-target"));
    revealAll();

    const layers = screen.getAllByTestId("event-bubbling-layer");
    expect(layers[0]).toHaveAttribute("data-active", "true");
    expect(layers[0]).toHaveTextContent("handler ran");
  });

  it("clears the log", () => {
    render(<EventBubblingVisualizer />);
    fireEvent.click(screen.getByTestId("event-bubbling-target"));
    revealAll();

    fireEvent.click(screen.getByRole("button", { name: "Clear log" }));

    expect(screen.getByTestId("event-bubbling-empty")).toBeInTheDocument();
  });

  it("falls back to the default nesting when given too few layers to demonstrate anything", () => {
    render(<EventBubblingVisualizer layers={["only"]} />);
    expect(screen.getAllByTestId("event-bubbling-layer")).toHaveLength(2);
  });

  it("accepts a custom layer set", () => {
    render(<EventBubblingVisualizer layers={["body", "form", "button"]} />);
    expect(screen.getByTestId("event-bubbling-target")).toHaveTextContent("Click the button");
  });
});
