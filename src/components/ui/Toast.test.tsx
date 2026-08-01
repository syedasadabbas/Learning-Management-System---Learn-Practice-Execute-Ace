import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { MOTION_CLASS } from "@/lib/motion/tokens";
import { Toast } from "./Toast";

describe("Toast entrance", () => {
  it("carries the entrance class", () => {
    render(<Toast message="Saved" />);
    expect(screen.getByTestId("toast")).toHaveClass(MOTION_CLASS.toastIn);
  });

  it("announces through the live region regardless of the animation", () => {
    // The keyframe is entry-only and has no fill-mode, so the node is in the
    // DOM with its final text from the first render — which is what the live
    // region announcement is driven by. A screen-reader user is not waiting
    // 250 ms for the message.
    render(<Toast tone="error" message="Upload failed" />);
    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Upload failed");
    expect(toast).toHaveAttribute("aria-live", "assertive");
  });
});

describe("Toast auto-dismiss", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("measures its lifetime from mount, not from the end of the animation", () => {
    // Regression guard for the obvious wrong way to build the entrance: delay
    // the mount, or start the timer on animationend, and every toast is on
    // screen for less time than the caller asked for.
    const onDismiss = vi.fn();
    render(<Toast message="Saved" autoDismissMs={6000} onDismiss={onDismiss} />);

    act(() => void vi.advanceTimersByTime(5999));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
