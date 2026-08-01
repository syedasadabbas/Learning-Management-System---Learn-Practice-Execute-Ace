// =============================================================================
// Unit tests for the shared page-window parser.
// -----------------------------------------------------------------------------
// The property under test that actually matters is the CEILING: an unbounded
// `limit` on class_chat is a denial-of-service any signed-in student can fire
// from a URL bar, and every list endpoint in this wave routes through this one
// function to avoid it.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_OFFSET,
  MAX_PAGE_SIZE,
  paginated,
  parsePage,
} from "./pagination";

/** Terser than constructing URLSearchParams inline in every case. */
function page(query: string) {
  return parsePage(new URLSearchParams(query));
}

describe("parsePage — defaults", () => {
  it("an empty query is the default window", () => {
    const result = page("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
});

describe("parsePage — the ceiling", () => {
  it("clamps an over-large limit rather than rejecting it", () => {
    // Clamped, not 422: a client asking for 5000 rows means "as many as you will
    // give me", and failing there breaks a working UI on a large class.
    const result = page("limit=5000");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.limit).toBe(MAX_PAGE_SIZE);
  });

  it("accepts a limit exactly at the ceiling", () => {
    const result = page(`limit=${MAX_PAGE_SIZE}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.limit).toBe(MAX_PAGE_SIZE);
  });

  it("rejects an offset past the scan ceiling", () => {
    const result = page(`offset=${MAX_OFFSET + 1}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_offset");
  });
});

describe("parsePage — malformed input is an error, never a silent default", () => {
  it.each(["limit=abc", "limit=-1", "limit=1.5", "limit= 5", "limit="])(
    "rejects %s",
    (query) => {
      const result = page(query);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_limit");
    },
  );

  it("rejects limit=0 — a page of nothing is a client bug, not a request", () => {
    const result = page("limit=0");
    expect(result.ok).toBe(false);
  });

  it.each(["offset=abc", "offset=-5", "offset=2.5"])("rejects %s", (query) => {
    const result = page(query);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_offset");
  });

  it("does NOT fall back to the default on a malformed limit", () => {
    // The whole point: `limit=abc` returning 20 rows hides the client's bug
    // behind a page that looks like it worked.
    const result = page("limit=abc");
    expect(result.ok).toBe(false);
  });
});

describe("parsePage — valid windows", () => {
  it("reads both parameters", () => {
    const result = page("limit=7&offset=42");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page).toEqual({ limit: 7, offset: 42 });
  });

  it("offset=0 is valid and is not confused with absent", () => {
    const result = page("offset=0");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.offset).toBe(0);
  });
});

describe("paginated", () => {
  it("echoes the window actually applied, including a clamped limit", () => {
    const envelope = paginated(["a", "b"], { limit: MAX_PAGE_SIZE, offset: 10 }, 250);
    expect(envelope).toEqual({
      items: ["a", "b"],
      limit: MAX_PAGE_SIZE,
      offset: 10,
      total: 250,
    });
  });
});
