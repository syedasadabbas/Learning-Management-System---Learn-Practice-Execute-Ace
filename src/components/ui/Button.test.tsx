import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, buttonClasses } from "./Button";

describe("Button", () => {
  it("calls onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("blocks onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Go" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("blocks onClick while loading and reports aria-busy", () => {
    // A loading button that still submits is how a double-POST happens.
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("records variant and size for styling assertions", () => {
    render(
      <Button variant="danger" size="lg">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-variant", "danger");
    expect(button).toHaveAttribute("data-size", "lg");
  });

  it("lets a caller className win over the variant default", () => {
    render(<Button className="bg-accent">Go</Button>);
    // twMerge drops the conflicting base utility. Compare whole tokens: the
    // hover:/active: variants legitimately still mention bg-brand.
    const tokens = screen.getByRole("button").className.split(/\s+/);
    expect(tokens).toContain("bg-accent");
    expect(tokens).not.toContain("bg-brand");
  });

  it("buttonClasses shares the button look with link elements", () => {
    // Links must be <a>, but must not fork the styles.
    const linkClasses = buttonClasses("primary", "lg");
    render(<Button size="lg">Go</Button>);
    const buttonClassName = screen.getByRole("button").className;

    for (const token of linkClasses.split(" ")) {
      expect(buttonClassName).toContain(token);
    }
  });
});
