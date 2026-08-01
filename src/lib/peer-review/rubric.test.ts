// =============================================================================
// RUBRIC — parsing untrusted jsonb, and the score floor the gaming defence needs.
// -----------------------------------------------------------------------------
// `grading_rubrics.criteria` and `peer_reviews.rubric_scores` are jsonb columns
// with no shape constraint, filled from an instructor-facing form. Everything here
// is a test that a malformed blob DEGRADES rather than throws — a rubric that
// cannot be parsed must leave one page saying so, not blank the route.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  CRITERION_MAX_POINTS,
  DEFAULT_RUBRIC_CRITERIA,
  MAX_CRITERIA,
  parseRubricCriteria,
  rubricMaxTotal,
  sumRubricScores,
  toRubricScoreLines,
  validateRubricScores,
} from "./rubric";

const CRITERIA = DEFAULT_RUBRIC_CRITERIA;
const FULL_MARKS = { requirements: 5, quality: 5, presentation: 5 };

describe("the default rubric", () => {
  it("is scored out of five per criterion, matching the LMS star vocabulary", () => {
    // 1..5 is the range of `gradeSubmissionSchema.stars` and of
    // src/components/ui/StarRating.tsx's default `max`. A rubric out of 10 would
    // have needed a second scoring idiom for the same interaction.
    for (const criterion of CRITERIA) {
      expect(criterion.maxPoints).toBe(CRITERION_MAX_POINTS);
    }
    expect(rubricMaxTotal(CRITERIA)).toBe(15);
  });

  it("survives a round trip through jsonb parsing unchanged", () => {
    // The default is stored in the database like any other rubric, so it has to be
    // readable by the same parser.
    expect(parseRubricCriteria(JSON.parse(JSON.stringify(CRITERIA)))).toEqual([...CRITERIA]);
  });
});

describe("parseRubricCriteria — untrusted jsonb", () => {
  it("returns an empty list for anything that is not an array", () => {
    for (const bad of [null, undefined, 7, "criteria", {}, true]) {
      expect(parseRubricCriteria(bad)).toEqual([]);
    }
  });

  it("drops entries it cannot make sense of and keeps the rest", () => {
    const parsed = parseRubricCriteria([
      { key: "good", name: "Good one", maxPoints: 5 },
      { key: "NO SPACES", name: "Bad key", maxPoints: 5 },
      { key: "noname", name: "   ", maxPoints: 5 },
      null,
      "nonsense",
      { name: "no key at all", maxPoints: 5 },
    ]);
    expect(parsed.map((c) => c.key)).toEqual(["good"]);
  });

  it("drops a duplicate key rather than collapsing two criteria into one score", () => {
    const parsed = parseRubricCriteria([
      { key: "dup", name: "First", maxPoints: 5 },
      { key: "dup", name: "Second", maxPoints: 3 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("First");
  });

  it("clamps maxPoints into 1..5 instead of rejecting the criterion", () => {
    const parsed = parseRubricCriteria([
      { key: "big", name: "Ten point", maxPoints: 10 },
      { key: "zero", name: "Zero point", maxPoints: 0 },
      { key: "junk", name: "Not a number", maxPoints: "five" },
    ]);
    expect(parsed.find((c) => c.key === "big")?.maxPoints).toBe(CRITERION_MAX_POINTS);
    expect(parsed.find((c) => c.key === "zero")?.maxPoints).toBe(1);
    expect(parsed.find((c) => c.key === "junk")?.maxPoints).toBe(CRITERION_MAX_POINTS);
  });

  it("caps the number of criteria", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      key: `c${i}`,
      name: `Criterion ${i}`,
      maxPoints: 5,
    }));
    expect(parseRubricCriteria(many)).toHaveLength(MAX_CRITERIA);
  });
});

describe("validateRubricScores — the floor under an empty review", () => {
  it("accepts a fully scored review and totals it", () => {
    const result = validateRubricScores(CRITERIA, FULL_MARKS);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(15);
    expect(result.scores).toEqual(FULL_MARKS);
  });

  it("REFUSES a review that skips a criterion", () => {
    // The cheapest possible pass is 120 characters and one score. This is what
    // stops it, and it is the reason the check is "every criterion" rather than
    // "at least one".
    const result = validateRubricScores(CRITERIA, { requirements: 5 });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBe(2);
    expect(result.issues.join(" ")).toContain("Code quality");
    expect(result.issues.join(" ")).toContain("Presentation");
    // Nothing partially valid escapes: a caller that ignored `ok` must not find
    // usable scores.
    expect(result.scores).toEqual({});
    expect(result.total).toBe(0);
  });

  it("refuses a score of zero, which is 'not rated' and not a rating", () => {
    const result = validateRubricScores(CRITERIA, { ...FULL_MARKS, quality: 0 });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("between 1 and 5");
  });

  it("refuses out-of-range, fractional and non-numeric scores", () => {
    for (const bad of [6, 99, -1, 2.5, "four", null, ""]) {
      const result = validateRubricScores(CRITERIA, { ...FULL_MARKS, quality: bad });
      expect(result.ok, `quality=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("refuses a criterion key the rubric does not have", () => {
    // Silently ignoring an extra key would show the reviewee a total that does not
    // match what the reviewer submitted.
    const result = validateRubricScores(CRITERIA, { ...FULL_MARKS, invented: 5 });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("invented");
  });

  it("refuses when the rubric itself is unusable", () => {
    const result = validateRubricScores([], FULL_MARKS);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("no usable criteria");
  });

  it("refuses a non-object payload", () => {
    for (const bad of [null, undefined, 5, "scores", [1, 2, 3]]) {
      expect(validateRubricScores(CRITERIA, bad).ok).toBe(false);
    }
  });
});

describe("sumRubricScores / toRubricScoreLines", () => {
  it("ignores non-numeric values rather than producing NaN", () => {
    expect(sumRubricScores({ a: 3, b: "x", c: 4 })).toBe(7);
    expect(sumRubricScores({})).toBe(0);
  });

  it("shows a criterion with no stored score as 'not scored', not as absent", () => {
    // A review written under an older rubric must not render as a shorter list that
    // looks complete.
    const lines = toRubricScoreLines(CRITERIA, { requirements: 4 });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ key: "requirements", name: "Requirements met", score: 4, maxPoints: 5 });
    expect(lines[1].score).toBeNull();
    expect(lines[2].score).toBeNull();
  });

  it("survives a stored blob of the wrong shape entirely", () => {
    for (const bad of [null, undefined, "nope", 7, [1, 2]]) {
      const lines = toRubricScoreLines(CRITERIA, bad);
      expect(lines).toHaveLength(3);
      expect(lines.every((l) => l.score === null)).toBe(true);
    }
  });
});
