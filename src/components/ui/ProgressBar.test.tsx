import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { ProgressBar, clampPercent } from "./ProgressBar";

describe("clampPercent", () => {
  it("passes through in-range values, rounded to whole percent", () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(42.4)).toBe(42);
    expect(clampPercent(42.6)).toBe(43);
    expect(clampPercent(100)).toBe(100);
  });

  it("clamps below zero to 0 and above 100 to 100", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(-2000)).toBe(0);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(1e9)).toBe(100);
  });

  it("treats non-finite input as 0", () => {
    // score/max with max === 0 yields NaN; Infinity comes from the same route.
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampPercent(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("ProgressBar", () => {
  it("exposes role=progressbar with the full aria value set", () => {
    render(<ProgressBar percent={42} label="Week 2 quiz" />);

    const bar = screen.getByRole("progressbar", { name: "Week 2 quiz" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "42%");
  });

  it("clamps a negative percentage to 0 in both aria and width", () => {
    render(<ProgressBar percent={-20} label="Negative" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByTestId("progress-bar-fill")).toHaveStyle({
      width: "0%",
    });
  });

  it("clamps an over-100 percentage to 100 in both aria and width", () => {
    render(<ProgressBar percent={140} label="Over" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByTestId("progress-bar-fill")).toHaveStyle({
      width: "100%",
    });
  });

  it("never renders aria-valuenow=NaN", () => {
    render(<ProgressBar percent={Number.NaN} label="Broken input" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("falls back to a generic accessible name when unlabelled", () => {
    render(<ProgressBar percent={10} showValue={false} />);
    expect(screen.getByRole("progressbar", { name: "Progress" })).toBeVisible();
  });

  it("prefers ariaLabel over the visible label for the accessible name", () => {
    render(<ProgressBar percent={10} label="55" ariaLabel="Overall score" />);
    expect(
      screen.getByRole("progressbar", { name: "Overall score" }),
    ).toBeVisible();
  });

  it("renders the clamped value, not the raw input, in the visible readout", () => {
    render(<ProgressBar percent={140} label="Over" />);
    expect(screen.getByText("100%")).toBeVisible();
  });
});

describe("ProgressBar fill animation", () => {
  it("carries the grow-from-zero class by default", () => {
    render(<ProgressBar percent={62} label="Overall" />);
    expect(screen.getByTestId("progress-bar-fill")).toHaveClass(
      MOTION_CLASS.progressFill,
    );
  });

  it("can be opted out per call site", () => {
    // Long lists and tables pass false: a dozen bars sweeping at once is a wave.
    render(<ProgressBar percent={62} label="Overall" animateFill={false} />);
    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill).not.toHaveClass(MOTION_CLASS.progressFill);
    expect(fill).toHaveAttribute("data-animated", "false");
  });

  it("still renders the FINAL width and aria value, animated or not", () => {
    // The animation is entry-only: the static style is the truth. If this ever
    // fails, a bar somewhere is stuck at the start of its keyframe — and
    // assistive tech would still have been told the right number, which is the
    // worse kind of bug because nobody would see it in a test that only reads
    // aria.
    for (const animateFill of [true, false]) {
      const { unmount } = render(
        <ProgressBar percent={62} label="Overall" animateFill={animateFill} />,
      );
      expect(screen.getByTestId("progress-bar-fill")).toHaveStyle({
        width: "62%",
      });
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "62",
      );
      unmount();
    }
  });
});
