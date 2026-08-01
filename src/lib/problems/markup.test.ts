// =============================================================================
// MARKUP GRADING — unit tests. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// What is asserted here, and why each one is worth a test rather than a comment:
//
//   1. THE BUNDLE ROUND-TRIPS. A CSS problem's starter is several files squeezed
//      into one text column, and the join/split pair is the only thing standing
//      between that and a student's stylesheet being graded as HTML.
//   2. UNPARSEABLE REQUIREMENTS ARE KEPT, NOT DROPPED. A dropped line shrinks the
//      requirement list, and a test with no requirements passes everyone. This is
//      the property validate.ts leans on.
//   3. THE SCANNER'S KNOWN-HARD CASES. Commented-out tags must not count; a quoted
//      attribute value containing ">" must not split a tag in two; a declaration
//      inside @media must still be attributed to its selector. Each of these is a
//      place where the tolerant scanner could plausibly be wrong, so each is
//      pinned.
//   4. THE STATED LIMITS ARE REAL. Two tests deliberately assert the grader's
//      BLIND SPOTS (an equally valid alternative answer fails; nesting is not
//      checked). They exist so that nobody reads markup.ts's "limits" comment as
//      defensive hedging — the limits are executable, and if a future parser
//      upgrade closes one, the test fails and the comment gets corrected with it.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  checkOne,
  describeCheck,
  evaluateMarkupTest,
  indexMarkup,
  isMarkupLanguage,
  joinMarkupBundle,
  normaliseDeclarationValue,
  normaliseSelector,
  orderBundlePaths,
  parseMarkupAssertions,
  scanCssRules,
  scanElements,
  scanVisibleText,
  splitMarkupBundle,
  summariseResults,
  type MarkupCheck,
} from "./markup";
import { comparisonModeFor, gradeMarkupTest, requiresServerRuntime } from "./grading";

// ---------------------------------------------------------------------------
// Language identification
// ---------------------------------------------------------------------------

describe("isMarkupLanguage", () => {
  it("accepts html and css in any casing, with surrounding space", () => {
    for (const value of ["html", "HTML", " css ", "Css"]) {
      expect(isMarkupLanguage(value), value).toBe(true);
    }
  });

  it("rejects everything the execution allow-list owns", () => {
    for (const value of ["javascript", "python", "c", "cpp", "sql", "", null, undefined, 7]) {
      expect(isMarkupLanguage(value), String(value)).toBe(false);
    }
  });

  it("drives the comparison mode, so no markup problem is ever text-compared", () => {
    expect(comparisonModeFor("html")).toBe("markup");
    expect(comparisonModeFor("css")).toBe("markup");
    expect(comparisonModeFor("javascript")).toBe("text");
    expect(comparisonModeFor("sqlite")).toBe("sql");
  });
});

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

