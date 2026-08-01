// =============================================================================
// ROLE-APPROPRIATE ROUTING — tests.
// -----------------------------------------------------------------------------
// These pin the four bugs reported on 2026-08-01 AND the deliberate exceptions,
// because the exceptions are the part a later edit will get wrong. Three of them
// were nearly broken while writing the fix, and each is asserted here with the
// reason attached:
//
//   * /assignments/ingest-status is a STAFF page under the student /assignments
//     prefix. Two specs in tests/e2e/submissions navigate staff to it.
//   * /forums/* moderation is server actions POSTing to page paths, so nothing
//     under a redirected prefix may be redirected on a non-GET.
//   * /leaderboard, /courses and /badges are student-level pages staff use on
//     purpose, with specs asserting the staff experience on each.
// =============================================================================

import { describe, expect, it } from "vitest";

import { NAV_LINKS, type Role } from "@/components/nav/nav-links";

import { ROLE_HOME, homeFor, isStaffRole, redirectForPage } from "./role-access";

const ROLES: readonly Role[] = ["student", "instructor", "admin"];

describe("ROLE_HOME", () => {
  it("gives each role its own home, and they are all different", () => {
    expect(ROLE_HOME).toEqual({
      student: "/dashboard",
      instructor: "/instructor",
      admin: "/admin",
    });
    expect(new Set(Object.values(ROLE_HOME)).size).toBe(3);
  });

  it("is DERIVED from each role's first nav row, so it cannot drift from the sidebar", () => {
    // The point of deriving rather than restating: if someone reorders a role's
    // navigation, its home follows. A hard-coded copy would silently disagree with
    // the link the user sees first.
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toBe(NAV_LINKS[role][0]?.href);
    }
  });

  it("every home is a page that role's own navigation offers", () => {
    // Guards against a home nobody can navigate back to.
    for (const role of ROLES) {
      const hrefs = NAV_LINKS[role].map((link) => link.href);
      expect(hrefs, `${role} home`).toContain(ROLE_HOME[role]);
    }
  });
});

describe("homeFor", () => {
  it.each(ROLES)("resolves %s", (role) => {
    expect(homeFor(role)).toBe(ROLE_HOME[role]);
  });

  it.each([null, undefined, "", "superuser", "STUDENT"])(
    "sends the unrecognised role %p to the public page, not to a guessed surface",
    (role) => {
      // A role this build does not know is a token from another deployment or a
      // stale JWT. Guessing "probably a student" would hand it a student surface.
      expect(homeFor(role as string | null | undefined)).toBe("/");
    },
  );
});

describe("isStaffRole", () => {
  it("is true for staff and false for everything else", () => {
    expect(isStaffRole("instructor")).toBe(true);
    expect(isStaffRole("admin")).toBe(true);
    for (const role of ["student", "", null, undefined, "Admin"]) {
      expect(isStaffRole(role as string | null | undefined), String(role)).toBe(false);
    }
  });
});

describe("redirectForPage — BUG 1: signing in landed staff on the student dashboard", () => {
  it("sends an admin off /dashboard to /admin", () => {
    expect(redirectForPage("admin", "/dashboard")).toBe("/admin");
  });

  it("sends an instructor off /dashboard to /instructor", () => {
    expect(redirectForPage("instructor", "/dashboard")).toBe("/instructor");
  });

  it("leaves a student on /dashboard", () => {
    // The whole point: this is their page.
    expect(redirectForPage("student", "/dashboard")).toBeNull();
  });
});

describe("redirectForPage — BUG 2: /assignments showed staff the student's list", () => {
  it("sends an admin to /admin/assignments, not merely to /admin", () => {
    // The report asked for the equivalent VIEW, not a dump on the home page: "if
    // admin is logged in and i go to /assignments instead of /admin/assignments".
    expect(redirectForPage("admin", "/assignments")).toBe("/admin/assignments");
  });

  it("sends an instructor to the grading queue, which is their view of the same work", () => {
    expect(redirectForPage("instructor", "/assignments")).toBe("/instructor/grading");
  });

  it("redirects nested student paths too, not just the index", () => {
    expect(redirectForPage("admin", "/assignments/3")).toBe("/admin/assignments");
    expect(redirectForPage("admin", "/assignments/3/submit")).toBe("/admin/assignments");
  });

  it("sends staff off /quizzes to their own quiz surface", () => {
    expect(redirectForPage("admin", "/quizzes")).toBe("/admin/quizzes");
    expect(redirectForPage("admin", "/quizzes/2")).toBe("/admin/quizzes");
  });

  it("leaves a student on all of them", () => {
    for (const path of ["/assignments", "/assignments/3/submit", "/quizzes", "/quizzes/2"]) {
      expect(redirectForPage("student", path), path).toBeNull();
    }
  });
});

