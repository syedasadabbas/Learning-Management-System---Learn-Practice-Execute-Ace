// =============================================================================
// CROSS-STREAM CONTRACT GUARDS
// -----------------------------------------------------------------------------
// Owned by the coordinator (devops-testing), not by any feature stream.
//
// Ten streams were built in parallel against each other's function signatures.
// Where a signature is declared in src/lib/contracts/** TypeScript already
// enforces it. These tests cover the seams that TypeScript alone does NOT
// protect, and each one exists because of a specific failure or near-failure
// observed during integration:
//
//   1. Signatures landed as stubs and then had their bodies replaced by a
//      different agent. A rename would compile fine in the file that owns it and
//      break only the *caller*, on a branch nobody was typechecking at the time.
//   2. `dedupeAgainstExisting` is imported across streams but is NOT part of the
//      frozen contract, so nothing declared it stable.
//   3. Navigation hrefs are strings; a typo 404s silently for every student. This
//      already happened once (`/course` never existed as a segment).
//
// These are cheap, run without a database, and fail loudly at the exact seam.
// =============================================================================

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { onScoringEvent } from "@/lib/leaderboard/on-scoring-event";
import { evaluatePenalties } from "@/lib/penalties/rules";
import { dedupeAgainstExisting } from "@/lib/penalties/accumulation";
import { getWeekProgress } from "@/lib/progress/read-model";
import { ROUTES, ROUTE_AUTH, ROLES_SATISFYING } from "@/lib/contracts/api";
import { navLinksFor, ROLES } from "@/components/nav/nav-links";

describe("stub-then-replace hooks keep the signature their callers compiled against", () => {
  // Each of these three landed as a no-op stub so downstream streams could call
  // it, then had its body replaced by the owning stream. Arity and name are the
  // part a rename would silently change.
  it.each([
    ["onScoringEvent", onScoringEvent, 1],
    ["evaluatePenalties", evaluatePenalties, 1],
    ["getWeekProgress", getWeekProgress, 1],
  ])("%s takes %i argument(s) and keeps its name", (name, fn, arity) => {
    expect(typeof fn).toBe("function");
    expect(fn.name).toBe(name);
    expect(fn.length).toBe(arity);
  });

  it("evaluatePenalties stays pure and returns an array for an on-time, passing student", () => {
    // Purity is the contract two different callers rely on: quizzes calls it
    // inside a transaction, submissions outside one. A database touch here would
    // make one of those wrong.
    const decisions = evaluatePenalties({
      studentId: 1,
      daysLate: 0,
      quizBestPercent: 100,
      missedEntirely: false,
    });
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions).toEqual([]);
  });
});

describe("dedupeAgainstExisting is a de-facto cross-stream export", () => {
  // The quizzes stream imports this from the penalties stream to avoid stacking
  // three identical notices for three failed attempts. It is not in
  // src/lib/contracts/**, so nothing else declares it stable. This test is the
  // declaration: renaming or re-shaping it must break here, not in production.
  it("exists with the shape quizzes calls it with", () => {
    expect(typeof dedupeAgainstExisting).toBe("function");
    expect(dedupeAgainstExisting.length).toBe(2);
  });

  it("suppresses a decision whose type is already held unresolved", () => {
    const decision = {
      type: "quiz_failure" as const,
      severity: "serious" as const,
      description: "failed",
      penaltyPoints: 3,
    };
    expect(
      dedupeAgainstExisting([decision], [{ type: "quiz_failure", resolved: false }]),
    ).toEqual([]);
  });

  it("re-issues once the previous penalty of that type is resolved", () => {
    const decision = {
      type: "quiz_failure" as const,
      severity: "serious" as const,
      description: "failed",
      penaltyPoints: 3,
    };
    expect(
      dedupeAgainstExisting([decision], [{ type: "quiz_failure", resolved: true }]),
    ).toEqual([decision]);
  });
});