describe("splitMarkupBundle / joinMarkupBundle", () => {
  it("treats a delimiter-free string as one file named from the language", () => {
    expect(splitMarkupBundle("<h1>Hi</h1>", "html")).toEqual({ "/index.html": "<h1>Hi</h1>" });
    expect(splitMarkupBundle(".a { color: red }", "css")).toEqual({
      "/styles.css": ".a { color: red }",
    });
  });

  it("splits on both comment syntaxes", () => {
    const bundle = [
      "<!-- file: /index.html -->",
      "<div class=\"card\"></div>",
      "/* file: /styles.css */",
      ".card { color: red; }",
    ].join("\n");

    expect(splitMarkupBundle(bundle, "css")).toEqual({
      "/index.html": '<div class="card"></div>',
      "/styles.css": ".card { color: red; }",
    });
  });

  it("round-trips a multi-file bundle", () => {
    const files = {
      "/index.html": "<p>one</p>",
      "/styles.css": "p { margin: 0; }",
    };
    expect(splitMarkupBundle(joinMarkupBundle(files), "css")).toEqual(files);
  });

  it("emits a single file with no delimiter, so the common case stores what was typed", () => {
    expect(joinMarkupBundle({ "/index.html": "<p>x</p>" })).toBe("<p>x</p>");
  });

  it("keeps text written above the first delimiter instead of discarding it", () => {
    const bundle = ["<p>stray</p>", "/* file: /styles.css */", "p { color: red }"].join("\n");
    const files = splitMarkupBundle(bundle, "html");
    expect(files["/index.html"]).toBe("<p>stray</p>");
    expect(files["/styles.css"]).toBe("p { color: red }");
  });

  it("never loses the submission to an unusable delimiter path", () => {
    // "../secret" cannot be a sandbox path, so the line is content, not a header.
    const bundle = "<!-- file: ../secret -->\n<p>kept</p>";
    expect(splitMarkupBundle(bundle, "html")["/index.html"]).toContain("<p>kept</p>");
  });

  it("orders HTML before CSS before everything else", () => {
    expect(orderBundlePaths(["/z.txt", "/styles.css", "/index.html", "/app.js"])).toEqual([
      "/index.html",
      "/styles.css",
      "/app.js",
      "/z.txt",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The assertion grammar
// ---------------------------------------------------------------------------

describe("parseMarkupAssertions", () => {
  it("ignores blank lines and # comments", () => {
    const assertions = parseMarkupAssertions("# the document\n\ntag h1\n");
    expect(assertions).toHaveLength(1);
    expect(assertions[0].check).toEqual({ kind: "tag", tag: "h1", min: 1 });
  });

  it("parses every kind", () => {
    const parsed = parseMarkupAssertions(
      [
        "tag li >= 3",
        "no-tag font",
        "attr html lang",
        'attr img alt=""',
        "attr meta charset=utf-8",
        "text Cohort notes",
        "selector .card",
        "declares .nav ul | display: flex",
        "declares .card | margin-inline",
      ].join("\n"),
    ).map((a) => a.check);

    expect(parsed).toEqual<MarkupCheck[]>([
      { kind: "tag", tag: "li", min: 3 },
      { kind: "no-tag", tag: "font" },
      { kind: "attr", tag: "html", attr: "lang", value: null },
      { kind: "attr", tag: "img", attr: "alt", value: "" },
      { kind: "attr", tag: "meta", attr: "charset", value: "utf-8" },
      { kind: "text", needle: "Cohort notes" },
      { kind: "selector", selector: ".card" },
      { kind: "declares", selector: ".nav ul", property: "display", value: "flex" },
      { kind: "declares", selector: ".card", property: "margin-inline", value: null },
    ]);
  });

  it("KEEPS an unreadable line rather than dropping it", () => {
    // The property validate.ts depends on: a typo must be visible, because a
    // silently shortened requirement list marks every student correct.
    const assertions = parseMarkupAssertions("tag h1\nlint everything\ntag p");
    expect(assertions).toHaveLength(3);
    expect(assertions[1].check).toBeNull();
    expect(assertions[1].error).toMatch(/not a requirement keyword/);
  });

  it("rejects a malformed count and a zero count", () => {
    expect(parseMarkupAssertions("tag li >= 0")[0].error).toMatch(/at least 1/);
    expect(parseMarkupAssertions("tag")[0].check).toBeNull();
    expect(parseMarkupAssertions("declares .card display: flex")[0].error).toMatch(/\|/);
  });

  it("describes each check in a sentence a student can act on", () => {
    expect(describeCheck({ kind: "attr", tag: "img", attr: "alt", value: "" })).toBe(
      "a <img> element sets alt to an empty value",
    );
    expect(describeCheck({ kind: "tag", tag: "li", min: 3 })).toBe(
      "the document contains at least 3 <li> elements",
    );
  });
});

// ---------------------------------------------------------------------------
// The scanner's hard cases
// ---------------------------------------------------------------------------

describe("scanElements", () => {
  it("does not count a commented-out element", () => {
    const elements = scanElements("<!-- <h1>not really</h1> -->\n<h2>real</h2>");
    expect(elements.map((e) => e.name)).toEqual(["h2"]);
  });

  it("keeps a quoted attribute value containing '>' in one tag", () => {
    // The naive /<([a-z]+)[^>]*>/ splits this and invents an element. Pinning it
    // because a title or an aria-label containing "->" is ordinary content.
    const [element, ...rest] = scanElements('<a href="/x" title="a > b">link</a>');
    expect(element.name).toBe("a");
    expect(element.attributes.title).toBe("a > b");
    expect(rest.map((e) => e.name)).toEqual([]);
  });

  it("records a valueless boolean attribute as an empty string", () => {
    const [element] = scanElements("<input required>");
    expect(element.attributes).toHaveProperty("required", "");
  });

  it("lower-cases element and attribute names but not values", () => {
    const [element] = scanElements('<IMG SRC="Photo.JPG" ALT="A Student" />');
    expect(element.name).toBe("img");
    expect(element.attributes.alt).toBe("A Student");
  });
});

describe("scanVisibleText", () => {
  it("excludes script and style bodies", () => {
    const text = scanVisibleText(
      "<style>.a { color: flex }</style><script>var flex = 1;</script><p>Hello there</p>",
    );
    expect(text).toBe("Hello there");
  });
});

describe("scanCssRules", () => {
  it("attributes a declaration inside @media to its own selector", () => {
    const [rule] = scanCssRules("@media (min-width: 40em) { .card { display: grid; } }");
    expect(rule.selectors).toEqual([".card"]);
    expect(rule.declarations).toEqual([{ property: "display", value: "grid" }]);
  });

  it("splits a selector list and normalises combinator spacing", () => {
    const [rule] = scanCssRules(".a>.b , .c { color: red; }");
    expect(rule.selectors).toEqual([".a > .b", ".c"]);
  });

  it("ignores commented-out declarations", () => {
    const [rule] = scanCssRules(".a { /* display: flex; */ color: red; }");
    expect(rule.declarations).toEqual([{ property: "color", value: "red" }]);
  });

  it("normalises values case-insensitively and drops !important", () => {
    expect(normaliseDeclarationValue("  AUTO !important ;")).toBe("auto");
    expect(normaliseSelector(".a   >   .b")).toBe(".a > .b");
  });
});

// ---------------------------------------------------------------------------
// Checking a whole submission
// ---------------------------------------------------------------------------

const SKELETON = {
  "/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cohort notes</title>
  </head>
  <body>
    <h1>Cohort notes</h1>
    <p>Written down before I forget it.</p>
  </body>
</html>`,
};

describe("evaluateMarkupTest", () => {
  it("passes when every requirement holds", () => {
    const outcome = evaluateMarkupTest(
      SKELETON,
      parseMarkupAssertions(
        ["attr html lang", "attr meta charset=utf-8", "tag h1", "text Cohort notes"].join("\n"),
      ),
    );
    expect(outcome.passed).toBe(true);
    expect(outcome.results.every((r) => r.met)).toBe(true);
  });

  it("fails with a reason attached to the requirement that did not hold", () => {
    const outcome = evaluateMarkupTest(
      SKELETON,
      parseMarkupAssertions("tag h1 >= 2\nattr html dir"),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.results[0].detail).toBe("found 1.");
    expect(outcome.results[1].detail).toMatch(/no <html> sets dir/);
  });

  it("FAILS a test that declares no requirements — a content bug is not a pass", () => {
    const outcome = evaluateMarkupTest(SKELETON, []);
    expect(outcome.passed).toBe(false);
    expect(outcome.results[0].detail).toMatch(/content bug/);
  });

  it("fails an unreadable requirement and says whose fault it is", () => {
    const outcome = evaluateMarkupTest(SKELETON, parseMarkupAssertions("lint everything"));
    expect(outcome.passed).toBe(false);
    expect(outcome.results[0].detail).toMatch(/not your mistake/);
  });

  it("reads a stylesheet out of a <style> block as well as a .css file", () => {
    const inline = indexMarkup({ "/index.html": "<style>.card { display: flex }</style>" });
    const separate = indexMarkup({ "/styles.css": ".card { display: flex }" });
    const check: MarkupCheck = {
      kind: "declares",
      selector: ".card",
      property: "display",
      value: "flex",
    };
    expect(checkOne(inline, check).met).toBe(true);
    expect(checkOne(separate, check).met).toBe(true);
  });

  it("renders the outcome as an ASCII checklist for the diff pane", () => {
    const outcome = evaluateMarkupTest(SKELETON, parseMarkupAssertions("tag h1\ntag table"));
    expect(summariseResults(outcome.results)).toBe(
      "[x] the document contains a <h1> element\n" +
        "[ ] the document contains a <table> element — found 0.",
    );
  });
});

// ---------------------------------------------------------------------------
// The limits, asserted so they cannot be quietly overstated
// ---------------------------------------------------------------------------

describe("documented blind spots", () => {
  it("marks an equally valid alternative answer WRONG when it is not the one asked for", () => {
    // The grader checks for the construct the problem named. A card centred with
    // `display: grid; place-items: center` is correct CSS and fails a requirement
    // written for `margin-inline: auto`. This is the cost of option 4 in markup.ts,
    // and the mitigation is content-side: only problems whose requirement can be
    // stated objectively were converted to graded.
    const files = { "/styles.css": ".card { display: grid; place-items: center; }" };
    const outcome = evaluateMarkupTest(
      files,
      parseMarkupAssertions("declares .card | margin-inline: auto"),
    );
    expect(outcome.passed).toBe(false);
  });

  it("cannot see nesting: a <li> outside any list still satisfies `tag li`", () => {
    // Stated in markup.ts as the reason nesting is absent from the vocabulary
    // rather than present and unreliable. If a parser upgrade ever makes this
    // assertion fail, the comment is the thing to fix.
    const outcome = evaluateMarkupTest(
      { "/index.html": "<div><li>orphan</li></div>" },
      parseMarkupAssertions("tag li"),
    );
    expect(outcome.passed).toBe(true);
  });

  it("cannot see a media condition: a rule inside @media satisfies a plain requirement", () => {
    const outcome = evaluateMarkupTest(
      { "/styles.css": "@media print { .card { display: grid } }" },
      parseMarkupAssertions("declares .card | display: grid"),
    );
    expect(outcome.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The bridge into the shared grading shapes
// ---------------------------------------------------------------------------

describe("gradeMarkupTest", () => {
  it("produces the same GradedTest shape the executed path produces", () => {
    const graded = gradeMarkupTest(
      { name: "structure", input: null, expectedOutput: "tag h1\ntag p", hidden: true },
      SKELETON,
    );
    expect(graded).toMatchObject({ name: "structure", hidden: true, passed: true });
    expect(graded.expected).toContain("<h1>");
    expect(graded.actual).toContain("[x]");
  });
});

// ---------------------------------------------------------------------------
// The gating predicate — Item 3
// ---------------------------------------------------------------------------

describe("requiresServerRuntime", () => {
  it("is false for a reference-only problem: there is nothing to gate", () => {
    expect(requiresServerRuntime("cpp", "none")).toBe(false);
    expect(requiresServerRuntime("html", "none")).toBe(false);
  });

  it("is false for markup: a Piston outage must not hide the editor", () => {
    expect(requiresServerRuntime("html", "browser")).toBe(false);
    expect(requiresServerRuntime("css", "browser")).toBe(false);
  });

  it("is false for a language with a real in-browser runtime", () => {
    expect(requiresServerRuntime("javascript", "browser")).toBe(false);
    expect(requiresServerRuntime("python", "browser")).toBe(false);
    expect(requiresServerRuntime("sql", "browser")).toBe(false);
  });

  it("is true for anything declaring piston, browser backend or not", () => {
    expect(requiresServerRuntime("javascript", "piston")).toBe(true);
    expect(requiresServerRuntime("cpp", "piston")).toBe(true);
  });

  it("IS TRUE for a compiled language mis-declared as browser — the latent bug", () => {
    // The old gate (`execution === "piston"`) answered false here, which is what
    // produced a Run button whose every click returned backend_unavailable.
    expect(requiresServerRuntime("c", "browser")).toBe(true);
    expect(requiresServerRuntime("cpp", "browser")).toBe(true);
    // Java and TypeScript are on the execution allow-list but are NOT problem
    // tracks, so no seeded problem can reach this branch through them today. The
    // predicate covers them because it asks the allow-list, not a track list.
    expect(requiresServerRuntime("java", "browser")).toBe(true);
    expect(requiresServerRuntime("typescript", "browser")).toBe(true);
  });

  it("is true for a language nothing recognises, which is the safe answer", () => {
    // An unknown language has no browser backend by definition, so the honest
    // rendering is "server needed" — and Submit will report unsupported_language
    // rather than pretending to grade.
    expect(requiresServerRuntime("cobol", "browser")).toBe(true);
  });
});
