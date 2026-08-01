import { readdirSync } from "node:fs";
import { join } from "node:path";

import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  NAV_LINKS,
  ROLES,
  ROLE_LABEL,
  isActiveLink,
  navLinksFor,
  type Role,
} from "./nav-links";
import { Sidebar } from "./Sidebar";

// next/link and usePathname both need an App Router context that does not exist
// under jsdom. Stubbing them keeps this a component test; the real routing is
// covered by the Playwright spec in tests/e2e/ui-shell/.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));
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
  // NavLinkItem (rendered by Sidebar) calls useLinkStatus. The real hook needs
  // an App Router navigation context; without this key the mock module would
  // export it as undefined and every Sidebar render here would throw "not a
  // function" — a failure with nothing to do with the nav map under test.
  useLinkStatus: () => ({ pending: false }),
}));

describe("role → links map", () => {
  it("covers exactly the three roles in the user_role enum", () => {
    expect(Object.keys(NAV_LINKS).sort()).toEqual([
      "admin",
      "instructor",
      "student",
    ]);
    expect([...ROLES].sort()).toEqual(["admin", "instructor", "student"]);
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([
      "admin",
      "instructor",
      "student",
    ]);
  });

  it("gives every role a non-empty link set", () => {
    for (const role of ROLES) {
      expect(navLinksFor(role).length).toBeGreaterThan(0);
    }
  });

  it("returns a different link set per role", () => {
    const hrefs = (role: Role) => navLinksFor(role).map((l) => l.href);

    expect(hrefs("student")).not.toEqual(hrefs("instructor"));
    expect(hrefs("instructor")).not.toEqual(hrefs("admin"));
    expect(hrefs("student")).not.toEqual(hrefs("admin"));
  });

  it("never shows a student any staff-only route", () => {
    // The real gate is middleware/guards, but a visible dead link is a bug.
    for (const link of navLinksFor("student")) {
      expect(link.href.startsWith("/instructor")).toBe(false);
      expect(link.href.startsWith("/admin")).toBe(false);
    }
  });

  it("never shows an instructor an admin-only route", () => {
    for (const link of navLinksFor("instructor")) {
      expect(link.href.startsWith("/admin")).toBe(false);
    }
  });

  it("has unique hrefs and non-empty labels within each role", () => {
    for (const role of ROLES) {
      const links = navLinksFor(role);
      const hrefs = links.map((l) => l.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const link of links) {
        expect(link.label.trim().length).toBeGreaterThan(0);
        expect(link.href.startsWith("/")).toBe(true);
      }
    }
  });

  it("returns an empty list for an unknown, null or empty role", () => {
    // An unrecognised role must render no navigation — never the student set,
    // which would leak links to whoever ends up with a bad role value.
    expect(navLinksFor("superuser")).toEqual([]);
    expect(navLinksFor(null)).toEqual([]);
    expect(navLinksFor(undefined)).toEqual([]);
    expect(navLinksFor("")).toEqual([]);
  });
});

describe("isActiveLink", () => {
  it("matches an exact link only on an identical pathname", () => {
    const link = { href: "/admin", exact: true };
    expect(isActiveLink(link, "/admin")).toBe(true);
    expect(isActiveLink(link, "/admin/quizzes")).toBe(false);
  });

  it("matches a non-exact link across its subtree", () => {
    const link = { href: "/course" };
    expect(isActiveLink(link, "/course")).toBe(true);
    expect(isActiveLink(link, "/course/week-2")).toBe(true);
    expect(isActiveLink(link, "/coursework")).toBe(false);
    expect(isActiveLink(link, "/dashboard")).toBe(false);
  });

  it("is false for a missing pathname", () => {
    expect(isActiveLink({ href: "/course" }, null)).toBe(false);
    expect(isActiveLink({ href: "/course" }, undefined)).toBe(false);
  });
});

describe("Sidebar", () => {
  it.each(ROLES)("renders exactly the %s link set", (role) => {
    render(<Sidebar role={role} pathnameOverride="/nowhere" />);

    const rendered = screen
      .getAllByTestId("sidebar-link")
      .map((el) => el.getAttribute("href"));

    expect(rendered).toEqual(NAV_LINKS[role].map((l) => l.href));
  });

  it("labels the navigation landmark with the role", () => {
    render(<Sidebar role="instructor" pathnameOverride="/instructor" />);
    expect(
      screen.getByRole("navigation", { name: "Instructor navigation" }),
    ).toBeVisible();
  });

  it("marks the active link with aria-current=page and nothing else", () => {
    // /weeks, not /course: the student "Course" item was repointed at integration
    // because (app)/course/** never existed — course-content ships (app)/weeks/**.
    render(<Sidebar role="student" pathnameOverride="/weeks/2" />);

    const active = screen
      .getAllByTestId("sidebar-link")
      .filter((el) => el.getAttribute("aria-current") === "page");

    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/weeks");
  });

  it("keeps every student nav href pointing at a route segment that exists", () => {
    // Regression guard for the /course vs /weeks defect: the nav map is the only
    // place these paths are declared, so a typo here 404s silently for every
    // student.
    //
    // DERIVED FROM THE FILESYSTEM, not a hand-kept list. This assertion used to
    // compare against a literal set "kept in sync by hand with src/app/(app)/",
    // which is the same fragility that allowed /course through in the first place:
    // a list maintained by hand is a list that drifts, and it drifts silently in
    // the direction of passing. Reading the route group means adding a page makes
    // this test accept it, and a typo'd href fails it, with no maintenance.
    // process.cwd() rather than a URL relative to import.meta.url: Vitest
    // transforms this module, so import.meta.url is not guaranteed to be a
    // file: URL and readdirSync rejects anything else ("The URL must be of
    // scheme file"). Vitest's root is the repo root, so cwd is stable here.
    const groupDir = join(process.cwd(), "src", "app", "(app)");
    const shipped = new Set(
      readdirSync(groupDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        // Route groups "(x)" contribute no URL segment, and "_private" folders
        // have no route at all — neither can be a nav target.
        .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("_"))
        .map((entry) => `/${entry.name}`),
    );

    // Fail loudly if the derivation itself breaks, rather than passing an empty
    // set — a check that can silently verify nothing is worse than no check.
    expect(shipped.size).toBeGreaterThan(5);

    for (const link of navLinksFor("student")) {
      expect(shipped, `student nav links to ${link.href}`).toContain(link.href);
    }
  });

  it("does not light up a section root when a sibling child is active", () => {
    render(<Sidebar role="admin" pathnameOverride="/admin/quizzes" />);

    const active = screen
      .getAllByTestId("sidebar-link")
      .filter((el) => el.getAttribute("aria-current") === "page");

    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/admin/quizzes");
  });

  it("falls back to the live pathname when no override is given", () => {
    // The mock above reports /dashboard.
    render(<Sidebar role="student" />);

    const active = screen
      .getAllByTestId("sidebar-link")
      .filter((el) => el.getAttribute("aria-current") === "page");

    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/dashboard");
  });
});
