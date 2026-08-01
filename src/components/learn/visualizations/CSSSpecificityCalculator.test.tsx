import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CSSSpecificityCalculator } from "./CSSSpecificityCalculator";

describe("CSSSpecificityCalculator", () => {
  it("renders with default props and picks a winner", () => {
    render(<CSSSpecificityCalculator />);
    expect(screen.getByRole("region", { name: /css specificity calculator/i })).toBeInTheDocument();
    expect(screen.getByTestId("specificity-verdict")).toHaveTextContent("#page-title");
  });

  it("recomputes when a selector is typed", () => {
    render(<CSSSpecificityCalculator initialSelectors={["p"]} />);

    fireEvent.change(screen.getByLabelText("Selector 1"), {
      target: { value: "#main p.lead" },
    });

    expect(screen.getAllByTestId("specificity-value")[0]).toHaveTextContent("1,1,1");
  });

  it("spells the triple out in the accessible name, since '1,1,1' means nothing aloud", () => {
    render(<CSSSpecificityCalculator initialSelectors={["#main p.lead"]} />);
    expect(
      screen.getByLabelText("Selector 1 specificity: 1 ids, 1 classes, 1 types"),
    ).toBeInTheDocument();
  });

  it("marks the winner in text as well as with a border", () => {
    render(<CSSSpecificityCalculator initialSelectors={["p", "#id"]} />);
    const rows = screen.getAllByTestId("specificity-row");
    expect(rows[1]).toHaveAttribute("data-winner", "true");
    expect(rows[1]).toHaveTextContent("wins");
  });

  it("explains a tie by source order rather than leaving it unexplained", () => {
    render(<CSSSpecificityCalculator initialSelectors={[".a", ".b"]} />);
    expect(screen.getByTestId("specificity-verdict")).toHaveTextContent(
      "source order decides and the later rule wins",
    );
  });

  it("flags !important as a separate cascade origin", () => {
    render(<CSSSpecificityCalculator initialSelectors={["p !important"]} />);
    expect(screen.getByTestId("specificity-important")).toBeInTheDocument();
  });

  it("adds and removes rows, and never drops below one", () => {
    render(<CSSSpecificityCalculator initialSelectors={["p"]} />);
    expect(screen.getByRole("button", { name: "Remove selector 1" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add selector" }));
    expect(screen.getAllByTestId("specificity-row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove selector 2" }));
    expect(screen.getAllByTestId("specificity-row")).toHaveLength(1);
  });

  it("stops adding rows at the cap", () => {
    render(<CSSSpecificityCalculator initialSelectors={["p"]} maxSelectors={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Add selector" }));
    expect(screen.getByRole("button", { name: "Add selector" })).toBeDisabled();
  });

  it("announces the recomputed triple politely", () => {
    render(<CSSSpecificityCalculator initialSelectors={["p"]} />);

    fireEvent.change(screen.getByLabelText("Selector 1"), { target: { value: "#a" } });

    const live = screen.getByTestId("specificity-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("#a has specificity 1,0,0.");
  });

  it("renders one usable row when handed an empty selector list", () => {
    render(<CSSSpecificityCalculator initialSelectors={[]} />);
    expect(screen.getAllByTestId("specificity-row")).toHaveLength(1);
    expect(screen.getByTestId("specificity-verdict")).toHaveTextContent(
      "Enter a selector to see its specificity.",
    );
  });

  it("warns when part of the input was not understood", () => {
    render(<CSSSpecificityCalculator initialSelectors={["div %%"]} />);
    expect(screen.getByTestId("specificity-unparsed")).toBeInTheDocument();
  });
});
