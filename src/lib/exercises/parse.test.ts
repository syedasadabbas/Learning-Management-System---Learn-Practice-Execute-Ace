// =============================================================================
// Tests for the lectures.resources parser.
// -----------------------------------------------------------------------------
// The fixtures below are copied from scripts/seed-content.ts on purpose: these
// four exercises are the only sandpack resources that actually exist in the
// seeded curriculum, so they are the shapes that must never regress.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  ENTRY_FILE,
  countSandpackResources,
  extensionOf,
  hasSandpackResources,
  isLinkResource,
  isSandpackResource,
  languageForPath,
  normaliseFilePath,
  normaliseStarterCode,
  orderFilePaths,
  parseLectureIdParam,
  parseSandpackResources,
  usableExercises,
  warningsAsDiagnostics,
} from "./parse";

// --- seed-shaped fixtures ---------------------------------------------------

const W3_LINK = {
  title: "W3Schools — HTML Introduction",
  type: "link",
  url: "https://www.w3schools.com/html/html_intro.asp",
};

/** Week 1 L1: single-file HTML skeleton. */
const SKELETON = {
  title: "Practice: build a valid page skeleton",
  type: "sandpack",
  starterCode: { "/index.html": "<!DOCTYPE html>\n<html lang=\"en\"></html>" },
};

/** Week 2 L2: HTML + CSS. */
const FLEXBOX = {
  title: "Practice: centre a card with Flexbox",
  type: "sandpack",
  starterCode: {
    "/index.html": '<link rel="stylesheet" href="styles.css" />',
    "/styles.css": ".stage { min-height: 100vh; }",
  },
};

/** Week 3 L2: HTML + JS. */
const COUNTER = {
  title: "Practice: a working counter",
  type: "sandpack",
  starterCode: {
    "/index.html": '<script src="app.js"></script>',
    "/app.js": "// TODO",
  },
};

describe("resource type discrimination", () => {
  it("separates sandpack entries from link entries", () => {
    expect(isSandpackResource(SKELETON)).toBe(true);
    expect(isSandpackResource(W3_LINK)).toBe(false);
    expect(isLinkResource(W3_LINK)).toBe(true);
    expect(isLinkResource(SKELETON)).toBe(false);
  });

  it("treats anything that is not an object as neither", () => {
    for (const value of [null, undefined, 0, "sandpack", [], true]) {
      expect(isSandpackResource(value)).toBe(false);
      expect(isLinkResource(value)).toBe(false);
    }
  });

  it("reports whether a lecture offers in-app practice", () => {
    expect(hasSandpackResources([W3_LINK, SKELETON])).toBe(true);
    expect(hasSandpackResources([W3_LINK, W3_LINK])).toBe(false);
    expect(hasSandpackResources(null)).toBe(false);
    expect(hasSandpackResources({ not: "an array" })).toBe(false);
    expect(countSandpackResources([W3_LINK, SKELETON, COUNTER])).toBe(2);
  });
});

describe("file paths and languages", () => {
  it("maps extensions to editor languages, unknown ones to text", () => {
    expect(languageForPath("/index.html")).toBe("html");
    expect(languageForPath("/styles.css")).toBe("css");
    expect(languageForPath("/app.js")).toBe("javascript");
    expect(languageForPath("/data.json")).toBe("json");
    expect(languageForPath("/notes.md")).toBe("markdown");
    expect(languageForPath("/mystery.wat")).toBe("text");
    expect(languageForPath("/Makefile")).toBe("text");
    expect(extensionOf("/a/b/c.HTML")).toBe("html");
  });

  it("normalises keys into absolute sandbox paths", () => {
    expect(normaliseFilePath("/index.html")).toBe("/index.html");
    expect(normaliseFilePath("index.html")).toBe("/index.html");
    expect(normaliseFilePath("./index.html")).toBe("/index.html");
    expect(normaliseFilePath("src\\app.js")).toBe("/src/app.js");
    expect(normaliseFilePath("  /a.css  ")).toBe("/a.css");
  });

  it("rejects keys that cannot be files", () => {
    expect(normaliseFilePath("")).toBeNull();
    expect(normaliseFilePath("   ")).toBeNull();
    expect(normaliseFilePath("/")).toBeNull();
    expect(normaliseFilePath("/dir/")).toBeNull();
    expect(normaliseFilePath("../../etc/passwd")).toBeNull();
  });

  it("orders tabs HTML, CSS, JS, then alphabetically", () => {
    expect(orderFilePaths(["/app.js", "/styles.css", "/index.html"])).toEqual([
      "/index.html",
      "/styles.css",
      "/app.js",
    ]);
    expect(orderFilePaths(["/b.css", "/a.css"])).toEqual(["/a.css", "/b.css"]);
  });
});