describe("the exemption that matters: /assignments/ingest-status is a STAFF page", () => {
  // It lives under the student /assignments prefix but its own guard is
  // requireRole("instructor"). Redirecting staff away from it would remove a
  // working screen in order to fix a cosmetic one, and it would break
  // tests/e2e/submissions/submissions.spec.ts:713 and :736, both of which navigate
  // staff straight to it.
  it.each(["instructor", "admin"])("%s reaches it despite the prefix", (role) => {
    expect(redirectForPage(role, "/assignments/ingest-status")).toBeNull();
  });

  it("the exemption is a path match, not a prefix free-for-all", () => {
    // A sibling under /assignments is still redirected; only the exempt path is not.
    expect(redirectForPage("admin", "/assignments/ingest-statuses")).toBe("/admin/assignments");
  });
});

describe("what staff KEEP — these are deliberate and specs depend on them", () => {
  // Not oversights. Each of these is a student-level page that staff use on
  // purpose, and each has an e2e spec asserting the staff experience on it. A
  // future "tidy-up" that redirects these would break working features.
  const KEPT: readonly [string, string][] = [
    ["/leaderboard", "the cohort board, with a staff-only cohort picker"],
    ["/courses", "staff read every course; decideCourseAccess returns access-via=staff"],
    ["/courses/4", "same, per course"],
    ["/badges", "must degrade with a note rather than refuse the person who can see the link"],
    ["/settings", "one settings page for all three roles, argued in that page's header"],
    ["/forums", "instructor moderation happens on these page paths"],
    ["/forums/2/17", "same, per topic"],
    ["/notifications", "no staff equivalent exists to send them to"],
  ];

  it.each(KEPT)("staff keep %s — %s", (path) => {
    expect(redirectForPage("instructor", path)).toBeNull();
    expect(redirectForPage("admin", path)).toBeNull();
  });
});

describe("redirectForPage — the things it must never do", () => {
  it("never redirects an API path", () => {
    // An API caller must get the frozen ApiResult envelope with a real status code.
    // A redirect would turn a 403 into a 200 carrying HTML.
    for (const path of ["/api/assignments", "/api/quizzes/1", "/api/me", "/api/leaderboard"]) {
      expect(redirectForPage("admin", path), path).toBeNull();
    }
  });

  it("never redirects a student", () => {
    for (const path of ["/dashboard", "/assignments", "/quizzes", "/admin", "/instructor"]) {
      expect(redirectForPage("student", path), path).toBeNull();
    }
  });

  it("never redirects an unknown or absent role", () => {
    // The caller's own auth check refuses these; this module must not invent a
    // destination for a request that is about to be rejected anyway.
    for (const role of [null, undefined, "", "superuser"]) {
      expect(redirectForPage(role as string | null | undefined, "/dashboard")).toBeNull();
    }
  });

  it("never redirects staff away from their own area", () => {
    expect(redirectForPage("admin", "/admin")).toBeNull();
    expect(redirectForPage("admin", "/admin/assignments")).toBeNull();
    expect(redirectForPage("instructor", "/instructor")).toBeNull();
    expect(redirectForPage("instructor", "/instructor/grading")).toBeNull();
  });

  it("never produces a destination that would itself redirect", () => {
    // A loop here is a browser that spins rather than an error anyone can read, so
    // this is asserted structurally: feed every target back in and require silence.
    for (const role of ["instructor", "admin"] as const) {
      for (const path of ["/dashboard", "/assignments", "/assignments/9", "/quizzes"]) {
        const target = redirectForPage(role, path);
        expect(target, `${role} ${path}`).not.toBeNull();
        expect(redirectForPage(role, target as string), `${role} -> ${target}`).toBeNull();
      }
    }
  });

  it("every redirect target is a real page in that role's own navigation", () => {
    // Catches a target renamed on one side only — the redirect would 404, and a
    // 404 reached BY a redirect is far harder to trace than a broken link.
    for (const role of ["instructor", "admin"] as const) {
      const hrefs = NAV_LINKS[role].map((link) => link.href);
      for (const path of ["/dashboard", "/assignments", "/quizzes"]) {
        const target = redirectForPage(role, path);
        expect(hrefs, `${role} ${path} -> ${target}`).toContain(target);
      }
    }
  });
});

describe("students are not restricted, including on pages with no nav row", () => {
  // Several student pages deliberately have no sidebar entry: /quizzes and
  // /lectures are reached from inside a week, /exams likewise, /peer-review ships
  // without a row on purpose. An allowlist derived from navigation would have
  // locked students out of the quiz engine — a far worse bug than the one fixed.
  it.each([
    "/quizzes/2",
    "/lectures/9",
    "/exams/3",
    "/peer-review",
    "/peer-review/41",
    "/practice/7",
    "/problems/html-valid-document-skeleton",
    "/interview/two-sum",
    "/learn/html",
    "/weeks/2",
    "/certificates",
  ])("a student keeps %s", (path) => {
    expect(redirectForPage("student", path)).toBeNull();
  });
});
