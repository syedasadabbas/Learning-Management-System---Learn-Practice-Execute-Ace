import { describe, expect, it } from "vitest";

import { diagnoseFiles, referencedAssets } from "./diagnostics";

/** Valid markup that references nothing, so it can stand alone in a file set. */
const okHtml = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  '  <head><meta charset="utf-8" /></head>',
  "  <body><div><p>hello</p></div></body>",
  "</html>",
].join("\n");

/** The same page as the seeded Flexbox exercise: it pulls in a stylesheet. */
const okHtmlWithStylesheet = okHtml.replace(
  "</head>",
  '<link rel="stylesheet" href="styles.css" /></head>',
);

describe("diagnoseFiles", () => {
  it("is silent on a well-formed file set", () => {
    expect(
      diagnoseFiles({
        "/index.html": okHtmlWithStylesheet,
        "/styles.css": ".a { color: red; }",
      }),
    ).toEqual([]);
  });

  it("never throws on junk input", () => {
    for (const value of [null, undefined, 42, "files", [], [1, 2]]) {
      expect(diagnoseFiles(value)).toEqual([]);
    }
    expect(diagnoseFiles({ "/index.html": 7 })).toEqual([]);
  });

  it("reports a file set with no HTML page to preview", () => {
    const out = diagnoseFiles({ "/styles.css": ".a {}" });
    expect(out[0].severity).toBe("error");
    expect(out[0].message).toMatch(/no HTML page/i);
  });

  it("catches an unbalanced brace in CSS", () => {
    const out = diagnoseFiles({ "/index.html": okHtml, "/styles.css": ".a { color: red;" });
    expect(out.some((d) => d.severity === "error" && /curly brace/.test(d.message))).toBe(true);
  });

  it("catches an unbalanced bracket in JavaScript", () => {
    const out = diagnoseFiles({
      "/index.html": okHtml,
      "/app.js": "document.querySelector('#x'.addEventListener('click', () => {});",
    });
    expect(out.some((d) => d.severity === "error")).toBe(true);
  });

  it("ignores braces inside strings and comments", () => {
    const out = diagnoseFiles({
      "/index.html": okHtml,
      "/app.js": "const s = '{{{'; // }}} not real\n/* { */\nconsole.log(s);",
    });
    expect(out).toEqual([]);
  });

  it("catches an unterminated block comment", () => {
    const out = diagnoseFiles({ "/index.html": okHtml, "/styles.css": "/* oops" });
    expect(out.some((d) => /never closed/.test(d.message))).toBe(true);
  });

  it("catches an unterminated string", () => {
    const out = diagnoseFiles({ "/index.html": okHtml, "/app.js": "const a = 'oops;" });
    expect(out.some((d) => /quote is opened/.test(d.message))).toBe(true);
  });

  it("warns about an unclosed container tag", () => {
    const out = diagnoseFiles({ "/index.html": "<html><body><div><p>hi</p></body></html>" });
    expect(out.some((d) => d.severity === "warning" && /<div>/.test(d.message))).toBe(true);
  });

  it("does not count commented-out or self-closed tags as unclosed", () => {
    const out = diagnoseFiles({
      "/index.html": "<html><body><!-- <div> --><br /><img src='data:,' /></body></html>",
    });
    expect(out).toEqual([]);
  });

  it("reports a stylesheet or script that points at a missing file", () => {
    const out = diagnoseFiles({
      "/index.html": '<html><body><script src="app.js"></script></body></html>',
    });
    expect(out.some((d) => d.severity === "error" && /app\.js/.test(d.message))).toBe(true);
  });

  it("accepts a reference that does resolve, in either spelling", () => {
    expect(
      diagnoseFiles({
        "/index.html": '<html><body><script src="./app.js"></script></body></html>',
        "/app.js": "",
      }),
    ).toEqual([]);
  });

  it("ignores external and data references", () => {
    expect(
      diagnoseFiles({
        "/index.html":
          '<html><head><link rel="stylesheet" href="https://cdn.example/a.css" /></head><body></body></html>',
      }),
    ).toEqual([]);
  });

  it("sorts errors ahead of warnings", () => {
    const out = diagnoseFiles({
      "/index.html": "<html><body><div></body></html>",
      "/styles.css": ".a {",
    });
    const firstWarning = out.findIndex((d) => d.severity === "warning");
    const lastError = out.map((d) => d.severity).lastIndexOf("error");
    expect(lastError).toBeLessThan(firstWarning);
  });
});

describe("referencedAssets", () => {
  it("finds link hrefs and script srcs", () => {
    expect(referencedAssets(okHtmlWithStylesheet)).toEqual(["styles.css"]);
    expect(referencedAssets('<script src="a.js"></script><script src="b.js"></script>')).toEqual([
      "a.js",
      "b.js",
    ]);
  });

  it("returns nothing for markup with no assets", () => {
    expect(referencedAssets("<h1>hi</h1>")).toEqual([]);
  });
});

describe("diagnoseFiles accepts Sandpack's file shape", () => {
  const broken = "<!DOCTYPE html><html><body><div></body></html>";

  it("flags an unclosed tag when values are { code } objects", () => {
    // Guard, not a regression test: Sandpack's file map is { code }, and the
    // `files: unknown` signature invites a caller to pass it straight through.
    const out = diagnoseFiles({ "/index.html": { code: broken } });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].message).toContain("<div>");
  });

  it("still accepts plain strings", () => {
    expect(diagnoseFiles({ "/index.html": broken }).length).toBeGreaterThan(0);
  });

  it("ignores values that are neither", () => {
    expect(diagnoseFiles({ "/index.html": 42 })).toEqual([]);
  });
});
