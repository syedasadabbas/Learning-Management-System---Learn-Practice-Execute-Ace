// =============================================================================
// CURATION AUTHORIZATION TESTS.
// -----------------------------------------------------------------------------
// The decision is delegated to the frozen ROLES_SATISFYING table, so these tests
// pin the CHOICE (admin, not instructor) rather than the mechanism. If a future
// wave decides instructors may curate, this file is the one that should fail
// first — deliberately, so the change is a decision and not a drift.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

// @/lib/auth is mocked for the same reason the auth stream's own guard test does
// it: importing it for real pulls in next-auth and `pg`, and tests/setup.ts
// forbids a unit test from opening a connection pool. The subject here is the
// pure decision, not the session.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { ROLES_SATISFYING } from "@/lib/contracts/api";
import { canCurateVideos, VIDEO_CURATION_AUTH } from "./access";

describe("canCurateVideos", () => {
  it("admits an admin", () => {
    expect(canCurateVideos("admin")).toBe(true);
  });

  it("REFUSES an instructor — approving a video publishes to the whole cohort", () => {
    expect(canCurateVideos("instructor")).toBe(false);
  });

  it("refuses a student and an anonymous visitor", () => {
    expect(canCurateVideos("student")).toBe(false);
    expect(canCurateVideos(null)).toBe(false);
    expect(canCurateVideos(undefined)).toBe(false);
    expect(canCurateVideos("")).toBe(false);
  });

  it("refuses an unknown role string rather than defaulting open", () => {
    expect(canCurateVideos("superuser")).toBe(false);
  });

  it("reads its level from the frozen contract, not from a literal comparison", () => {
    expect(VIDEO_CURATION_AUTH).toBe("admin");
    expect(ROLES_SATISFYING[VIDEO_CURATION_AUTH]).toEqual(["admin"]);
  });
});
