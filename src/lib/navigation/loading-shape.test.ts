import { describe, expect, it } from "vitest";

import { NAV_LINKS, type Role } from "@/components/nav/nav-links";
import {
  DEFAULT_SHAPE,
  LOADING_SHAPE_PREFIXES,
  loadingShapeFor,
} from "./loading-shape";

// Unit tests for the pathname -> skeleton mapping. The point of separating this
// from PageSkeleton is that these run with no DOM and no router at all.

describe("loadingShapeFor", () => {
  it("never returns undefined, whatever it is handed", () => {
    // A pending navigation is the worst moment to throw: the previous page is
    // already being torn down, so an error here is a blank screen.
    for (const input of [null, undefined, "", "/", "/nope", "/weeks"]) {
      const spec = loadingShapeFor(input);
      expect(spec).toBeDefined();
      expect(spec.count).toBeGreaterThan(0);
    }
  });

  it("falls back to prose for an unmapped path", () => {
    expect(loadingShapeFor("/some/page/nobody/mapped")).toEqual(DEFAULT_SHAPE);
    expect(DEFAULT_SHAPE.shape).toBe("prose");
  });

  it("matches a section root and everything beneath it", () => {
    expect(loadingShapeFor("/weeks").shape).toBe("cards");
    expect(loadingShapeFor("/weeks/2").shape).toBe("cards");
    expect(loadingShapeFor("/weeks/2/lectures/5").shape).toBe("cards");
  });

  it("does NOT match a path that merely starts with the same characters", () => {
    // "/weeksomething" is a different route, not a child of "/weeks". Guarding
    // on the "/" boundary is the same rule src/middleware.ts uses; getting it
    // wrong there would be an authorization bug, and getting it wrong here
    // would paint the wrong skeleton for a page that shares a prefix.
    expect(loadingShapeFor("/weeksomething")).toEqual(DEFAULT_SHAPE);
    expect(loadingShapeFor("/learning")).toEqual(DEFAULT_SHAPE);
  });

  it("resolves the longest matching prefix, not the first declared", () => {
    // "/instructor" is a dashboard; "/instructor/grading" is a queue. If the
    // table were scanned in declaration order the deeper, more specific entry
    // could be shadowed by its own parent.
    expect(loadingShapeFor("/instructor").shape).toBe("dashboard");
    expect(loadingShapeFor("/instructor/grading").shape).toBe("table");
    expect(loadingShapeFor("/instructor/students").shape).toBe("table");
    expect(loadingShapeFor("/admin").shape).toBe("list");
    expect(loadingShapeFor("/admin/analytics").shape).toBe("dashboard");
  });

  it("keeps /leaderboard/me on the leaderboard shape", () => {
    expect(loadingShapeFor("/leaderboard/me").shape).toBe("table");
  });
});

describe("coverage of the real navigation", () => {
  it("gives every link in NAV_LINKS a shape of its own, not the fallback", () => {
    // The failure this prevents: a stream adds a nav row, and the skeleton for
    // its page silently becomes four lines of grey prose in front of a table.
    // That is a worse transition than no skeleton, because the layout visibly
    // changes twice. Derived from NAV_LINKS rather than a second hand-kept list
    // for the reason recorded in CHANGELOG.log 2026-07-30: hardcoded counts and
    // copies of this map drift, and the drift is invisible until someone reads
    // the failure.
    const missing: string[] = [];
    for (const role of Object.keys(NAV_LINKS) as Role[]) {
      for (const link of NAV_LINKS[role]) {
        if (loadingShapeFor(link.href) === DEFAULT_SHAPE) {
          missing.push(`${role}:${link.href}`);
        }
      }
    }
    // /settings is mapped explicitly to "prose" — an equal value but not the
    // same object — so a genuinely mapped prose route does not trip this.
    expect(missing).toEqual([]);
  });

  it("declares its prefixes longest-first", () => {
    const lengths = LOADING_SHAPE_PREFIXES.map((p) => p.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });
});
