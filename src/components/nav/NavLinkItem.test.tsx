import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { NavLinkItem } from "./NavLinkItem";
import type { NavLink } from "./nav-links";

// The real useLinkStatus reads pending state from an App Router navigation
// context. Under jsdom there is none, so it is mocked here and driven by a
// module-level flag — the point of the test is the MARKUP each state produces,
// which is what the e2e spec then looks for against a real navigation.
let pending = false;

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending }),
}));

const LINK: NavLink = {
  href: "/weeks",
  label: "Course",
  glyph: "▤",
  description: "Weeks, lectures and quizzes",
};

describe("NavLinkItem", () => {
  it("renders the glyph and no pending marker at rest", () => {
    pending = false;
    render(<NavLinkItem link={LINK} active={false} />);

    const anchor = screen.getByTestId("sidebar-link");
    expect(anchor).toHaveAttribute("href", "/weeks");
    expect(anchor).toHaveAttribute("data-active", "false");
    expect(screen.getByText("▤")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-link-spinner")).toBeNull();
    expect(
      anchor.querySelector('[data-pending="true"]'),
      "nothing should claim to be pending before a click",
    ).toBeNull();
  });

  it("swaps the glyph for a spinner and marks the row pending", () => {
    // This is the ~16 ms acknowledgement. Destination pages are force-dynamic
    // and take 260-1000 ms of Neon round trips (scripts/perf-roundtrips.ts), and
    // before this component the clicked row changed in no way for that whole
    // interval.
    pending = true;
    render(<NavLinkItem link={LINK} active={false} />);

    const anchor = screen.getByTestId("sidebar-link");
    expect(anchor.querySelector('[data-pending="true"]')).not.toBeNull();
    expect(screen.getByTestId("nav-link-spinner")).toBeInTheDocument();
    expect(screen.queryByText("▤")).toBeNull();
    // Announced, because a spinner that replaces a decorative glyph is
    // invisible to a screen reader.
    expect(screen.getByText("Loading Course…")).toBeInTheDocument();
  });

  it("keeps the spinner visible under reduced motion, only unspun", () => {
    // motion-safe:animate-spin, not animate-spin. The ring has a transparent
    // top border so it still reads as a spinner when it is not rotating —
    // degrade the motion, keep the information.
    pending = true;
    render(<NavLinkItem link={LINK} active={false} />);
    const spinner = screen.getByTestId("nav-link-spinner");
    expect(spinner.className).toContain("motion-safe:animate-spin");
    expect(spinner.className).not.toMatch(/(^|\s)animate-spin(\s|$)/);
    expect(spinner.className).toContain("border-t-transparent");
  });

  it("marks the active row with aria-current, pending or not", () => {
    pending = true;
    render(<NavLinkItem link={LINK} active />);
    const anchor = screen.getByTestId("sidebar-link");
    expect(anchor).toHaveAttribute("aria-current", "page");
    expect(anchor).toHaveAttribute("data-active", "true");
  });

  it("still calls onNavigate so the mobile drawer closes on click", () => {
    // Regression guard for the extraction out of Sidebar: the drawer is closed
    // by this callback, and losing it would leave the sidebar covering the page
    // the student just navigated to on a phone.
    pending = false;
    const onNavigate = vi.fn();
    render(<NavLinkItem link={LINK} active={false} onNavigate={onNavigate} />);
    const anchor = screen.getByTestId("sidebar-link");
    // jsdom implements no navigation, so letting the anchor's default action
    // run only prints an "Error: Not implemented" to stderr in an otherwise
    // green run. The handler under test fires before the default either way.
    anchor.addEventListener("click", (event) => event.preventDefault());
    anchor.click();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
