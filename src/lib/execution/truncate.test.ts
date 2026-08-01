// =============================================================================
// Truncation is what stops `while (true) print("x")` becoming a multi-megabyte
// response, so the cap being ENFORCED (not merely intended) is the assertion.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  clipInput,
  MAX_SOURCE_CHARS,
  MAX_STREAM_CHARS,
  truncateStream,
} from "./truncate";

describe("truncateStream", () => {
  it("leaves output under the cap byte-for-byte untouched", () => {
    const text = "line one\nline two\n";
    const result = truncateStream(text);
    expect(result).toEqual({ text, truncated: false, originalChars: text.length });
  });

  it("keeps exactly the cap and flags truncation past it", () => {
    const atCap = "x".repeat(MAX_STREAM_CHARS);
    expect(truncateStream(atCap).truncated).toBe(false);

    const overCap = "x".repeat(MAX_STREAM_CHARS + 1);
    const result = truncateStream(overCap);
    expect(result.truncated).toBe(true);
    expect(result.originalChars).toBe(MAX_STREAM_CHARS + 1);
    expect(result.text.startsWith("x".repeat(MAX_STREAM_CHARS))).toBe(true);
  });

  it("bounds an infinite print loop's output to roughly the cap", () => {
    // 5 MB in: the response must not be 5 MB out.
    const flood = "print\n".repeat(1_000_000);
    const result = truncateStream(flood);
    expect(flood.length).toBeGreaterThan(5_000_000);
    // Cap plus the one-line marker; generous slack, still three orders of
    // magnitude below the input.
    expect(result.text.length).toBeLessThan(MAX_STREAM_CHARS + 500);
    expect(result.truncated).toBe(true);
  });

  it("says how much was dropped, so the ellipsis is not a mystery", () => {
    const result = truncateStream("y".repeat(MAX_STREAM_CHARS + 250));
    expect(result.text).toContain("250 more characters");
    expect(result.text).toContain("truncated");
  });

  it("respects an explicit smaller limit", () => {
    const result = truncateStream("abcdef", 3);
    expect(result.text.startsWith("abc")).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("treats null/undefined as empty output rather than throwing", () => {
    expect(truncateStream(null).text).toBe("");
    expect(truncateStream(undefined).truncated).toBe(false);
  });
});

describe("clipInput", () => {
  it("reports whether the value was clipped, so a caller can refuse", () => {
    expect(clipInput("short", MAX_SOURCE_CHARS)).toEqual({ text: "short", clipped: false });

    const long = "z".repeat(MAX_SOURCE_CHARS + 1);
    const clipped = clipInput(long, MAX_SOURCE_CHARS);
    expect(clipped.clipped).toBe(true);
    expect(clipped.text.length).toBe(MAX_SOURCE_CHARS);
  });

  it("treats a missing value as empty", () => {
    expect(clipInput(undefined, 10)).toEqual({ text: "", clipped: false });
  });
});
