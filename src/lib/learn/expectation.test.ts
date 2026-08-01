// The untrusted-jsonb boundary. Every test here is a value that could actually be
// in the column — a typo, an older shape, a hostile string — and the requirement is
// that none of them throws and none of them leaks an answer key.
import { describe, expect, it } from "vitest";

import {
  correctIndex,
  evaluateCheck,
  parseCheck,
  parseExplain,
  parseLab,
  parseStepKind,
  publicCheck,
} from "./expectation";

describe("parseStepKind", () => {
  it("accepts the three declared kinds", () => {
    expect(parseStepKind("explain")).toBe("explain");
    expect(parseStepKind("lab")).toBe("lab");
    expect(parseStepKind("check")).toBe("check");
  });

  it("normalises case and whitespace", () => {
    expect(parseStepKind("  LAB ")).toBe("lab");
  });

  it("falls back to explain for anything unknown, rather than throwing", () => {
    // A step that renders as prose is a degraded lesson; a thrown error is a 500
    // on a page a cohort is sitting in front of.
    for (const value of ["quiz", "", null, undefined, 7, {}, []]) {
      expect(parseStepKind(value)).toBe("explain");
    }
  });
});

describe("parseExplain", () => {
  it("parses a well-formed diagram", () => {
    const result = parseExplain({
      kind: "explain",
      diagramTitle: "Box model",
      frames: [
        { label: "content", caption: "the text itself" },
        { label: "padding", caption: "space inside the border", code: "padding: 8px" },
      ],
    });
    expect(result?.frames).toHaveLength(2);
    expect(result?.frames[1].code).toBe("padding: 8px");
  });

  it("keeps the good frames and drops the bad ones", () => {
    const result = parseExplain({
      frames: [
        { label: "ok", caption: "fine" },
        { label: "no caption" },
        "not an object",
        { caption: "no label" },
        { label: "ok two", caption: "also fine" },
      ],
    });
    expect(result?.frames.map((f) => f.label)).toEqual(["ok", "ok two"]);
  });

  it("returns null when there is no usable frame at all", () => {
    expect(parseExplain({ frames: [] })).toBeNull();
    expect(parseExplain({ frames: [{ label: "x" }] })).toBeNull();
    expect(parseExplain(null)).toBeNull();
    expect(parseExplain("string")).toBeNull();
    expect(parseExplain({ kind: "lab", frames: [{ label: "a", caption: "b" }] })).toBeNull();
  });

  it("supplies a default title rather than rendering an empty heading", () => {
    const result = parseExplain({ frames: [{ label: "a", caption: "b" }, { label: "c", caption: "d" }] });
    expect(result?.diagramTitle).toBe("Diagram");
  });

  it("caps the frame count so one huge cell cannot bloat a page", () => {
    const frames = Array.from({ length: 40 }, (_, i) => ({ label: `f${i}`, caption: "c" }));
    expect(parseExplain({ frames })?.frames.length).toBeLessThanOrEqual(12);
  });
});

describe("parseLab", () => {
  it("parses goal, hint, setup and the not-production-ready flag", () => {
    const lab = parseLab({
      kind: "lab",
      goal: "hash two strings",
      hint: "encode first",
      setup: "CREATE TABLE t (id INTEGER);",
      notProductionReady: true,
    });
    expect(lab).toEqual({
      kind: "lab",
      goal: "hash two strings",
      hint: "encode first",
      setup: "CREATE TABLE t (id INTEGER);",
      notProductionReady: true,
    });
  });

  it("falls back to a usable goal rather than nulling the whole lab", () => {
    // The editor is worth having even when the prose is missing.
    expect(parseLab({})?.goal).toMatch(/run it/i);
  });

  it("omits notProductionReady unless it is exactly true", () => {
    expect(parseLab({ goal: "g", notProductionReady: "yes" })).not.toHaveProperty(
      "notProductionReady",
    );
    expect(parseLab({ goal: "g", notProductionReady: 1 })).not.toHaveProperty(
      "notProductionReady",
    );
  });

  it("returns null for a non-object or a mismatched kind", () => {
    expect(parseLab(null)).toBeNull();
    expect(parseLab([])).toBeNull();
    expect(parseLab({ kind: "check", goal: "g" })).toBeNull();
  });
});

