// =============================================================================
// Unit tests for the `lectures.resources` jsonb parser.
// Owner: course-content stream.
// -----------------------------------------------------------------------------
// The column is untyped jsonb, so these tests pin the two properties that matter:
// sandpack entries are skipped (they belong to interactive-exercises), and a
// malformed blob degrades to fewer links rather than an exception.
// =============================================================================

import { describe, expect, it } from "vitest";

import { linkResourcesFrom, sandpackResourceCount } from "./resources";

/** Shaped exactly like a seeded Week 1 lecture's resources array. */
const SEEDED = [
  {
    title: "W3Schools — HTML Introduction",
    type: "link",
    url: "https://www.w3schools.com/html/html_intro.asp",
  },
  {
    title: "W3Schools — HTML Basic Examples",
    type: "link",
    url: "https://www.w3schools.com/html/html_basic.asp",
  },
  {
    title: "Practice: build a valid page skeleton",
    type: "sandpack",
    starterCode: { "/index.html": "<!DOCTYPE html>" },
  },
];

describe("linkResourcesFrom", () => {
  it("returns only the link entries from a seeded lecture", () => {
    const links = linkResourcesFrom(SEEDED);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.title)).toEqual([
      "W3Schools — HTML Introduction",
      "W3Schools — HTML Basic Examples",
    ]);
  });

  it("flags W3Schools links and strips the www prefix from the host", () => {
    const [first] = linkResourcesFrom(SEEDED);
    expect(first.host).toBe("w3schools.com");
    expect(first.isW3Schools).toBe(true);
  });

  it("does not flag a non-W3Schools host", () => {
    const links = linkResourcesFrom([
      { title: "MDN", type: "link", url: "https://developer.mozilla.org/en-US/" },
    ]);
    expect(links[0].isW3Schools).toBe(false);
    expect(links[0].host).toBe("developer.mozilla.org");
  });

  it("returns an empty list for null, non-arrays and sandpack-only lectures", () => {
    expect(linkResourcesFrom(null)).toEqual([]);
    expect(linkResourcesFrom(undefined)).toEqual([]);
    expect(linkResourcesFrom("not an array")).toEqual([]);
    expect(linkResourcesFrom({ type: "link", url: "https://example.test" })).toEqual([]);
    expect(linkResourcesFrom([SEEDED[2]])).toEqual([]);
  });

  it("drops entries with a missing, empty or non-http url", () => {
    const links = linkResourcesFrom([
      { title: "no url", type: "link" },
      { title: "empty", type: "link", url: "" },
      { title: "xss", type: "link", url: "javascript:alert(1)" },
      { title: "data", type: "link", url: "data:text/html,<script>" },
      { title: "good", type: "link", url: "https://example.test/x" },
    ]);
    expect(links.map((l) => l.title)).toEqual(["good"]);
  });

  it("falls back to the host when a link has no usable title", () => {
    const links = linkResourcesFrom([
      { type: "link", url: "https://www.w3schools.com/css/" },
      { title: "   ", type: "link", url: "https://www.w3schools.com/js/" },
    ]);
    expect(links.map((l) => l.title)).toEqual(["w3schools.com", "w3schools.com"]);
  });

  it("survives junk entries inside an otherwise valid array", () => {
    const links = linkResourcesFrom([null, 42, "x", ...SEEDED]);
    expect(links).toHaveLength(2);
  });
});

describe("sandpackResourceCount", () => {
  it("counts the exercises the interactive-exercises stream will render", () => {
    expect(sandpackResourceCount(SEEDED)).toBe(1);
  });

  it("returns 0 for null and non-arrays", () => {
    expect(sandpackResourceCount(null)).toBe(0);
    expect(sandpackResourceCount("nope")).toBe(0);
  });
});
