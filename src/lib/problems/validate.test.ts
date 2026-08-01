// =============================================================================
// UNIT TESTS — seed-catalogue validation. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// Synthetic fixtures only. `catalogue.test.ts` runs the same validator against the
// REAL seed content, so a broken problem fails `npm test` rather than failing
// halfway through an INSERT against a live database.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  assertValidCatalogue,
  catalogueCounts,
  validateCatalogue,
  withOrderIndexes,
  type SeedProblem,
} from "./validate";

const GOOD: SeedProblem = {
  slug: "js-two-sum-pairs",
  title: "Pairs that reach a target",
  statement: "Read a target and a list of integers; print how many pairs sum to it.",
  track: "javascript",
  level: "beginner",
  isInterview: false,
  language: "javascript",
  starterCode: "// read stdin, print a count\n",
  referenceSolution: "// worked answer\n",
  hints: ["A hash map turns the inner loop into a lookup."],
  tags: ["hash-map"],
  execution: "browser",
  timeLimitMs: 5000,
  tests: [
    { name: "example", input: "6\n1 5 3 3", expectedOutput: "2", hidden: false },
    { name: "no pairs", input: "100\n1 2", expectedOutput: "0", hidden: true },
  ],
};

const REFERENCE_ONLY: SeedProblem = {
  slug: "css-centre-a-card",
  title: "Centre a card",
  statement: "Write the rules that centre a fixed-width card in the viewport.",
  track: "css",
  level: "beginner",
  isInterview: false,
  language: "css",
  starterCode: ".card { }\n",
  referenceSolution: ".card { margin-inline: auto; }\n",
  hints: ["Think about which axis the block layout already handles."],
  tags: ["layout"],
  execution: "none",
  tests: [],
};

function messagesFor(problem: Partial<SeedProblem>): string[] {
  return validateCatalogue([{ ...GOOD, ...problem }]).map((e) => e.message);
}

describe("validateCatalogue — accepts valid content", () => {
  it("passes an executable problem and a reference-only problem", () => {
    expect(validateCatalogue([GOOD, REFERENCE_ONLY])).toEqual([]);
  });

  it("accepts a language spelling the execution allow-list knows by alias", () => {
    expect(messagesFor({ language: "py", tests: GOOD.tests })).toEqual([]);
  });
});