describe("every frozen route is classified for authorization", () => {
  // ROUTE_AUTH is typed Record<RouteKey, RouteAuth>, so a missing key is already
  // a compile error. This asserts the runtime objects actually agree, which
  // catches a hand-edited map that typechecks against a stale RouteKey union.
  it("ROUTE_AUTH covers exactly the keys in ROUTES", () => {
    expect(Object.keys(ROUTE_AUTH).sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it("every declared level is satisfiable by a known set of roles", () => {
    for (const [route, level] of Object.entries(ROUTE_AUTH)) {
      expect(ROLES_SATISFYING[level], `${route} -> ${level}`).toBeDefined();
    }
  });

  it("cron is satisfied by no user role at all", () => {
    // A regression here would let a signed-in user trigger the Google Sheet
    // ingestion sweep, which writes submission rows.
    expect(ROLES_SATISFYING.cron).toEqual([]);
  });

  it("a student never satisfies an instructor- or admin-level route", () => {
    expect(ROLES_SATISFYING.instructor).not.toContain("student");
    expect(ROLES_SATISFYING.admin).not.toContain("student");
    expect(ROLES_SATISFYING.admin).not.toContain("instructor");
  });
});

describe("navigation only links to route segments that exist", () => {
  // Regression guard for the /course vs /weeks defect: nav-links.ts is the only
  // place these paths are declared, and a wrong one 404s with no error anywhere.
  //
  // DERIVED BY WALKING src/app, not kept in sync by hand. This was a literal set
  // annotated "kept in sync by hand with src/app/(app)/ and src/app/(staff)/",
  // and the add-on wave proved why that fails: five new pages shipped and the list
  // silently went stale. A hand-kept allowlist drifts in the direction of PASSING,
  // so it stops catching the defect it exists for while still looking green.
  //
  // Walking the router means a new page is accepted automatically and a typo'd
  // href still fails, with no maintenance and no way for the two to disagree.

  /** Every URL path under src/app that actually has a page.tsx. */
  function shippedRoutes(): Set<string> {
    const appDir = join(process.cwd(), "src", "app");
    const found = new Set<string>();

    const walk = (dir: string, urlSegments: string[]): void => {
      const entries = readdirSync(dir, { withFileTypes: true });

      // A directory is a real route only if it renders a page.
      if (entries.some((e) => e.isFile() && /^page\.tsx?$/.test(e.name))) {
        found.add(`/${urlSegments.join("/")}`);
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;

        // "(group)" contributes NO url segment — that is the whole point of a
        // route group, and it is why (app)/settings serves /settings.
        if (name.startsWith("(")) {
          walk(join(dir, name), urlSegments);
          continue;
        }
        // "_private" folders have no route at all (and "%5F" is the escape for a
        // literal leading underscore, which is why /_ui exists but is not a nav
        // target). "[dynamic]" segments are never linked to raw from nav.
        if (name.startsWith("_") || name.startsWith("%5F") || name.startsWith("[")) {
          continue;
        }
        walk(join(dir, name), [...urlSegments, name]);
      }
    };

    walk(appDir, []);
    return found;
  }

  const SHIPPED_SEGMENTS = shippedRoutes();

  it("the route derivation itself works", () => {
    // Without this, a broken walk yields an empty set, every assertion below
    // passes vacuously, and the suite reports green while checking nothing.
    expect(SHIPPED_SEGMENTS.size).toBeGreaterThan(10);
    expect(SHIPPED_SEGMENTS).toContain("/dashboard");
    expect(SHIPPED_SEGMENTS).toContain("/admin");
    // Proves route groups are collapsed rather than emitted as "/(app)/settings".
    expect([...SHIPPED_SEGMENTS].some((r) => r.includes("("))).toBe(false);
  });

  it.each(ROLES)("every %s nav href points at a shipped segment", (role) => {
    const links = navLinksFor(role);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(SHIPPED_SEGMENTS, `${role} nav links to ${link.href}`).toContain(link.href);
    }
  });

  it("no nav href points at /course, which never existed as a segment", () => {
    // NARROWED from `startsWith("/course")`, which was a prefix test standing in
    // for an equality test and caught the wrong thing. `/courses` — the real,
    // shipped multi-course catalogue at src/app/(app)/courses/page.tsx — is not
    // the historical `/course` defect this guard exists for, but the prefix form
    // matched it and made a legitimate route unreachable from the nav.
    //
    // The replacement still rejects `/course` itself and anything nested under
    // it (`/course/3`), so the original defect is caught just as tightly. It is
    // strictly more precise, not looser: `/course` was never a segment, and the
    // "every nav href points at a shipped segment" assertion above already fails
    // any href the filesystem walk cannot find.
    for (const role of ROLES) {
      for (const link of navLinksFor(role)) {
        expect(link.href === "/course" || link.href.startsWith("/course/")).toBe(false);
      }
    }
  });
});
