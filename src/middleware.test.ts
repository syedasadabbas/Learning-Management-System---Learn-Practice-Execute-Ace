// =============================================================================
// EDGE MIDDLEWARE — the role-appropriate-view redirect.
// -----------------------------------------------------------------------------
// The authorization half of this file (who is refused) is covered by
// src/lib/guard.test.ts and the auth e2e suite. What is asserted here is the
// SECOND question added on 2026-08-01 — "is this the right view for this role?" —
// and in particular the two properties that are easy to break later:
//
//   1. GET ONLY. A server action is a POST to its own page's path, and forum
//      moderation is implemented as exactly that (there are no forum endpoints in
//      the frozen ROUTES map). A redirect on POST discards the action silently, so
//      an instructor's "remove this post" would appear to work and do nothing.
//   2. The redirect drops the query string, because a student page's filters mean
//      something different against staff data.
//
// `getToken` is mocked: this test is about routing decisions, not about JWT
// verification, and the real thing needs a signed token and AUTH_SECRET.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const getToken = vi.fn();
vi.mock("next-auth/jwt", () => ({ getToken: () => getToken() }));

const { default: middleware } = await import("./middleware");
const { NextRequest } = await import("next/server");

const ORIGIN = "http://127.0.0.1:3000";

function request(path: string, method = "GET") {
  return new NextRequest(new URL(path, ORIGIN), { method });
}

/** The Location header of a redirect, or null when the request was let through. */
async function locationFor(path: string, role: string, method = "GET") {
  getToken.mockResolvedValue({ role });
  const response = await middleware(request(path, method));
  const location = response.headers.get("location");
  return location ? new URL(location).pathname + new URL(location).search : null;
}

beforeEach(() => {
  getToken.mockReset();
  // Middleware fails closed without this, which is its own documented behaviour.
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long!!";
});

describe("staff are moved to their own view", () => {
  it("an admin asking for /dashboard is sent to /admin", async () => {
    expect(await locationFor("/dashboard", "admin")).toBe("/admin");
  });

  it("an admin asking for /assignments is sent to /admin/assignments", async () => {
    expect(await locationFor("/assignments", "admin")).toBe("/admin/assignments");
  });

  it("an instructor asking for /assignments is sent to the grading queue", async () => {
    expect(await locationFor("/assignments", "instructor")).toBe("/instructor/grading");
  });

  it("drops the query string on the way", async () => {
    // ?week=3 selected a student's assignment; applied to /admin/assignments it
    // would filter different data by the same name.
    expect(await locationFor("/assignments?week=3", "admin")).toBe("/admin/assignments");
  });
});

describe("GET ONLY — a server action must never be redirected", () => {
  // This is the property that protects forum moderation. It is asserted on
  // /assignments rather than /forums because /forums is not in the redirect table
  // at all: the point is that even a path that WOULD redirect on GET does not on a
  // POST, so any future addition to that table is safe for server actions too.
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s is let through", async (method) => {
    expect(await locationFor("/assignments", "admin", method)).toBeNull();
  });

  it("but GET on the same path does redirect", async () => {
    // Sanity: without this the test above could pass because nothing redirects.
    expect(await locationFor("/assignments", "admin", "GET")).toBe("/admin/assignments");
  });

  it("HEAD is treated as a document request and redirects", async () => {
    expect(await locationFor("/assignments", "admin", "HEAD")).toBe("/admin/assignments");
  });
});

describe("who is left alone", () => {
  it("a student is never redirected", async () => {
    for (const path of ["/dashboard", "/assignments", "/assignments/3/submit", "/quizzes/2"]) {
      expect(await locationFor(path, "student"), path).toBeNull();
    }
  });

  it("staff keep the student-level pages they use on purpose", async () => {
    // Each of these has an e2e spec asserting the staff experience on it.
    for (const path of ["/leaderboard", "/courses", "/badges", "/settings", "/forums"]) {
      expect(await locationFor(path, "instructor"), path).toBeNull();
      expect(await locationFor(path, "admin"), path).toBeNull();
    }
  });

  it("staff keep /assignments/ingest-status, which is a staff page under a student prefix", async () => {
    expect(await locationFor("/assignments/ingest-status", "instructor")).toBeNull();
    expect(await locationFor("/assignments/ingest-status", "admin")).toBeNull();
  });

  it("staff are not redirected away from their own area", async () => {
    expect(await locationFor("/admin/assignments", "admin")).toBeNull();
    expect(await locationFor("/instructor/grading", "instructor")).toBeNull();
  });
});

describe("API paths are answered, never redirected", () => {
  it.each(["/api/assignments", "/api/quizzes/1", "/api/me"])("%s", async (path) => {
    // A redirect here would turn a status code an API client can act on into a 200
    // carrying HTML. Note /api/assignments is "instructor" in PROTECTED, so an admin
    // satisfies it and the request is simply allowed through.
    expect(await locationFor(path, "admin"), path).toBeNull();
  });
});

describe("the authorization check still runs first", () => {
  it("an anonymous visitor to a student page is sent to /login, not to a role home", async () => {
    getToken.mockResolvedValue(null);
    const response = await middleware(request("/dashboard"));
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const url = new URL(location as string);
    expect(url.pathname).toBe("/login");
    // And the destination is preserved so they land where they were going.
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("a student asking for an admin page is refused before any view redirect", async () => {
    getToken.mockResolvedValue({ role: "student" });
    const response = await middleware(request("/admin/assignments"));
    const url = new URL(response.headers.get("location") as string);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("forbidden");
  });

  it("fails closed when AUTH_SECRET is absent", async () => {
    delete process.env.AUTH_SECRET;
    getToken.mockResolvedValue({ role: "admin" });
    const response = await middleware(request("/dashboard"));
    // A page path gets the login redirect rather than a 503 body.
    expect(response.headers.get("location")).not.toBeNull();
  });
});
