import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GridPlayground } from "./GridPlayground";

describe("GridPlayground", () => {
  it("renders with default props", () => {
    render(<GridPlayground />);
    expect(screen.getByRole("region", { name: /css grid playground/i })).toBeInTheDocument();
    expect(screen.getByTestId("grid-container")).toHaveAttribute("data-columns", "3");
  });

  it("generates the repeat() shorthand a student would write", () => {
    render(<GridPlayground />);
    expect(screen.getByRole("region", { name: "Generated grid CSS" })).toHaveTextContent(
      "grid-template-columns: repeat(3, 1fr);",
    );
  });

  it("changing the column count changes the container and the code", () => {
    render(<GridPlayground />);

    fireEvent.change(screen.getByLabelText(/^Columns/), { target: { value: "5" } });

    expect(screen.getByTestId("grid-container")).toHaveAttribute("data-columns", "5");
    expect(screen.getByTestId("grid-code")).toHaveTextContent("repeat(5, 1fr)");
  });

  it("moves the gap slider with arrow keys", () => {
    render(<GridPlayground initialConfig={{ gap: 8 }} />);
    const gap = screen.getByLabelText(/^gap/) as HTMLInputElement;

    fireEvent.keyDown(gap, { key: "ArrowRight" });

    expect(gap.value).toBe("12");
    expect(screen.getByTestId("grid-container")).toHaveAttribute("data-gap", "12");
  });

  it("caps a span at the number of tracks so the grid never overflows", () => {
    render(<GridPlayground initialConfig={{ columns: 2, columnSpan: 6 }} />);
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("spans 2 columns");
  });

  it("names the spanned item in text, not only by a heavier border", () => {
    render(<GridPlayground initialConfig={{ featuredItem: 1, columnSpan: 2, rowSpan: 1 }} />);
    expect(screen.getByTestId("grid-container")).toHaveTextContent("spans 2x1");
  });

  it("announces a track change politely", () => {
    render(<GridPlayground />);

    fireEvent.change(screen.getByLabelText(/^Rows/), { target: { value: "4" } });

    const live = screen.getByTestId("grid-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("4 rows.");
  });

  it("survives a 1x1 grid", () => {
    render(<GridPlayground initialConfig={{ columns: 1, rows: 1, columnSpan: 1, rowSpan: 1 }} />);
    expect(screen.getAllByTestId("grid-item")).toHaveLength(1);
  });

  it("clamps nonsense configuration instead of trusting it", () => {
    render(<GridPlayground initialConfig={{ columns: 99, rows: -3, gap: Number.NaN }} />);
    const container = screen.getByTestId("grid-container");
    expect(container).toHaveAttribute("data-columns", "6");
    expect(container).toHaveAttribute("data-rows", "1");
    expect(container).toHaveAttribute("data-gap", "8");
  });

  it("hides controls when not interactive", () => {
    render(<GridPlayground interactive={false} />);
    expect(screen.queryByLabelText(/^Columns/)).not.toBeInTheDocument();
  });
});
