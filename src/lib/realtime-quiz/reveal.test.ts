// =============================================================================
// Reveal tests — what the student learns AFTER committing, and nothing more.
// -----------------------------------------------------------------------------
// The negative assertion in the last block is the one that matters long-term: the
// reveal must carry no number that could be summed into a grade. A future change
// that adds `points` or `score` here is the first step of wiring an ungraded
// check into scoring, and it fails here rather than in production.
// =============================================================================

import { describe, expect, it } from "vitest";

import { revealAnswer } from "./reveal";

const question = { id: 10, explanation: "Flex items lay out along the main axis." };
const options = [
  { id: 100, isCorrect: true },
  { id: 101, isCorrect: false },
  { id: 102, isCorrect: false },
];

describe("revealAnswer", () => {
  it("confirms a correct answer and reveals the explanation only now", () => {
    const outcome = revealAnswer({ question, options, selectedOptionId: 100 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reveal.isCorrect).toBe(true);
    expect(outcome.reveal.correctOptionId).toBe(100);
    expect(outcome.reveal.explanation).toBe(question.explanation);
  });

  it("names the correct option when the answer was wrong", () => {
    const outcome = revealAnswer({ question, options, selectedOptionId: 102 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reveal.isCorrect).toBe(false);
    expect(outcome.reveal.correctOptionId).toBe(100);
    expect(outcome.reveal.selectedOptionId).toBe(102);
  });

  it("passes a null explanation through rather than inventing one", () => {
    const outcome = revealAnswer({
      question: { id: 10, explanation: null },
      options,
      selectedOptionId: 100,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reveal.explanation).toBeNull();
  });
});

describe("revealAnswer refuses rather than throws", () => {
  it("rejects an option id that belongs to another question, leaking nothing", () => {
    const outcome = revealAnswer({ question, options, selectedOptionId: 999 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("unknown_option");
    // The refusal must not disclose which option was right — that is the whole
    // reason the membership check runs before the key is consulted.
    expect(JSON.stringify(outcome)).not.toContain("100");
  });

  it("reports an unauthored answer key instead of guessing", () => {
    const outcome = revealAnswer({
      question,
      options: [{ id: 100, isCorrect: false }],
      selectedOptionId: 100,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("no_answer_key");
  });

  it("reports an ambiguous answer key instead of picking the first", () => {
    const outcome = revealAnswer({
      question,
      options: [
        { id: 100, isCorrect: true },
        { id: 101, isCorrect: true },
      ],
      selectedOptionId: 101,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("ambiguous_answer_key");
  });

  it("never throws for any input, including an empty option set", () => {
    expect(() => revealAnswer({ question, options: [], selectedOptionId: 1 })).not.toThrow();
  });
});

describe("NEGATIVE: the reveal carries nothing that could become a mark", () => {
  it("has exactly the five teaching fields and no score of any kind", () => {
    const outcome = revealAnswer({ question, options, selectedOptionId: 100 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(outcome.reveal).sort()).toEqual([
      "correctOptionId",
      "explanation",
      "isCorrect",
      "questionId",
      "selectedOptionId",
    ]);
    const serialised = JSON.stringify(outcome);
    for (const forbidden of [
      "points",
      "awarded",
      "score",
      "percentage",
      "passed",
      "penalty",
      "unlock",
      "attemptNumber",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
