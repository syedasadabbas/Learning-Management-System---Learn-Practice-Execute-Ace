// =============================================================================
// SUBMIT VALIDATION — the effort floor, tested as a refusal.
// -----------------------------------------------------------------------------
// The brief's gaming question is "a student who submits empty reviews must not
// profit". The structural answer is that there are no points to profit by
// (src/lib/peer-review/config.ts). This file tests the secondary defence: an empty
// or near-empty review cannot be STORED at all.
// =============================================================================

import { describe, expect, it } from "vitest";

import { MAX_REVIEW_CHARS, MIN_REVIEW_CHARS } from "./config";
import { DEFAULT_RUBRIC_CRITERIA } from "./rubric";
import { charsRemaining, parseSubmitPeerReview } from "./validate";

const CRITERIA = DEFAULT_RUBRIC_CRITERIA;
const SCORES = { requirements: 4, quality: 3, presentation: 5 };

/** A review that is long enough to be accepted. */
const GOOD_CONTENT =
  "The responsive layout holds up at 360 mm and at 1280 mm widths, and the navigation " +
  "collapses cleanly. The colour contrast on the footer links is too low to read though, " +
  "and index.html has three nested divs that a single section element would replace.";

function payload(overrides: Record<string, unknown> = {}) {
  return { allocationId: 5, content: GOOD_CONTENT, rubricScores: SCORES, ...overrides };
}

describe("parseSubmitPeerReview — refusals", () => {
  it("refuses an empty review", () => {
    const result = parseSubmitPeerReview(payload({ content: "" }), CRITERIA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`${MIN_REVIEW_CHARS} characters`);
  });

  it("refuses whitespace padded out to the length floor", () => {
    // The floor is checked on the TRIMMED string. 200 spaces is not a review, and a
    // length check on the raw string would have accepted it.
    const result = parseSubmitPeerReview(payload({ content: " ".repeat(200) }), CRITERIA);
    expect(result.ok).toBe(false);
  });

  it("refuses a review one character short of the floor", () => {
    const justShort = "a".repeat(MIN_REVIEW_CHARS - 1);
    expect(parseSubmitPeerReview(payload({ content: justShort }), CRITERIA).ok).toBe(false);
    const justEnough = "a".repeat(MIN_REVIEW_CHARS);
    expect(parseSubmitPeerReview(payload({ content: justEnough }), CRITERIA).ok).toBe(true);
  });

  it("refuses a review over the ceiling", () => {
    const result = parseSubmitPeerReview(
      payload({ content: "a".repeat(MAX_REVIEW_CHARS + 1) }),
      CRITERIA,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a review with an unscored criterion, however long the prose", () => {
    const result = parseSubmitPeerReview(
      payload({ rubricScores: { requirements: 4 } }),
      CRITERIA,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBe(2);
  });

  it("reports every problem at once, so the form is not a guessing game", () => {
    const result = parseSubmitPeerReview(
      payload({ rubricScores: { requirements: 9, quality: 0 } }),
      CRITERIA,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(1);
  });

  it("refuses a missing or nonsensical allocation id", () => {
    for (const bad of [undefined, null, 0, -3, 1.5, "5"]) {
      expect(parseSubmitPeerReview(payload({ allocationId: bad }), CRITERIA).ok).toBe(false);
    }
  });

  it("refuses a payload that is not an object at all", () => {
    for (const bad of [null, undefined, 7, "review", []]) {
      expect(parseSubmitPeerReview(bad, CRITERIA).ok).toBe(false);
    }
  });
});

describe("parseSubmitPeerReview — the accepted path", () => {
  it("stores the trimmed content and the computed total", () => {
    const result = parseSubmitPeerReview(
      payload({ content: `   ${GOOD_CONTENT}   ` }),
      CRITERIA,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content).toBe(GOOD_CONTENT);
    expect(result.data.totalScore).toBe(12);
    expect(result.data.rubricScores).toEqual(SCORES);
    expect(result.data.allocationId).toBe(5);
  });

  it("drops nothing and adds nothing to the score map", () => {
    const result = parseSubmitPeerReview(payload(), CRITERIA);
    if (!result.ok) throw new Error("expected ok");
    expect(Object.keys(result.data.rubricScores).sort()).toEqual([
      "presentation",
      "quality",
      "requirements",
    ]);
  });
});

describe("charsRemaining", () => {
  it("counts down on the trimmed length and floors at zero", () => {
    expect(charsRemaining("")).toBe(MIN_REVIEW_CHARS);
    expect(charsRemaining("   ")).toBe(MIN_REVIEW_CHARS);
    expect(charsRemaining("a".repeat(20))).toBe(MIN_REVIEW_CHARS - 20);
    expect(charsRemaining(GOOD_CONTENT)).toBe(0);
  });
});
