// =============================================================================
// Regression tests for PUT /api/presentations/:presentationId/slides/:slideNumber
// — the body's `slideNumber` must never silently address a different slide.
// Owner: the API stream (defect remediation wave).
// -----------------------------------------------------------------------------
// THE DEFECT THESE LOCK DOWN. The handler used to override the body's
// `slide.slideNumber` with the one in the path and return 200. A client that
// "moved" a slide by changing that field and PUTting to the old URL therefore
// overwrote the slide at the OLD position, was told it had succeeded, and lost
// the content it thought it had moved. No error, no log, no clue.
//
// The two properties asserted below are the whole of the fix:
//   1. a mismatch is a 409 carrying a machine-readable `slide_number_mismatch`;
//   2. the refusal happens BEFORE any database work.
//
// (2) is asserted by making `@/db` a value that THROWS on any property access.
// A test that only checked the status code would still pass if the handler
// opened a transaction, read the deck and then decided to refuse — which would
// leave the door open for a future edit to move the check after the write.
//
// `featureGate` and `auth` are faked so the test does not depend on
// PRESENTATIONS_ENABLED or on a session. Neither is the subject here: the
// feature gate and the guard are covered by the e2e suite, which exercises the
// real ones against a running server.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/feature-guard", () => ({ featureGate: () => null }));

// Any read of a property on the db handle is a test failure: the 409 path must
// not touch the database at all.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `the handler reached the database (db.${String(property)}) on a path that must refuse first`,
        );
      },
    },
  ),
}));

import { PUT } from "./route";

const DECK_ID = 7;

function signedIn(): void {
  auth.mockResolvedValue({
    user: { id: "3", email: "author@x.test", name: "Author", role: "student" },
  });
}

/** A minimal valid `content` slide, as the canonical `slideSchema` defines it. */
function slide(slideNumber: number) {
  return {
    id: `s-${slideNumber}`,
    type: "content" as const,
    slideNumber,
    title: `Slide ${slideNumber}`,
    body: "Body text",
  };
}

function put(urlSlideNumber: number, bodySlideNumber: number) {
  const request = new Request(
    `http://localhost/api/presentations/${DECK_ID}/slides/${urlSlideNumber}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slide: slide(bodySlideNumber) }),
    },
  );
  const ctx = {
    params: Promise.resolve({
      presentationId: String(DECK_ID),
      slideNumber: String(urlSlideNumber),
    }),
  };
  return PUT(request, ctx);
}

describe("PUT slides/:slideNumber — a body that disagrees with the URL", () => {
  it("409s rather than silently overwriting the slide at the URL position", async () => {
    signedIn();
    const response = await put(3, 1);

    expect(response.status).toBe(409);
    const body: { error?: string; code?: string } = await response.json();
    expect(body.code).toBe("slide_number_mismatch");
    // The message names BOTH numbers, because "conflict" alone does not tell a
    // client which of the two it got wrong.
    expect(body.error).toContain("slide 1");
    expect(body.error).toContain("slide 3");
  });

  it("refuses before touching the database", async () => {
    signedIn();
    // The `@/db` proxy throws on any access, so a handler that opened its
    // transaction first would reject here instead of resolving with a 409.
    await expect(put(3, 1)).resolves.toMatchObject({ status: 409 });
  });

  it("never confuses a mismatch with a bad path segment", async () => {
    signedIn();
    // 400 is reserved for a malformed URL. A well-formed URL and a well-formed
    // body that merely disagree are a conflict, not a syntax error.
    const response = await put(2, 5);
    expect(response.status).toBe(409);
  });
});
