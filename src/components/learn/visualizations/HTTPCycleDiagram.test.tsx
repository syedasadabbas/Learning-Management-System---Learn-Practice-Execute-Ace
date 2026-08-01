import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_HTTP_STAGES, HTTPCycleDiagram } from "./HTTPCycleDiagram";

describe("HTTPCycleDiagram", () => {
  it("renders every stage with default props and opens on the first", () => {
    render(<HTTPCycleDiagram />);
    expect(screen.getByRole("region", { name: /http request cycle/i })).toBeInTheDocument();
    expect(screen.getAllByTestId("http-cycle-stage")).toHaveLength(DEFAULT_HTTP_STAGES.length);
    expect(screen.getByTestId("http-cycle-detail")).toHaveTextContent("You enter a URL");
  });

  it("marks the current stage with aria-current and the word 'current'", () => {
    // Belt and braces on purpose: the border weight alone is a colour cue.
    render(<HTTPCycleDiagram />);
    const first = screen.getAllByTestId("http-cycle-stage")[0];
    expect(first).toHaveAttribute("aria-current", "step");
    expect(first).toHaveTextContent("current");
  });

  it("advances with the Next button and updates the inspectable wire detail", () => {
    render(<HTTPCycleDiagram />);

    fireEvent.click(screen.getByRole("button", { name: /next stage/i }));

    expect(screen.getByTestId("http-cycle-detail")).toHaveTextContent(
      "DNS turns the name into an address",
    );
    expect(screen.getByTestId("http-cycle-wire")).toHaveTextContent("93.184.216.34");
  });

  it("lets any stage be selected directly, so nothing is gated behind a sequence", () => {
    render(<HTTPCycleDiagram />);

    fireEvent.click(screen.getByRole("button", { name: /Server.*response comes back/i }));

    expect(screen.getByTestId("http-cycle-detail")).toHaveTextContent("200 fine");
  });

  it("every stage is a real button, so the whole diagram is keyboard operable", () => {
    render(<HTTPCycleDiagram />);
    for (const stage of screen.getAllByTestId("http-cycle-stage")) {
      expect(stage.tagName).toBe("BUTTON");
      expect(stage).toHaveAttribute("type", "button");
    }
  });

  it("announces the stage change politely, detail included", () => {
    render(<HTTPCycleDiagram />);

    fireEvent.click(screen.getByRole("button", { name: /next stage/i }));

    const live = screen.getByTestId("http-cycle-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Stage 2 of 7");
  });

  it("disables Previous at the start and Next at the end", () => {
    render(<HTTPCycleDiagram initialStage={0} />);
    expect(screen.getByRole("button", { name: /previous stage/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /renders it/i }));
    expect(screen.getByRole("button", { name: /next stage/i })).toBeDisabled();
  });

  it("exposes autoplay as a toggle button with aria-pressed", () => {
    // jsdom reports no reduced-motion preference, so the control is present.
    render(<HTTPCycleDiagram />);
    const play = screen.getByRole("button", { name: /^Play/ });
    expect(play).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(play);

    expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces autoplay with an explanation when it is not allowed", () => {
    render(<HTTPCycleDiagram allowAutoplay={false} />);
    expect(screen.queryByRole("button", { name: /^Play/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("http-cycle-motion-note")).toBeInTheDocument();
  });

  it("clamps an out-of-range initial stage instead of rendering undefined", () => {
    render(<HTTPCycleDiagram initialStage={99} />);
    expect(screen.getByTestId("http-cycle-detail")).toHaveTextContent("browser renders it");
  });

  it("renders an explanation rather than crashing on an empty stage list", () => {
    render(<HTTPCycleDiagram stages={[]} />);
    expect(screen.getByTestId("http-cycle-empty")).toBeInTheDocument();
  });
});
