import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { BoxModelVisualizer, computeDimensions, toSides } from "./BoxModelVisualizer";

describe("computeDimensions", () => {
  it("adds padding and both borders to reach the border box", () => {
    const dims = computeDimensions({
      width: 200,
      height: 100,
      padding: [10, 10, 10, 10],
      border: 5,
      margin: [0, 0, 0, 0],
    });
    expect(dims.borderBoxWidth).toBe(230);
    expect(dims.borderBoxHeight).toBe(130);
  });

  it("adds margin only to the occupied space, never to the border box", () => {
    // The distinction students get wrong: margin is outside the element.
    const dims = computeDimensions({
      width: 100,
      height: 100,
      padding: [0, 0, 0, 0],
      border: 0,
      margin: [8, 16, 8, 16],
    });
    expect(dims.borderBoxWidth).toBe(100);
    expect(dims.totalWidth).toBe(132);
    expect(dims.totalHeight).toBe(116);
  });
});

describe("toSides", () => {
  it("expands a single number to all four sides", () => {
    expect(toSides(12, 0)).toEqual([12, 12, 12, 12]);
  });

  it("falls back when the value is missing or negative", () => {
    expect(toSides(undefined, 7)).toEqual([7, 7, 7, 7]);
    expect(toSides(-4, 7)).toEqual([7, 7, 7, 7]);
  });

  it("clamps a malformed tuple entry to zero rather than propagating NaN", () => {
    expect(toSides([1, Number.NaN, 3, -1], 0)).toEqual([1, 0, 3, 0]);
  });
});

describe("BoxModelVisualizer", () => {
  it("renders with default props and reports the total occupied space", () => {
    render(<BoxModelVisualizer element={{}} />);
    // Width:  200 content + 2x16 padding + 2x4 border = 240; + 2x24 margin = 288.
    // Height: 120 content + 2x16 padding + 2x4 border = 160; + 2x24 margin = 208.
    expect(screen.getByTestId("box-model-total")).toHaveTextContent(
      "Border box 240 x 160 px — occupies 288 x 208 px including margin.",
    );
  });

  it("exposes a labelled, named region", () => {
    render(<BoxModelVisualizer element={{}} />);
    expect(screen.getByRole("region", { name: /box model/i })).toBeInTheDocument();
  });

  it("recomputes the total when a slider changes", () => {
    render(<BoxModelVisualizer element={{ width: 100, height: 100, padding: 0, border: 0, margin: 0 }} />);
    const padding = screen.getByLabelText(/padding/i);

    fireEvent.change(padding, { target: { value: "20" } });

    expect(screen.getByTestId("box-model-total")).toHaveTextContent("140 x 140 px");
  });

  it("moves on arrow keys, so the slider is operable without a pointer", () => {
    render(<BoxModelVisualizer element={{ width: 100, height: 100, padding: 10, border: 0, margin: 0 }} />);
    const padding = screen.getByLabelText(/padding/i) as HTMLInputElement;

    fireEvent.keyDown(padding, { key: "ArrowRight" });

    // Step is 2 px, so 10 -> 12, and the total gains 4 px.
    expect(padding.value).toBe("12");
    expect(screen.getByTestId("box-model-total")).toHaveTextContent("124 x 124 px");
  });

  it("jumps to the extremes on Home and End", () => {
    render(<BoxModelVisualizer element={{ border: 4 }} />);
    const border = screen.getByLabelText(/border width/i) as HTMLInputElement;

    fireEvent.keyDown(border, { key: "End" });
    expect(border.value).toBe("24");

    fireEvent.keyDown(border, { key: "Home" });
    expect(border.value).toBe("0");
  });

  it("announces the new total into a polite live region", () => {
    render(<BoxModelVisualizer element={{ width: 100, height: 100, padding: 0, border: 0, margin: 0 }} />);

    fireEvent.change(screen.getByLabelText(/margin/i), { target: { value: "10" } });

    const live = screen.getByTestId("box-model-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Total occupied space 120 by 120 pixels.");
  });

  it("carries the unit in aria-valuetext, not only in the visible label", () => {
    render(<BoxModelVisualizer element={{ border: 4 }} />);
    expect(screen.getByLabelText(/border width/i)).toHaveAttribute("aria-valuetext", "4 px");
  });

  it("distinguishes the four layers by more than colour", () => {
    render(<BoxModelVisualizer element={{}} />);
    const legend = screen.getByTestId("box-model-legend");
    for (const cue of ["dashed", "double", "dotted", "solid"]) {
      expect(legend).toHaveTextContent(cue);
    }
  });

  it("calls onDimensionsChange on a change but not on mount", () => {
    const onDimensionsChange = vi.fn();
    render(
      <BoxModelVisualizer
        element={{ width: 100, height: 100, padding: 0, border: 0, margin: 0 }}
        onDimensionsChange={onDimensionsChange}
      />,
    );
    expect(onDimensionsChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/border width/i), { target: { value: "3" } });

    expect(onDimensionsChange).toHaveBeenCalledTimes(1);
    expect(onDimensionsChange.mock.calls[0][0]).toMatchObject({ border: 3, totalWidth: 106 });
  });

  it("hides the controls when interactive is false but keeps the diagram", () => {
    render(<BoxModelVisualizer element={{}} interactive={false} />);
    expect(screen.queryByLabelText(/padding/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("box-model-total")).toBeInTheDocument();
  });

  it("survives fully degenerate dimensions", () => {
    render(
      <BoxModelVisualizer
        element={{ width: 0, height: 0, padding: 0, border: 0, margin: 0 }}
        labels={false}
      />,
    );
    expect(screen.getByTestId("box-model-total")).toHaveTextContent("occupies 0 x 0 px");
    expect(screen.queryByTestId("box-model-legend")).not.toBeInTheDocument();
  });
});
