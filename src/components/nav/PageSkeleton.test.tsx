import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MOTION_CLASS } from "@/lib/motion/tokens";
import { PageSkeleton } from "./PageSkeleton";

// usePathname needs an App Router context that jsdom does not provide. The
// component also accepts pathnameOverride, which is what the shape assertions
// below use; this mock only has to keep the live call from throwing.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("PageSkeleton", () => {
  it("announces itself as busy rather than rendering silent grey boxes", () => {
    // A screen reader gets nothing from placeholder rectangles. Before this
    // change there was no loading state at all, so there was also nothing to
    // announce; the skeleton must not repeat that omission in a new form.
    render(<PageSkeleton pathnameOverride="/weeks" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("draws the shape that matches the destination, not the current page", () => {
    // The mocked usePathname says /dashboard. Passing /leaderboard proves the
    // shape follows the argument, which in the app is the URL the router has
    // already committed to for the pending navigation.
    render(<PageSkeleton pathnameOverride="/leaderboard" />);
    expect(screen.getByTestId("page-skeleton")).toHaveAttribute(
      "data-shape",
      "table",
    );
  });

  it("uses the mocked pathname when no override is given", () => {
    render(<PageSkeleton />);
    expect(screen.getByTestId("page-skeleton")).toHaveAttribute(
      "data-shape",
      "dashboard",
    );
  });

  it("falls back to prose for a route with no entry in the table", () => {
    render(<PageSkeleton pathnameOverride="/not/a/real/route" />);
    expect(screen.getByTestId("page-skeleton")).toHaveAttribute(
      "data-shape",
      "prose",
    );
  });

  it("draws its bars with the ONE shared shimmer, not a second one of its own", () => {
    // THE DRIFT THIS TEST EXISTS TO CATCH. This component and
    // src/components/ui/Skeleton.tsx were written in parallel and briefly shipped
    // two different loading treatments on one branch: `motion-safe:animate-pulse`
    // (an opacity blink) here, and the `ui-skeleton` gradient sweep there. Both
    // were correct in isolation, which is exactly why nothing failed. So the
    // assertion is not "it animates" but "it animates the SAME WAY": every bar
    // must be a SkeletonBar carrying MOTION_CLASS.skeleton, and the old variant
    // must be gone from the tree entirely.
    const { container } = render(<PageSkeleton pathnameOverride="/weeks" />);

    const bars = container.querySelectorAll('[data-testid="skeleton-bar"]');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar).toHaveClass(MOTION_CLASS.skeleton);
    }
    expect(container.innerHTML).not.toContain("animate-pulse");

    // Four week cards, per the shape table — the shapes are still this file's job.
    expect(container.querySelectorAll(".border-line").length).toBeGreaterThan(0);
  });

  it("keeps the shimmer off the wrappers, so borders and cards do not pulse", () => {
    // The old implementation animated one container that held the cards, which
    // meant their 1 px borders blinked too. Moving the animation onto the bars is
    // what the shared primitive buys; asserting it keeps a future refactor from
    // quietly putting it back on a wrapper.
    const { container } = render(<PageSkeleton pathnameOverride="/weeks" />);
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toHaveClass(MOTION_CLASS.skeleton);
  });

  it("still renders every bar under reduced motion — the CSS stops it, not React", () => {
    // The house rule from src/lib/exercises/reduced-motion.ts: reduced motion
    // degrades the presentation and never removes the information. There is
    // therefore NO conditional rendering here to test — the bars are
    // unconditional, and globals.css turns `ui-skeleton` into `animation: none`
    // plus `background-image: none` under prefers-reduced-motion (asserted for
    // real, in a browser, by tests/e2e/ui-shell/navigation.spec.ts; jsdom
    // evaluates no media queries and could not prove it here).
    //
    // What this test CAN prove is the half that a media query cannot rescue: that
    // a user asking for stillness is not handed the frozen page back.
    const { container } = render(<PageSkeleton pathnameOverride="/weeks" />);
    expect(
      container.querySelectorAll('[data-testid="skeleton-bar"]').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("renders the number of placeholder units the shape asks for", () => {
    const { container } = render(<PageSkeleton pathnameOverride="/leaderboard" />);
    // 8 rows for the table shape; the divide-y wrapper holds exactly those.
    const rows = container.querySelectorAll(".divide-y > div");
    expect(rows.length).toBe(8);
  });
});
