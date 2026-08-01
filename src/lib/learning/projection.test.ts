// =============================================================================
// THE ANSWER-KEY TEST. If one test in this stream is worth keeping, it is this
// one: it asserts that no student-facing projection can return solution
// material, and it fails the moment somebody adds a column to one.
// -----------------------------------------------------------------------------
// No database. `src/lib/auth` is not imported, `@/db` is imported only for the
// Drizzle column OBJECTS (which are plain descriptors, not connections), and
// tests/setup.ts forbids opening a pool. The assertions are about the SHAPE of
// the projections, which is exactly the property a database test could not
// check any better.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  ANSWER_KEY_FIELDS,
  answerKeyLeaks,
  hintsUpTo,
  interviewQuestionDetailColumns,
  interviewQuestionListColumns,
  maxHintLevel,
  practiceProblemDetailColumns,
  practiceProblemListColumns,
  practiceProblemListItem,
  practiceProblemSolutionColumns,
} from "./projection";

describe("answer-key projections", () => {
  it("the practice-problem LIST carries no solution material", () => {
    expect(answerKeyLeaks(practiceProblemListColumns)).toEqual([]);
  });

  it("the practice-problem DETAIL carries no solution material either", () => {
    // This is the assertion that encodes the decision to diverge from the spec
    // (which puts the solution in the detail view). If somebody restores it,
    // this fails and the decision gets re-made deliberately rather than by edit.
    expect(answerKeyLeaks(practiceProblemDetailColumns)).toEqual([]);
  });

  it("the interview-question LIST withholds the model answer", () => {
    expect(answerKeyLeaks(interviewQuestionListColumns)).toEqual([]);
    expect("sampleAnswer" in interviewQuestionListColumns).toBe(false);
    expect("answerExplanation" in interviewQuestionListColumns).toBe(false);
    expect("commonMistakes" in interviewQuestionListColumns).toBe(false);
  });

  it("the interview-question DETAIL carries the model answer, by design", () => {
    // The documented exception. Asserted POSITIVELY so the exemption is visible
    // in the test file and not just in a comment.
    expect("sampleAnswer" in interviewQuestionDetailColumns).toBe(true);
    expect(
      answerKeyLeaks(interviewQuestionDetailColumns, [
        "sampleAnswer",
        "answerExplanation",
        "commonMistakes",
      ]),
    ).toEqual([]);
  });

  it("the solution projection is the ONLY one naming solution columns", () => {
    expect("solutionCode" in practiceProblemSolutionColumns).toBe(true);
    expect(
      answerKeyLeaks(practiceProblemSolutionColumns, [
        "solutionCode",
        "solutionExplanation",
        "solutionScreenshotUrl",
      ]),
    ).toEqual([]);
  });

  it("answerKeyLeaks reports every offending field, not just the first", () => {
    const leaky = { id: 1, solutionCode: "x", sampleAnswer: "y", title: "z" };
    expect(answerKeyLeaks(leaky).sort()).toEqual(["sampleAnswer", "solutionCode"]);
  });

  it("the allowlist exempts only what it names", () => {
    const leaky = { solutionCode: "x", sampleAnswer: "y" };
    expect(answerKeyLeaks(leaky, ["solutionCode"])).toEqual(["sampleAnswer"]);
  });

  it("every declared answer-key field is a non-empty string", () => {
    // Guards against a typo'd entry, which would silently exempt a real column
    // from every assertion above.
    for (const field of ANSWER_KEY_FIELDS) {
      expect(typeof field).toBe("string");
      expect(field.length).toBeGreaterThan(0);
    }
  });
});

describe("practiceProblemListItem", () => {
  it("replaces the hint and test arrays with counts", () => {
    const item = practiceProblemListItem(
      { hints: [{ level: 1, text: "a" }, { level: 2, text: "b" }], testCases: [{}, {}, {}] },
      true,
    );
    expect(item.hintCount).toBe(2);
    expect(item.testCasesCount).toBe(3);
    expect(item.solutionAvailable).toBe(true);
    // The arrays themselves must be gone, not merely shadowed.
    expect("hints" in item).toBe(false);
    expect("testCases" in item).toBe(false);
  });

  it("treats a non-array jsonb blob as empty rather than throwing", () => {
    // jsonb accepts anything. A malformed blob must degrade to a zero count, not
    // crash the list endpoint for the whole lecture.
    const item = practiceProblemListItem({ hints: "not an array", testCases: null }, false);
    expect(item.hintCount).toBe(0);
    expect(item.testCasesCount).toBe(0);
  });
});

describe("hintsUpTo — the metered ladder", () => {
  const hints = [
    { level: 3, text: "third" },
    { level: 1, text: "first" },
    { level: 2, text: "second" },
  ];

  it("returns only the levels asked for", () => {
    expect(hintsUpTo(hints, 2).map((h) => h.level)).toEqual([1, 2]);
  });

  it("sorts ascending regardless of stored order", () => {
    expect(hintsUpTo(hints, 3).map((h) => h.text)).toEqual(["first", "second", "third"]);
  });

  it("returns nothing for level 0", () => {
    expect(hintsUpTo(hints, 0)).toEqual([]);
  });

  it("drops malformed entries instead of passing them through", () => {
    // A hint rendered as "[object Object]" under a "Hint 2" heading is worse
    // than one fewer hint.
    const mixed = [{ level: 1, text: "ok" }, { level: "2", text: "bad" }, null, { text: "no level" }];
    expect(hintsUpTo(mixed, 5)).toEqual([{ level: 1, text: "ok" }]);
  });

  it("returns nothing when the column is not an array", () => {
    expect(hintsUpTo(null, 3)).toEqual([]);
    expect(hintsUpTo({ level: 1 }, 3)).toEqual([]);
  });
});

describe("maxHintLevel", () => {
  it("is the highest well-formed level", () => {
    expect(maxHintLevel([{ level: 1, text: "a" }, { level: 4, text: "b" }])).toBe(4);
  });

  it("is zero when there are no usable hints", () => {
    expect(maxHintLevel([])).toBe(0);
    expect(maxHintLevel(null)).toBe(0);
    expect(maxHintLevel([{ text: "no level" }])).toBe(0);
  });
});
