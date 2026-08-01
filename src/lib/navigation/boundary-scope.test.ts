// =============================================================================
// THE INVARIANT TEST — no `notFound()` may sit under an unguarded Suspense
// boundary.
// -----------------------------------------------------------------------------
// Owner: ui-shell stream (navigation).
//
// WHY THIS TEST IS THE MOST IMPORTANT ONE IN THIS CHANGE
//
// A `loading.tsx` is a Suspense boundary. Once its fallback flushes, the HTTP
// status line has already gone out as 200, so a `notFound()` reached below it
// renders the not-found UI under a 200. Two route-group-level `loading.tsx`
// files shipped on this branch and broke seven previously-passing e2e specs
// across four streams that way (see src/components/nav/PageSkeleton.tsx).
//
// Nothing failed at unit level, and nothing could have: the defect is a
// relationship between FILE PLACEMENTS, not a property of any one module. Every
// component was individually correct. So the check has to be over the router
// tree on disk, and that is what this file does — it walks src/app, works out
// which routes can 404 and which boundary is highest above each of them, and
// fails if the two are in the wrong order. It runs in vitest, in under a second,
// with no database, no dev server and no browser.
//
// IT IS ALSO THE ONLY VERIFICATION THIS STREAM CAN RUN. Six agents share one
// seeded database and port 3000, so the Playwright suite is run serially
// afterwards by the coordinator. tests/e2e/ui-shell/navigation.spec.ts asserts
// the same property against real HTTP responses; this asserts it against the
// filesystem, which is where the mistake is actually made.
//
// THE RULE, stated once:
//
//   For a route R that can `notFound()`, let B be the SHALLOWEST directory in
//   R's own ancestor chain (R included) that contains a loading.tsx. There must
//   be a layout.tsx calling notFound() in some directory G in that same chain
//   with depth(G) <= depth(B). Equal depth is allowed and is the normal case: a
//   layout renders ABOVE its own segment's boundary, so layout.tsx and
//   loading.tsx in one directory is exactly the validated pattern.
//
// Route groups are what make the rule satisfiable at all. `(index)` directories
// do not appear in the URL and are NOT in a sibling's ancestor chain, so putting
// a nav destination's page and boundary in one keeps the boundary off the
// destination's 404-capable children — children a layout at the parent could
// never have guarded, because it is never handed their params.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_LINKS } from "@/components/nav/nav-links";

const APP_DIR = join(process.cwd(), "src", "app");

/** A directory is a route GROUP — `(app)`, `(index)` — not a URL segment. */
function isGroup(name: string): boolean {
  return name.startsWith("(") && name.endsWith(")");
}

/**
 * Strip comments before looking for `notFound()`.
 *
 * Not pedantry. `src/app/(app)/courses/[courseId]/page.tsx` explains at length
 * why it renders a refusal page INSTEAD of calling notFound(), and the phrase
 * "notFound()" appears in that explanation. A raw `grep -rln "notFound()"`
 * reports that route as 404-capable, which would make this test demand a guard
 * for a status code the route never sets. The comment stripper is what tells the
 * documentation apart from the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function callsNotFound(file: string): boolean {
  return /\bnotFound\s*\(/.test(stripComments(readFileSync(file, "utf8")));
}

interface Segment {
  /** Path relative to src/app, POSIX-style, e.g. "(app)/weeks/(index)". */
  rel: string;
  /** Depth in the router tree; src/app itself is 0. */
  depth: number;
  hasPage: boolean;
  hasLoading: boolean;
  /** A layout.tsx that makes an existence decision (calls notFound()). */
  hasGuard: boolean;
  /** URL path this segment serves, groups removed. "/" for the root. */
  url: string;
}

function walk(): Segment[] {
  const out: Segment[] = [];

  const visit = (dir: string) => {
    const entries = readdirSync(dir);
    const files = new Set(
      entries.filter((e) => statSync(join(dir, e)).isFile()),
    );
    const rel = relative(APP_DIR, dir).split(sep).join("/");
    const parts = rel === "" ? [] : rel.split("/");
    const urlParts = parts.filter((p) => !isGroup(p));

    out.push({
      rel,
      depth: parts.length,
      hasPage: files.has("page.tsx"),
      hasLoading: files.has("loading.tsx"),
      hasGuard: files.has("layout.tsx") && callsNotFound(join(dir, "layout.tsx")),
      url: `/${urlParts.join("/")}`.replace(/\/+$/, "") || "/",
    });

    for (const entry of entries) {
      const child = join(dir, entry);
      // `src/app/api` is route handlers, not pages: a Response object carries its
      // own status and no Suspense boundary can exist above one.
      if (statSync(child).isDirectory() && !(rel === "" && entry === "api")) {
        visit(child);
      }
    }
  };

  visit(APP_DIR);
  return out;
}

const SEGMENTS = walk();
const byRel = new Map(SEGMENTS.map((s) => [s.rel, s]));

/** R's own ancestor chain, shallowest first, R included. */
function chain(rel: string): Segment[] {
  const parts = rel === "" ? [] : rel.split("/");
  const result: Segment[] = [];
  for (let i = 0; i <= parts.length; i += 1) {
    const seg = byRel.get(parts.slice(0, i).join("/"));
    if (seg) result.push(seg);
  }
  return result;
}

/**
 * Routes whose 404 is raised by a COMPONENT rather than by their own page.tsx.
 *
 * `src/components/problems/BankPages.tsx:127` refuses an unknown slug and a slug
 * belonging to the other bank, and both /problems/[slug] and /interview/[slug]
 * are three-line wrappers around it. A grep of src/app alone therefore misses
 * two of the twelve 404-capable routes in the app — which is precisely the class
 * of thing a hand-kept list gets wrong, so the entry below is itself checked for
 * rot by the last test in this file.
 */
