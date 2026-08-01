import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FlexboxPlayground } from "./FlexboxPlayground";

describe("FlexboxPlayground", () => {
  it("renders with default props", () => {
    render(<FlexboxPlayground />);
    expect(screen.getByRole("region", { name: /flexbox playground/i })).toBeInTheDocument();
    expect(screen.getAllByTestId("flexbox-item")).toHaveLength(5);
  });

  it("shows the generated CSS as a named region", () => {
    render(<FlexboxPlayground />);
    const code = screen.getByRole("region", { name: "Generated flexbox CSS" });
    expect(code).toHaveTextContent("display: flex;");
    expect(code).toHaveTextContent("flex-direction: row;");
  });

  it("changing a control changes both the container and the code", () => {
    render(<FlexboxPlayground />);

    fireEvent.change(screen.getByLabelText("justify-content"), {
      target: { value: "space-between" },
    });

    expect(screen.getByTestId("flexbox-container")).toHaveAttribute(
      "data-justify",
      "space-between",
    );
    expect(screen.getByTestId("flexbox-code")).toHaveTextContent(
      "justify-content: space-between;",
    );
  });

  it("moves the gap slider with arrow keys", () => {
    render(<FlexboxPlayground initialConfig={{ gap: 8 }} />);
    const gap = screen.getByLabelText(/^gap/) as HTMLInputElement;

    fireEvent.keyDown(gap, { key: "ArrowUp" });

    expect(gap.value).toBe("12");
    expect(screen.getByTestId("flexbox-container")).toHaveAttribute("data-gap", "12");
  });

  it("announces a property change politely", () => {
    render(<FlexboxPlayground />);

    fireEvent.change(screen.getByLabelText("flex-direction"), {
      target: { value: "column-reverse" },
    });

    const live = screen.getByTestId("flexbox-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("flex-direction is now column-reverse.");
  });

  it("falls back when the spec's loosely typed string values are unknown", () => {
    // justifyContent/alignItems are typed `string` in the specification, so a
    // lecture author can pass anything. An unknown value must not reach the DOM.
    render(<FlexboxPlayground initialConfig={{ justifyContent: "middle-ish" }} />);
    expect(screen.getByTestId("flexbox-container")).toHaveAttribute("data-justify", "flex-start");
  });

  it("hides the code panel when showCode is false", () => {
    render(<FlexboxPlayground showCode={false} />);
    expect(screen.queryByTestId("flexbox-code")).not.toBeInTheDocument();
  });

  it("hides controls when not interactive", () => {
    render(<FlexboxPlayground interactive={false} />);
    expect(screen.queryByLabelText(/^gap/)).not.toBeInTheDocument();
    expect(screen.getByTestId("flexbox-container")).toBeInTheDocument();
  });

  it("renders at least one item for a degenerate item count", () => {
    render(<FlexboxPlayground numItems={0} />);
    expect(screen.getAllByTestId("flexbox-item")).toHaveLength(1);
    expect(screen.getByTestId("flexbox-summary")).toHaveTextContent("1 item,");
  });

  it("caps an absurd item count rather than rendering thousands of boxes", () => {
    render(<FlexboxPlayground numItems={5000} />);
    expect(screen.getAllByTestId("flexbox-item")).toHaveLength(12);
  });
});
