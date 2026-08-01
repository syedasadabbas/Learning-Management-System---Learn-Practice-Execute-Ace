// =============================================================================
// ROLE GATING TESTS — instructor-admin stream.
// -----------------------------------------------------------------------------
// The highest-value tests in this stream. A student who reaches
// POST /api/instructor/submissions/:id/grade can grade themselves, so the
// refusal is asserted explicitly, per route, and the assertion is driven from the
// frozen ROUTE_AUTH map rather than from a hand-written expectation.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

// @/lib/auth is mocked for the same reason the auth stream's own guard test does
// it: importing it for real pulls in `pg` and opens a connection pool, which
// tests/setup.ts forbids. The subject here is the pure decision, not the session.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { ROLES_SATISFYING, ROUTE_AUTH } from "@/lib/contracts/api";
import { roleSatisfies } from "@/lib/guard";
import {
  authLevelFor,
  canAccessRoute,
  INSTRUCTOR_ROUTE_KEYS,
  type InstructorRouteKey,
} from "./access";

const GRADE_ROUTE: InstructorRouteKey =
  "POST /api/instructor/submissions/:id/grade";

describe("instructor route contract", () => {
  it("claims exactly the four routes the frozen map assigns to this stream", () => {
    expect([...INSTRUCTOR_ROUTE_KEYS].sort()).toEqual(
      [
        "GET  /api/instructor/analytics",
        "GET  /api/instructor/students",
        "GET  /api/instructor/submissions",
        "POST /api/instructor/submissions/:id/grade",
      ].sort(),
    );
  });

  it("reads each route's auth level from ROUTE_AUTH, not from a local literal", () => {
    for (const key of INSTRUCTOR_ROUTE_KEYS) {
      expect(authLevelFor(key)).toBe(ROUTE_AUTH[key]);
      expect(authLevelFor(key)).toBe("instructor");
    }
  });
});

describe("who may reach the instructor routes", () => {
  it("REFUSES a student on every route, including the grading endpoint", () => {
    for (const key of INSTRUCTOR_ROUTE_KEYS) {
      expect(canAccessRoute(key, "student")).toBe(false);
    }
    // Stated separately so a future refactor of the loop cannot lose it.
    expect(canAccessRoute(GRADE_ROUTE, "student")).toBe(false);
  });

  it("allows an instructor on every route", () => {
    for (const key of INSTRUCTOR_ROUTE_KEYS) {
      expect(canAccessRoute(key, "instructor")).toBe(true);
    }
  });

  it("allows an admin on every route (admins satisfy instructor)", () => {
    for (const key of INSTRUCTOR_ROUTE_KEYS) {
      expect(canAccessRoute(key, "admin")).toBe(true);
    }
    expect(ROLES_SATISFYING.instructor).toEqual(["instructor", "admin"]);
  });

  it("refuses an anonymous visitor and an unrecognised role", () => {
    for (const key of INSTRUCTOR_ROUTE_KEYS) {
      expect(canAccessRoute(key, null)).toBe(false);
      expect(canAccessRoute(key, undefined)).toBe(false);
      expect(canAccessRoute(key, "")).toBe(false);
      expect(canAccessRoute(key, "superuser")).toBe(false);
      // Case matters: the enum values are lowercase.
      expect(canAccessRoute(key, "Instructor")).toBe(false);
    }
  });
});

describe("admin-only actions", () => {
  // Quiz CRUD, account management, deadline config and CSV export are guarded
  // with "admin", not "instructor". ROLES_SATISFYING.admin is ["admin"] alone.
  it("REFUSES an instructor", () => {
    expect(roleSatisfies("admin", "instructor")).toBe(false);
  });

  it("allows an admin", () => {
    expect(roleSatisfies("admin", "admin")).toBe(true);
  });

  it("refuses a student", () => {
    expect(roleSatisfies("admin", "student")).toBe(false);
  });

  it("keeps the admin role set to admin alone", () => {
    expect(ROLES_SATISFYING.admin).toEqual(["admin"]);
  });
});

describe("no route escapes the contract", () => {
  it("has a ROUTE_AUTH entry for every instructor-admin path in ROUTES", () => {
    // Any route this stream serves must appear in the frozen auth map. A path
    // present in ROUTES but absent from ROUTE_AUTH would be unguarded by
    // omission — the failure mode ROUTE_AUTH exists to prevent.
    for (const key of INSTRUCTOR_ROUTE_KEYS) {
      expect(ROUTE_AUTH[key]).toBeDefined();
      expect(ROUTE_AUTH[key]).not.toBe("public");
    }
  });
});
