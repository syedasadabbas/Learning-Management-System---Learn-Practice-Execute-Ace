// =============================================================================
// Unit tests for the authorization decision — owned by the auth stream.
// -----------------------------------------------------------------------------
// The subject under test is the role-satisfaction logic, asserted directly
// against the frozen ROLES_SATISFYING table. These assertions are the reason the
// guard reads a table instead of comparing role strings: two of the rules below
// (staff satisfy student routes; no role satisfies cron) are exactly what an
// ad-hoc `role === "instructor"` check gets wrong.
//
// src/lib/auth.ts is mocked out. Importing it for real would pull in `pg` and
// open a connection pool, which tests/setup.ts explicitly forbids: DB-backed
// behaviour is covered by Playwright against a seeded database, not here.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { ROLES_SATISFYING, ROUTE_AUTH, type RouteAuth } from "@/lib/contracts/api";
import { requiresSession, roleSatisfies } from "@/lib/guard";

const USER_ROLES = ["student", "instructor", "admin"] as const;
const ALL_LEVELS = Object.keys(ROLES_SATISFYING) as RouteAuth[];

describe("roleSatisfies — agreement with the frozen ROLES_SATISFYING table", () => {
  // Exhaustive: every (required level, role) pair must match the table exactly.
  // If shared-contracts ever changes the table, this test changes with it for
  // free — there is no duplicated expectation to forget to update.
  for (const required of ALL_LEVELS) {
    for (const role of USER_ROLES) {
      const expected = ROLES_SATISFYING[required].includes(role);
      it(`${role} ${expected ? "satisfies" : "does not satisfy"} a "${required}" route`, () => {
        expect(roleSatisfies(required, role)).toBe(expected);
      });
    }
  }
});

describe("roleSatisfies — the rules an ad-hoc comparison would get wrong", () => {
  it("lets staff read student-scoped routes (student means 'signed in')", () => {
    expect(roleSatisfies("student", "student")).toBe(true);
    expect(roleSatisfies("student", "instructor")).toBe(true);
    expect(roleSatisfies("student", "admin")).toBe(true);
  });

  it("never lets a student reach instructor-scoped routes", () => {
    expect(roleSatisfies("instructor", "student")).toBe(false);
  });

  it("lets an admin reach instructor-scoped routes", () => {
    expect(roleSatisfies("instructor", "admin")).toBe(true);
  });

  it("never lets an instructor reach admin-scoped routes", () => {
    expect(roleSatisfies("admin", "instructor")).toBe(false);
  });

  it("rejects EVERY user role on a cron route — only CRON_SECRET satisfies it", () => {
    expect(ROLES_SATISFYING.cron).toHaveLength(0);
    for (const role of USER_ROLES) {
      expect(roleSatisfies("cron", role)).toBe(false);
    }
  });
});

describe("roleSatisfies — anonymous callers", () => {
  it("allows an anonymous caller on a public route", () => {
    expect(roleSatisfies("public", undefined)).toBe(true);
    expect(roleSatisfies("public", null)).toBe(true);
  });

  for (const required of ALL_LEVELS.filter((r) => r !== "public")) {
    it(`rejects an anonymous caller on a "${required}" route`, () => {
      expect(roleSatisfies(required, undefined)).toBe(false);
      expect(roleSatisfies(required, null)).toBe(false);
    });
  }

  it("rejects a role string that is not in the enum", () => {
    expect(roleSatisfies("student", "superuser")).toBe(false);
    expect(roleSatisfies("admin", "")).toBe(false);
  });
});

describe("requiresSession", () => {
  it("is false for public (no session needed)", () => {
    expect(requiresSession("public")).toBe(false);
  });

  it("is false for cron — a session is not just unnecessary, it is insufficient", () => {
    expect(requiresSession("cron")).toBe(false);
  });

  it("is true for every role-scoped level", () => {
    expect(requiresSession("student")).toBe(true);
    expect(requiresSession("instructor")).toBe(true);
    expect(requiresSession("admin")).toBe(true);
  });
});

describe("ROUTE_AUTH coverage", () => {
  it("declares an authorization level for every auth-stream route", () => {
    expect(ROUTE_AUTH["POST /api/auth/register"]).toBe("public");
    expect(ROUTE_AUTH["POST /api/auth/login"]).toBe("public");
    expect(ROUTE_AUTH["POST /api/auth/logout"]).toBe("student");
    expect(ROUTE_AUTH["GET  /api/auth/me"]).toBe("student");
  });

  it("uses only levels the satisfaction table knows about", () => {
    // Guards against a route being given a level with no entry in
    // ROLES_SATISFYING, which would make roleSatisfies throw at runtime.
    for (const level of Object.values(ROUTE_AUTH)) {
      expect(ROLES_SATISFYING[level]).toBeDefined();
    }
  });
});
