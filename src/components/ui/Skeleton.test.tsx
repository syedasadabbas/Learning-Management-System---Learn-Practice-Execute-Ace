import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MOTION_CLASS } from "@/lib/motion/tokens";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("announces itself as busy so the wait is not silent", () => {
    // This is the part that must survive prefers-reduced-motion: with the sweep
    // stopped, role+aria-busy is the ONLY remaining signal that content is
    // coming rather than missing.
    render(<Skeleton label="Loading your weeks" />);

    const root = screen.getByRole("status", { name: "Loading your weeks" });
    expect(root).toHaveAttribute("aria-busy", "true");
  });

  it("carries the shimmer class the stylesheet animates", () => {
    render(<Skeleton />);
    expect(screen.getByTestId("skeleton-bar")).toHaveClass(
      MOTION_CLASS.skeleton,
    );
  });

  it("hides the bars themselves from assistive tech", () => {
    // Five grey rectangles announced individually is noise; the one live region
    // on the wrapper says everything there is to say.
    render(<Skeleton lines={3} />);
    for (const bar of screen.getAllByTestId("skeleton-bar")) {
      expect(bar).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("renders one bar per requested text line", () => {
    render(<Skeleton lines={4} />);
    expect(screen.getAllByTestId("skeleton-bar")).toHaveLength(4);
    expect(screen.getByTestId("skeleton")).toHaveAttribute("data-lines", "4");
  });

  it("shortens only the last line of a multi-line block", () => {
    render(<Skeleton lines={3} />);
    const bars = screen.getAllByTestId("skeleton-bar");
    expect(bars[0]).not.toHaveClass("w-3/5");
    expect(bars[1]).not.toHaveClass("w-3/5");
    expect(bars[2]).toHaveClass("w-3/5");
  });

  it("never collapses to zero bars on a bad line count", () => {
    // `lines={items.length}` before the fetch resolves is 0, and a container
    // with no children would collapse the layout the skeleton exists to hold.
    for (const lines of [0, -3, Number.NaN]) {
      const { unmount } = render(<Skeleton lines={lines} />);
      expect(screen.getAllByTestId("skeleton-bar")).toHaveLength(1);
      unmount();
    }
  });

  it("ignores lines for non-text shapes", () => {
    render(<Skeleton shape="circle" lines={5} />);
    expect(screen.getAllByTestId("skeleton-bar")).toHaveLength(1);
    expect(screen.getByTestId("skeleton")).toHaveAttribute(
      "data-shape",
      "circle",
    );
  });
});
