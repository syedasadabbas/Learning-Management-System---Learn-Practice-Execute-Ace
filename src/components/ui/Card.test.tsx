import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MOTION_CLASS } from "@/lib/motion/tokens";
import { Card } from "./Card";

describe("Card hover affordance", () => {
  it("adds the lift only when the card is itself a target", () => {
    // A non-interactive card that lifted under the pointer would promise a
    // click that does nothing — the reason `interactive` is opt-in.
    render(<Card>plain</Card>);
    expect(screen.getByTestId("card")).not.toHaveClass(MOTION_CLASS.lift);
    expect(screen.getByTestId("card")).not.toHaveAttribute("data-interactive");
  });

  it("marks an interactive card and gives it the lift class", () => {
    render(<Card interactive>clickable</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass(MOTION_CLASS.lift);
    expect(card).toHaveAttribute("data-interactive", "true");
  });

  it("keeps the focus ring, which is not motion and must survive reduce", () => {
    // globals.css turns the transform off under prefers-reduced-motion. The
    // keyboard affordance is a separate, non-animated channel and has to stay:
    // reduced motion must not cost a keyboard user their only hover equivalent.
    render(<Card interactive>clickable</Card>);
    expect(screen.getByTestId("card").className).toContain("focus-within:outline-2");
  });

  it("still renders header, body and footer content unchanged", () => {
    // Guard against the class-string edit above having eaten a slot.
    render(
      <Card interactive title="Week 2" subtitle="3 lectures" footer="Due Friday">
        body
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Week 2" })).toBeVisible();
    expect(screen.getByText("3 lectures")).toBeVisible();
    expect(screen.getByText("body")).toBeVisible();
    expect(screen.getByText("Due Friday")).toBeVisible();
  });
});
