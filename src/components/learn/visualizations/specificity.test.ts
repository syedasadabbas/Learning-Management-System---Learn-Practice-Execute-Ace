import { describe, expect, it } from "vitest";

import {
  calculateSpecificity,
  compareSpecificity,
  findWinner,
  formatSpecificity,
} from "./specificity";

/** Shorthand for the assertions below. */
function triple(selector: string): string {
  return formatSpecificity(calculateSpecificity(selector));
}

describe("calculateSpecificity", () => {
  it.each([
    ["*", "0,0,0"],
    ["li", "0,0,1"],
    ["ul li", "0,0,2"],
    ["ul ol + li", "0,0,3"],
    ["h1 + *[rel=up]", "0,1,1"],
    ["ul ol li.red", "0,1,3"],
    ["li.red.level", "0,2,1"],
    ["#x34y", "1,0,0"],
    ["#s12:not(foo)", "1,0,1"],
    [".foo :is(.bar, #baz)", "1,1,0"],
  ])("computes %s as %s", (selector, expected) => {
    // These are the worked examples from the Selectors specification itself,
    // which is the only defensible source for a teaching tool's arithmetic.
    expect(triple(selector)).toBe(expected);
  });

  it("counts :where() as zero, which is the entire reason it exists", () => {
    expect(triple(".a :where(#big, .huge)")).toBe("0,1,0");
  });

  it("counts a pseudo-element in the type column, in both spellings", () => {
    expect(triple("p::first-line")).toBe("0,0,2");
    expect(triple("p:first-line")).toBe("0,0,2");
  });

  it("counts a plain pseudo-class in the class column", () => {
    expect(triple("a:hover")).toBe("0,1,1");
    expect(triple("li:nth-child(2n + 1)")).toBe("0,1,1");
  });

  it("does not split a selector list inside :is()", () => {
    // A naive split on comma would read this as two selectors and be wrong.
    expect(triple("div:is(.a, .b)")).toBe("0,1,1");
  });

  it("returns the most specific member of a selector list", () => {
    expect(triple("h1, #main .title")).toBe("1,1,0");
  });

  it("tracks !important separately rather than folding it into the triple", () => {
    const result = calculateSpecificity("p !important");
    expect(result.important).toBe(true);
    expect(formatSpecificity(result)).toBe("0,0,1");
  });

  it("returns a zero triple for empty input", () => {
    expect(triple("")).toBe("0,0,0");
    expect(triple("   ")).toBe("0,0,0");
  });

  it("reports unrecognised characters instead of silently ignoring them", () => {
    const result = calculateSpecificity("div %% span");
    expect(result.unparsed.length).toBeGreaterThan(0);
    expect(formatSpecificity(result)).toBe("0,0,2");
  });

  it("terminates on an unbalanced parenthesis", () => {
    const result = calculateSpecificity("div:not(.a");
    expect(result.unparsed.length).toBeGreaterThan(0);
  });
});

describe("compareSpecificity", () => {
  it("compares column by column and never sums", () => {
    const oneId = calculateSpecificity("#a");
    const elevenClasses = calculateSpecificity(".a.b.c.d.e.f.g.h.i.j.k");
    // The misconception this tool exists to kill: 100 vs 110.
    expect(compareSpecificity(oneId, elevenClasses)).toBeGreaterThan(0);
  });
});

describe("findWinner", () => {
  it("gives a tie to the later entry, because source order breaks ties", () => {
    const results = [".a", ".b"].map(calculateSpecificity);
    expect(findWinner(results)).toBe(1);
  });

  it("lets !important outrank a higher triple", () => {
    const results = ["#main .title", "p !important"].map(calculateSpecificity);
    expect(findWinner(results)).toBe(1);
  });

  it("returns -1 for an empty field", () => {
    expect(findWinner([])).toBe(-1);
  });
});