describe("validateCatalogue — slugs", () => {
  it("rejects a duplicate slug, because the slug is the route key", () => {
    const errors = validateCatalogue([GOOD, { ...GOOD, title: "Copy" }]);
    expect(errors.map((e) => e.message).join(" ")).toMatch(/duplicates problem #0/);
  });

  it("rejects a slug that is not URL-safe", () => {
    expect(messagesFor({ slug: "JS Two Sum" }).join(" ")).toMatch(/lowercase alphanumeric/);
    expect(messagesFor({ slug: "js--two-sum" }).join(" ")).toMatch(/lowercase alphanumeric/);
    expect(messagesFor({ slug: "-leading" }).join(" ")).toMatch(/lowercase alphanumeric/);
  });

  it("rejects an empty slug", () => {
    expect(messagesFor({ slug: "  " })).toContain("slug is empty.");
  });
});

describe("validateCatalogue — tests", () => {
  it("rejects an executable problem with no visible test", () => {
    expect(
      messagesFor({ tests: [{ name: "only hidden", input: "", expectedOutput: "0", hidden: true }] }).join(" "),
    ).toMatch(/no visible test/);
  });

  it("rejects an executable problem with no hidden test", () => {
    expect(
      messagesFor({ tests: [{ name: "only visible", input: "", expectedOutput: "0", hidden: false }] }).join(" "),
    ).toMatch(/no hidden test/);
  });

  it("rejects tests on a reference-only problem", () => {
    expect(
      validateCatalogue([{ ...REFERENCE_ONLY, tests: GOOD.tests }]).map((e) => e.message).join(" "),
    ).toMatch(/nothing would ever run them/);
  });

  it("rejects two tests with the same name", () => {
    expect(
      messagesFor({
        tests: [
          { name: "same", input: "", expectedOutput: "1", hidden: false },
          { name: "same", input: "", expectedOutput: "2", hidden: true },
        ],
      }).join(" "),
    ).toMatch(/both named "same"/);
  });
});

describe("validateCatalogue — content requirements", () => {
  it("requires a reference solution on every problem", () => {
    expect(messagesFor({ referenceSolution: "" }).join(" ")).toMatch(/referenceSolution is empty/);
  });

  it("requires at least one hint", () => {
    expect(messagesFor({ hints: [] }).join(" ")).toMatch(/hints is empty/);
    expect(messagesFor({ hints: ["  "] }).join(" ")).toMatch(/empty or non-string/);
  });

  it("requires at least one tag", () => {
    expect(messagesFor({ tags: [] }).join(" ")).toMatch(/tags is empty/);
  });

  it("requires a non-empty statement and title", () => {
    expect(messagesFor({ statement: " " })).toContain("statement is empty.");
    expect(messagesFor({ title: "" })).toContain("title is empty.");
  });

  it("rejects an unknown track or level", () => {
    expect(messagesFor({ track: "rust" as never }).join(" ")).toMatch(/not an allow-listed track/);
    expect(messagesFor({ level: "expert" as never }).join(" ")).toMatch(/not a proficiency level/);
  });
});

describe("validateCatalogue — executability", () => {
  it("rejects an executable problem whose language no runtime accepts", () => {
    // A language nothing recognises: a Run button that can only ever return
    // unsupported_language. Note this is no longer demonstrated with "html" — since
    // 2026-07-31 HTML and CSS ARE legitimately executable (graded by structural
    // assertion, not by a runtime), so the fixture has to use a language that is
    // genuinely on neither list. See the markup rules below.
    expect(messagesFor({ language: "cobol" }).join(" ")).toMatch(
      /not on the execution allow-list/,
    );
  });

  // -------------------------------------------------------------------------
  // Markup problems, and the compiled-language gating rule. Added 2026-07-31.
  // -------------------------------------------------------------------------

  it("accepts an executable markup problem whose tests carry readable requirements", () => {
    expect(
      messagesFor({
        track: "html",
        language: "html",
        execution: "browser",
        starterCode: "<html></html>\n",
        tests: [
          { name: "example", input: null, expectedOutput: "attr html lang", hidden: false },
          { name: "hidden", input: null, expectedOutput: "tag title", hidden: true },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects a markup problem routed to Piston, which has no HTML runtime", () => {
    expect(
      messagesFor({
        track: "html",
        language: "html",
        execution: "piston",
        tests: [
          { name: "example", input: null, expectedOutput: "tag h1", hidden: false },
          { name: "hidden", input: null, expectedOutput: "tag p", hidden: true },
        ],
      }).join(" "),
    ).toMatch(/graded by structural assertion/);
  });

  it("rejects a markup test whose requirement cannot be read", () => {
    // The rule that stops a typo from shrinking a requirement list to nothing and
    // marking every student correct.
    expect(
      messagesFor({
        track: "css",
        language: "css",
        execution: "browser",
        starterCode: ".card { }\n",
        tests: [
          { name: "example", input: null, expectedOutput: "declaers .card | gap", hidden: false },
          { name: "hidden", input: null, expectedOutput: "selector .card", hidden: true },
        ],
      }).join(" "),
    ).toMatch(/unreadable requirement/);
  });

  it("rejects a markup test with no requirements at all", () => {
    expect(
      messagesFor({
        track: "css",
        language: "css",
        execution: "browser",
        starterCode: ".card { }\n",
        tests: [
          { name: "example", input: null, expectedOutput: "# only a comment", hidden: false },
          { name: "hidden", input: null, expectedOutput: "selector .card", hidden: true },
        ],
      }).join(" "),
    ).toMatch(/declares no requirements/);
  });

  it("REJECTS a compiled language declaring a browser practice loop — the latent bug", () => {
    // C and C++ have `browserBackend: null`, so "browser" here promises a free local
    // Run that resolves to Piston anyway and fails outright during an outage. The UI
    // now degrades correctly regardless (requiresServerRuntime in grading.ts); this
    // rule stops the row existing in the first place.
    for (const language of ["c", "cpp", "java", "typescript"]) {
      expect(
        messagesFor({ language, execution: "browser" }).join(" "),
        language,
      ).toMatch(/has no in-browser backend/);
    }
  });

  it("accepts those same languages on piston", () => {
    for (const language of ["c", "cpp"]) {
      expect(messagesFor({ language, execution: "piston" }), language).toEqual([]);
    }
  });

  it("rejects an executable problem with empty starter code", () => {
    expect(messagesFor({ starterCode: "\n  " }).join(" ")).toMatch(/starterCode is empty/);
  });

  it("rejects a time limit outside the runner's clamp range", () => {
    expect(messagesFor({ timeLimitMs: 50 }).join(" ")).toMatch(/timeLimitMs must be an integer/);
    expect(messagesFor({ timeLimitMs: 60_000 }).join(" ")).toMatch(/timeLimitMs must be an integer/);
    expect(messagesFor({ timeLimitMs: 5000 })).toEqual([]);
  });
});

describe("assertValidCatalogue", () => {
  it("is silent on valid content", () => {
    expect(() => assertValidCatalogue([GOOD, REFERENCE_ONLY])).not.toThrow();
  });

  it("throws listing every failure at once, so an author sees them all", () => {
    let message = "";
    try {
      assertValidCatalogue([{ ...GOOD, slug: "Bad Slug", hints: [] }]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/lowercase alphanumeric/);
    expect(message).toMatch(/hints is empty/);
  });
});

describe("withOrderIndexes", () => {
  it("numbers from zero within each (bank, track, level) group", () => {
    const stamped = withOrderIndexes([
      { ...GOOD, slug: "a" },
      { ...GOOD, slug: "b" },
      { ...GOOD, slug: "c", level: "intermediate" },
      { ...GOOD, slug: "d", isInterview: true },
      { ...GOOD, slug: "e", track: "python", language: "python" },
    ]);
    expect(stamped.map((p) => [p.slug, p.orderIndex])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
      ["d", 0],
      ["e", 0],
    ]);
  });
});

describe("catalogueCounts", () => {
  it("splits each track/level cell into practice and interview", () => {
    const counts = catalogueCounts([GOOD, { ...GOOD, slug: "x", isInterview: true }, REFERENCE_ONLY]);
    expect(counts.get("javascript/beginner")).toEqual({ practice: 1, interview: 1 });
    expect(counts.get("css/beginner")).toEqual({ practice: 1, interview: 0 });
  });
});