describe("parseCheck", () => {
  const valid = {
    kind: "check",
    prompt: "Does === compare contents?",
    options: [
      { text: "no", correct: true },
      { text: "yes" },
    ],
    explanation: "=== compares identity.",
  };

  it("parses a well-formed check including its key", () => {
    const check = parseCheck(valid);
    expect(check?.options[0].correct).toBe(true);
    expect(correctIndex(check!)).toBe(0);
  });

  it("refuses a check with no correct option — it would be unanswerable", () => {
    expect(parseCheck({ ...valid, options: [{ text: "a" }, { text: "b" }] })).toBeNull();
  });

  it("refuses a check with two correct options — it would be ambiguous", () => {
    expect(
      parseCheck({
        ...valid,
        options: [
          { text: "a", correct: true },
          { text: "b", correct: true },
        ],
      }),
    ).toBeNull();
  });

  it("refuses a check with fewer than two options", () => {
    expect(parseCheck({ ...valid, options: [{ text: "only", correct: true }] })).toBeNull();
  });

  it("refuses a check with no prompt", () => {
    expect(parseCheck({ ...valid, prompt: "   " })).toBeNull();
  });

  it("accepts bare strings as options and treats none of them as correct", () => {
    // Which correctly makes such a check unusable, rather than guessing a key.
    expect(parseCheck({ ...valid, options: ["a", "b"] })).toBeNull();
  });

  it("tolerates a missing explanation", () => {
    expect(parseCheck({ ...valid, explanation: undefined })?.explanation).toBe("");
  });
});

describe("publicCheck — the answer-key barrier", () => {
  // The prompt and options deliberately avoid the literal word "true", so the
  // round-trip assertion below can search for it without matching the question.
  const check = parseCheck({
    kind: "check",
    prompt: "Which option holds?",
    options: [{ text: "wrong" }, { text: "right", correct: true }, { text: "also wrong" }],
    explanation: "because",
  })!;

  it("strips every correct flag", () => {
    const payload = publicCheck(check);
    for (const option of payload.options) {
      expect(option).not.toHaveProperty("correct");
    }
  });

  it("survives a JSON round trip with no trace of the key", () => {
    // Asserted against the serialised form, the way payload.test.ts does for
    // quizzes: a nested flag that a shallow check would miss shows up here.
    const serialised = JSON.stringify(publicCheck(check));
    expect(serialised).not.toContain("correct");
    expect(serialised).not.toContain("true");
    expect(serialised).toContain("right");
  });

  it("does not carry the explanation, which would give the answer away", () => {
    expect(JSON.stringify(publicCheck(check))).not.toContain("because");
  });

  it("preserves option order, so a posted index matches the server's array", () => {
    expect(publicCheck(check).options.map((o) => o.text)).toEqual([
      "wrong",
      "right",
      "also wrong",
    ]);
  });
});

describe("evaluateCheck", () => {
  const check = parseCheck({
    kind: "check",
    prompt: "p",
    options: [{ text: "a" }, { text: "b", correct: true }],
    explanation: "b is right",
  })!;

  it("grades the correct index as correct", () => {
    expect(evaluateCheck(check, 1)).toEqual({
      correct: true,
      correctIndex: 1,
      explanation: "b is right",
    });
  });

  it("grades a wrong index as wrong and still returns the explanation", () => {
    const outcome = evaluateCheck(check, 0);
    expect(outcome.correct).toBe(false);
    expect(outcome.explanation).toBe("b is right");
    expect(outcome.correctIndex).toBe(1);
  });

  it("treats junk as wrong rather than throwing", () => {
    // These can only come from a hand-made request, and there is no grade at stake.
    for (const value of [-1, 99, 1.5, "1", null, undefined, {}]) {
      expect(evaluateCheck(check, value).correct).toBe(false);
    }
  });
});