describe("normaliseStarterCode — the malformed cases", () => {
  it("rejects a missing starterCode", () => {
    const result = normaliseStarterCode(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no starter code/i);
  });

  it("rejects null, arrays, strings and numbers", () => {
    for (const value of [null, [], ["/index.html"], "<!DOCTYPE html>", 42]) {
      expect(normaliseStarterCode(value).ok).toBe(false);
    }
  });

  it("rejects an empty object", () => {
    const result = normaliseStarterCode({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/i);
  });

  it("rejects an object whose every value is unusable", () => {
    const result = normaliseStarterCode({ "/index.html": 123, "": "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no usable files/i);
  });

  it("skips non-string values but keeps the rest, with a warning", () => {
    const result = normaliseStarterCode({
      "/index.html": "<h1>hi</h1>",
      "/broken.css": { nested: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.files)).toEqual(["/index.html"]);
    expect(result.value.warnings.join(" ")).toMatch(/not text/i);
  });

  it("keeps an unknown extension as editable text and says so", () => {
    const result = normaliseStarterCode({
      "/index.html": "<h1>hi</h1>",
      "/notes.wat": "hello",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files["/notes.wat"]).toBe("hello");
    expect(result.value.warnings.join(" ")).toMatch(/cannot run/i);
  });

  it("synthesises an entry document when no HTML file is supplied", () => {
    const result = normaliseStarterCode({ "/styles.css": "body { color: red; }" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files[ENTRY_FILE]).toContain('href="styles.css"');
    expect(result.value.activeFile).toBe(ENTRY_FILE);
    expect(result.value.warnings.join(" ")).toMatch(/generated/i);
  });

  it("links CSS and scripts JS in the synthesised entry document", () => {
    const result = normaliseStarterCode({ "/app.js": "console.log(1);" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files[ENTRY_FILE]).toContain('src="app.js"');
  });
});

describe("normaliseStarterCode — the seeded cases", () => {
  it("mounts the single-file HTML skeleton with index.html active", () => {
    const result = normaliseStarterCode(SKELETON.starterCode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibleFiles).toEqual(["/index.html"]);
    expect(result.value.activeFile).toBe("/index.html");
    expect(result.value.warnings).toEqual([]);
  });

  it("mounts the HTML+CSS Flexbox exercise with both tabs, HTML first", () => {
    const result = normaliseStarterCode(FLEXBOX.starterCode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibleFiles).toEqual(["/index.html", "/styles.css"]);
    expect(result.value.warnings).toEqual([]);
  });

  it("mounts the HTML+JS counter exercise", () => {
    const result = normaliseStarterCode(COUNTER.starterCode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibleFiles).toEqual(["/index.html", "/app.js"]);
  });

  it("accepts slash-less keys the same way (admin-authored exercises)", () => {
    const result = normaliseStarterCode({ "index.html": "<h1>hi</h1>" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files["/index.html"]).toBe("<h1>hi</h1>");
    expect(result.value.warnings.join(" ")).toMatch(/renamed/i);
  });
});

describe("parseLectureIdParam", () => {
  it("accepts a positive integer segment", () => {
    expect(parseLectureIdParam("7")).toBe(7);
    expect(parseLectureIdParam(["7", "8"])).toBe(7);
  });

  it("rejects anything that would reach the database as NaN", () => {
    for (const value of ["", "0", "-1", "1.5", "abc", "7abc", " 7", undefined]) {
      expect(parseLectureIdParam(value as string | undefined)).toBeNull();
    }
  });
});

describe("parseSandpackResources", () => {
  it("returns only the sandpack entries, never the links", () => {
    const entries = parseSandpackResources(7, [W3_LINK, W3_LINK, FLEXBOX]);
    expect(entries).toHaveLength(1);
    expect(entries[0].ok).toBe(true);
    if (entries[0].ok) {
      expect(entries[0].exercise.title).toBe(FLEXBOX.title);
      // Index is the position in the ORIGINAL array, so adding a link upstream
      // does not renumber existing exercise ids.
      expect(entries[0].exercise.id).toBe("7-2");
      expect(entries[0].exercise.lectureId).toBe(7);
    }
  });

  it("returns an empty array for null, non-arrays and empty arrays", () => {
    expect(parseSandpackResources(1, null)).toEqual([]);
    expect(parseSandpackResources(1, undefined)).toEqual([]);
    expect(parseSandpackResources(1, {})).toEqual([]);
    expect(parseSandpackResources(1, "resources")).toEqual([]);
    expect(parseSandpackResources(1, [])).toEqual([]);
  });

  it("survives an array containing null and junk entries", () => {
    const entries = parseSandpackResources(1, [null, 5, "x", SKELETON, undefined]);
    expect(entries).toHaveLength(1);
    expect(entries[0].ok).toBe(true);
  });

  it("reports a malformed exercise instead of throwing", () => {
    const entries = parseSandpackResources(3, [
      { title: "Broken", type: "sandpack" },
      { title: "Also broken", type: "sandpack", starterCode: {} },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => !e.ok)).toBe(true);
    if (!entries[0].ok) {
      expect(entries[0].problem.title).toBe("Broken");
      expect(entries[0].problem.reason).toBeTruthy();
    }
    expect(usableExercises(entries)).toEqual([]);
  });

  it("falls back to a generic title when the title is missing or blank", () => {
    const entries = parseSandpackResources(1, [
      { type: "sandpack", starterCode: SKELETON.starterCode },
      { title: "   ", type: "sandpack", starterCode: SKELETON.starterCode },
    ]);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.ok).toBe(true);
      if (entry.ok) expect(entry.exercise.title).toBe("Practice exercise");
    }
  });

  it("keeps good exercises when a sibling is malformed", () => {
    const entries = parseSandpackResources(9, [
      { title: "Broken", type: "sandpack", starterCode: null },
      COUNTER,
    ]);
    expect(usableExercises(entries)).toHaveLength(1);
    expect(entries.filter((e) => !e.ok)).toHaveLength(1);
  });

  it("exposes normalisation warnings as diagnostics", () => {
    const entries = parseSandpackResources(1, [
      { title: "Odd", type: "sandpack", starterCode: { "styles.css": "a{}" } },
    ]);
    expect(entries[0].ok).toBe(true);
    if (!entries[0].ok) return;
    const diagnostics = warningsAsDiagnostics(entries[0].exercise);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity === "warning")).toBe(true);
  });
});