const NOT_FOUND_FROM_COMPONENT: ReadonlyArray<[string, string]> = [
  ["(app)/problems/[slug]", "src/components/problems/BankPages.tsx"],
  ["(app)/interview/[slug]", "src/components/problems/BankPages.tsx"],
];

function can404(seg: Segment): boolean {
  if (!seg.hasPage) return false;
  if (NOT_FOUND_FROM_COMPONENT.some(([rel]) => rel === seg.rel)) return true;
  // A guard layout only exists BECAUSE the route can 404, so its presence is
  // itself evidence — and it catches the case where the page's own notFound()
  // became unreachable and was removed.
  if (seg.hasGuard) return true;
  return callsNotFound(join(APP_DIR, ...seg.rel.split("/"), "page.tsx"));
}

describe("router tree: 404s and Suspense boundaries", () => {
  it("finds the router tree at all", () => {
    // A rename of src/app would otherwise make every assertion below pass by
    // iterating nothing — the worst possible failure for a guard test.
    expect(SEGMENTS.length).toBeGreaterThan(40);
    expect(SEGMENTS.filter((s) => s.hasPage).length).toBeGreaterThan(30);
    expect(SEGMENTS.filter((s) => s.hasLoading).length).toBeGreaterThan(20);
  });

  it("puts every 404-capable route's guard AT OR ABOVE the highest boundary over it", () => {
    const violations: string[] = [];

    for (const seg of SEGMENTS) {
      if (!can404(seg)) continue;

      const ownChain = chain(seg.rel);
      const boundaries = ownChain.filter((s) => s.hasLoading);
      if (boundaries.length === 0) {
        // No boundary anywhere above this route, so `notFound()` in the page is
        // still able to set the status and no guard is needed. /quizzes/[weekId]
        // and /exams/[weekId] are deliberately in this state: neither has an
        // index route, so neither is a nav destination that needed a skeleton,
        // and leaving them alone is the change with zero risk attached.
        continue;
      }

      const highestBoundary = boundaries[0];
      const guard = ownChain.find(
        (s) => s.hasGuard && s.depth <= highestBoundary.depth,
      );
      if (!guard) {
        violations.push(
          `${seg.url} (${seg.rel}) can notFound(), the highest boundary over it is ` +
            `${highestBoundary.rel}/loading.tsx, and no layout.tsx at or above that ` +
            `depth calls notFound() — this route would answer 200 for a missing id`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("has no route-GROUP-level loading.tsx, only leaf ones", () => {
    // The two that shipped and were reverted were (app)/loading.tsx and
    // (staff)/loading.tsx. Both failure modes came from the same placement: a
    // boundary in a directory with no page.tsx of its own covers a whole family
    // of routes, breaks all of their status codes, and still never fires on a
    // sibling swap because it is only entered once. "Beside a page.tsx" is the
    // shortest expression of "at a leaf".
    const groupLevel = SEGMENTS.filter((s) => s.hasLoading && !s.hasPage).map(
      (s) => s.rel,
    );
    expect(groupLevel).toEqual([]);
  });

  it("gives every sidebar destination a loading boundary", () => {
    // The point of the whole change: a click on any nav row paints something. A
    // destination with no boundary holds the previous page, fully
    // interactive-looking, for the 260-1000 ms the server takes.
    const withBoundary = new Set(
      SEGMENTS.filter((s) => s.hasPage && s.hasLoading).map((s) => s.url),
    );

    const missing: string[] = [];
    for (const links of Object.values(NAV_LINKS)) {
      for (const link of links) {
        if (!withBoundary.has(link.href)) missing.push(link.href);
      }
    }

    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps every nav destination's boundary off its 404-capable children", () => {
    // The trap that makes rule 3 in PageSkeleton.tsx worth writing down: a
    // boundary covers its segment AND everything nested under it, so putting one
    // straight onto /weeks would swallow the status of /weeks/[weekId]. Asserted
    // as a property rather than as a list of expected `(index)` directories, so
    // that a NEW dynamic child of an existing destination fails this test on the
    // day it is added rather than in an e2e run four commits later.
    const destinations = new Set(
      Object.values(NAV_LINKS).flatMap((links) => links.map((l) => l.href)),
    );

    const violations: string[] = [];
    for (const seg of SEGMENTS) {
      if (!seg.hasLoading || !destinations.has(seg.url)) continue;

      for (const other of SEGMENTS) {
        // A strict descendant of this boundary's own directory.
        if (other.rel === seg.rel || !other.rel.startsWith(`${seg.rel}/`)) continue;
        if (!can404(other)) continue;

        const guard = chain(other.rel).find((s) => s.hasGuard && s.depth <= seg.depth);
        if (!guard) {
          violations.push(
            `${seg.rel}/loading.tsx covers ${other.rel}, which can notFound() and ` +
              `has no guard at or above depth ${seg.depth}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the component-raised 404 list honest", () => {
    // If BankPages.tsx ever stops calling notFound(), the two entries above
    // silently start demanding guards for routes that no longer 404 — and worse,
    // if a NEW shared component starts calling notFound(), nothing here notices.
    // This test can only defend the first half; it does so by failing when the
    // premise expires, which is the point at which a human should re-run the
    // grep over src/components.
    for (const [rel, componentPath] of NOT_FOUND_FROM_COMPONENT) {
      expect(byRel.has(rel), `${rel} no longer exists`).toBe(true);
      expect(
        callsNotFound(join(process.cwd(), componentPath)),
        `${componentPath} no longer calls notFound(); re-check whether ${rel} still needs its guard`,
      ).toBe(true);
    }
  });
});
