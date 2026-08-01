// =============================================================================
// THE DEFERRAL RULE — `rate_limited` / `backend_unavailable` never score zero.
// -----------------------------------------------------------------------------
// The runner is INJECTED in every test here, so nothing touches the network and
// every failure branch of the execution contract is reachable deterministically.
//
// The assertion that matters most is the negative one: a rate-limited item must
// come back `deferred`, NOT `scored: 0`. Scoring it zero would record a property
// of a shared free server as a student's mark, on a one-attempt exam they cannot
// retake — and it would look exactly like a wrong answer forever afterwards.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import type { RunCode, RunFailureReason, RunResult } from "@/lib/execution";

import {
  gradeCodeAnswer,
  gradeCodeAnswers,
  marksFor,
  outputMatches,
  parseTests,
  type CodeQuestion,
} from "./code-grading";

// ---------------------------------------------------------------------------
// Runner stubs
// ---------------------------------------------------------------------------

function okResult(stdout: string, exitCode = 0): RunResult {
  return {
    ok: true,
    exitCode,
    stdout,
    stderr: "",
    runtimeMs: 12,
    backend: "piston",
    truncated: { stdout: false, stderr: false },
    language: "python",
  };
}

function failResult(reason: RunFailureReason): RunResult {
  return {
    ok: false,
    reason,
    message: `simulated ${reason}`,
    exitCode: null,
    stdout: "",
    stderr: "",
    runtimeMs: 3,
    backend: "piston",
    truncated: { stdout: false, stderr: false },
    language: "python",
  };
}

const QUESTION: CodeQuestion = {
  id: 7,
  type: "code_write",
  points: 8,
  language: "python",
  tests: [
    { name: "one", input: "1", expected: "1" },
    { name: "two", input: "2", expected: "4" },
    { name: "three", input: "3", expected: "9" },
    { name: "four", input: "4", expected: "16" },
  ],
};

// ---------------------------------------------------------------------------
// parseTests — untrusted jsonb
// ---------------------------------------------------------------------------

describe("parseTests (questions.tests is untrusted jsonb)", () => {
  it("reads a well-formed set", () => {
    expect(parseTests([{ name: "a", input: "1", expected: "2" }])).toEqual([
      { name: "a", input: "1", expected: "2" },
    ]);
  });

  it("returns [] for anything that is not an array, rather than throwing mid-submit", () => {
    expect(parseTests(null)).toEqual([]);
    expect(parseTests("see spec")).toEqual([]);
    expect(parseTests({ tests: [] })).toEqual([]);
    expect(parseTests(undefined)).toEqual([]);
  });

  it("drops malformed entries but keeps the valid ones", () => {
    // Grading against four valid tests of five beats grading against none.
    const parsed = parseTests([
      { name: "a", input: "1", expected: "2" },
      { name: "b", input: "1" },
      null,
      42,
      { expected: "3" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ name: "test 2", input: "", expected: "3" });
  });
});

// ---------------------------------------------------------------------------
// outputMatches / marksFor
// ---------------------------------------------------------------------------

describe("outputMatches", () => {
  it("ignores trailing whitespace and line endings", () => {
    // Failing a student for their operating system's line ending is a defect in
    // the grader, not in their code.
    expect(outputMatches("4\r\n", "4")).toBe(true);
    expect(outputMatches("4   \n\n", "4")).toBe(true);
    expect(outputMatches("a\nb\n", "a\nb")).toBe(true);
  });

  it("does not ignore case or interior spacing", () => {
    expect(outputMatches("Yes", "yes")).toBe(false);
    expect(outputMatches("a  b", "a b")).toBe(false);
  });
});

describe("marksFor (partial credit, clamped)", () => {
  it("awards proportional marks, rounded toward the student", () => {
    expect(marksFor(4, 4, 8)).toBe(8);
    expect(marksFor(2, 4, 8)).toBe(4);
    expect(marksFor(0, 4, 8)).toBe(0);
    expect(marksFor(1, 2, 3)).toBe(2); // round, not floor
  });

  it("never exceeds maxPoints or goes negative", () => {
    expect(marksFor(99, 4, 8)).toBe(8);
    expect(marksFor(-3, 4, 8)).toBe(0);
  });

  it("is 0 when there are no tests, rather than dividing by zero", () => {
    expect(marksFor(0, 0, 8)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// gradeCodeAnswer — the deferral rule
// ---------------------------------------------------------------------------

describe("gradeCodeAnswer", () => {
  it("scores full marks when every hidden test passes", async () => {
    const runner: RunCode = async (request) =>
      okResult(String(Number(request.stdin) ** 2));
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "x**2", runner });
    expect(outcome).toEqual({
      questionId: 7,
      kind: "scored",
      awarded: 8,
      note: "4 of 4 hidden tests passed.",
    });
  });

  it("scores partial marks for a partly correct program", async () => {
    const runner: RunCode = async (request) =>
      okResult(request.stdin === "1" || request.stdin === "2" ? String(Number(request.stdin) ** 2) : "0");
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "…", runner });
    expect(outcome.kind).toBe("scored");
    expect(outcome.kind === "scored" && outcome.awarded).toBe(4);
  });

  // -------------------------------------------------------------------------
  // REGRESSION: a language with no runtime must DEFER, never score zero.
  //
  // This shipped broken and 143 passing tests did not catch it. The seeded
  // week-1 and week-2 exams carry six 8-point code_write items in `html` and
  // `css` — languages nothing executes. Those 48 of 150 marks were recorded as a
  // FINAL zero, capping both exams at 102/150 = 68%, so NO student could pass
  // either one, on an exam that cannot be retaken.
  // -------------------------------------------------------------------------
  it.each(["html", "css", "markdown", "brainfuck"])(
    "DEFERS a %s answer instead of scoring it zero, and never calls the runner",
    async (language) => {
      const runner = vi.fn<RunCode>();
      const outcome = await gradeCodeAnswer({
        question: { ...QUESTION, language },
        code: "<h1>hello</h1>",
        runner,
      });

      // Not called at all: four pointless Piston round trips per item, on a
      // cohort-wide exam, to learn what the allow-list already knows.
      expect(runner).not.toHaveBeenCalled();
      expect(outcome.kind).toBe("deferred");
      // Not an outage — the question genuinely needs a human.
      expect(outcome.kind === "deferred" && outcome.infrastructure).toBe(false);
      expect(outcome.kind === "deferred" && outcome.reason).toContain(language);
    },
  );

  it("still grades a language that IS on the allow-list", async () => {
    // Guards the fix from over-reaching: deferring everything would be just as
    // wrong, and silently so, since a deferred item looks like a pending mark.
    const runner: RunCode = async (request) => okResult(String(Number(request.stdin) ** 2));
    for (const language of ["python", "javascript", "cpp"]) {
      const outcome = await gradeCodeAnswer({
        question: { ...QUESTION, language },
        code: "x**2",
        runner,
      });
      expect(outcome.kind, `${language} should be graded, not deferred`).toBe("scored");
    }
  });

  it("scores 0 for empty code WITHOUT calling the runner", async () => {
    // 50 students × 8 empty programs would exhaust the shared free instance to
    // grade nothing.
    const runner = vi.fn<RunCode>();
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "   ", runner });
    expect(runner).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      questionId: 7,
      kind: "scored",
      awarded: 0,
      note: "No code was submitted.",
    });
  });

  // -------------------------------------------------------------------------
  // THE RULE
  // -------------------------------------------------------------------------
  it("DEFERS on rate_limited — never scores it zero", async () => {
    const runner: RunCode = async () => failResult("rate_limited");
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "print(1)", runner });
    expect(outcome.kind).toBe("deferred");
    expect(outcome.kind === "deferred" && outcome.infrastructure).toBe(true);
    // The assertion that matters: this is NOT a zero.
    expect(outcome).not.toMatchObject({ kind: "scored", awarded: 0 });
  });

  it("DEFERS on backend_unavailable — never scores it zero", async () => {
    const runner: RunCode = async () => failResult("backend_unavailable");
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "print(1)", runner });
    expect(outcome.kind).toBe("deferred");
    expect(outcome.kind === "deferred" && outcome.infrastructure).toBe(true);
  });

  it("abandons the remaining tests as soon as one defers", async () => {
    // Hammering an instance that just said 429 makes the outage worse for the
    // other 79 students and cannot produce a mark anyway.
    const runner = vi.fn<RunCode>(async () => failResult("rate_limited"));
    await gradeCodeAnswer({ question: QUESTION, code: "print(1)", runner });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("does NOT defer on timeout — that is the student's own program looping", async () => {
    const runner: RunCode = async () => failResult("timeout");
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "while True: pass", runner });
    expect(outcome.kind).toBe("scored");
    expect(outcome.kind === "scored" && outcome.awarded).toBe(0);
  });

  it("does NOT defer on unsupported_language — a content bug scores 0, loudly", async () => {
    const runner: RunCode = async () => failResult("unsupported_language");
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "print(1)", runner });
    expect(outcome.kind).toBe("scored");
    expect(outcome.kind === "scored" && outcome.awarded).toBe(0);
  });

  it("treats a non-zero exit as a failed test, not a deferral", async () => {
    const runner: RunCode = async () => okResult("Traceback…", 1);
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "boom", runner });
    expect(outcome.kind).toBe("scored");
    expect(outcome.kind === "scored" && outcome.awarded).toBe(0);
  });

  it("DEFERS a question with no authored tests, rather than scoring the student 0", async () => {
    const runner = vi.fn<RunCode>();
    const outcome = await gradeCodeAnswer({
      question: { ...QUESTION, tests: [] },
      code: "print(1)",
      runner,
    });
    expect(outcome.kind).toBe("deferred");
    // Not an infrastructure failure — it must not condemn the other questions.
    expect(outcome.kind === "deferred" && outcome.infrastructure).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("DEFERS a question with no language", async () => {
    const outcome = await gradeCodeAnswer({
      question: { ...QUESTION, language: null },
      code: "print(1)",
      runner: async () => okResult("1"),
    });
    expect(outcome.kind).toBe("deferred");
    expect(outcome.kind === "deferred" && outcome.infrastructure).toBe(false);
  });

  it("DEFERS rather than propagating a runner that breaks its never-throw contract", async () => {
    // A rejected promise inside a submit transaction would cost the student their
    // attempt. Caught and deferred instead.
    const runner: RunCode = async () => {
      throw new Error("contract violated");
    };
    const outcome = await gradeCodeAnswer({ question: QUESTION, code: "print(1)", runner });
    expect(outcome.kind).toBe("deferred");
    expect(outcome.kind === "deferred" && outcome.infrastructure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gradeCodeAnswers — the whole exam
// ---------------------------------------------------------------------------

describe("gradeCodeAnswers", () => {
  const threeCodeQuestions: CodeQuestion[] = [
    { ...QUESTION, id: 1 },
    { ...QUESTION, id: 2 },
    { ...QUESTION, id: 3 },
  ];
  const saved = [
    { questionId: 1, selectedOptionId: null, codeAnswer: "a" },
    { questionId: 2, selectedOptionId: null, codeAnswer: "b" },
    { questionId: 3, selectedOptionId: null, codeAnswer: "c" },
  ];

  it("ignores non-code questions entirely", async () => {
    const runner = vi.fn<RunCode>(async () => okResult("1"));
    const outcomes = await gradeCodeAnswers({
      questions: [{ ...QUESTION, id: 1, type: "mcq" }],
      saved,
      runner,
    });
    expect(outcomes).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it("SHORT-CIRCUITS the remaining questions after an infrastructure deferral", async () => {
    const runner = vi.fn<RunCode>(async () => failResult("backend_unavailable"));
    const outcomes = await gradeCodeAnswers({ questions: threeCodeQuestions, saved, runner });

    // Every question is accounted for...
    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => outcome.kind === "deferred")).toBe(true);
    // ...but the dead backend was called exactly once, not twelve times.
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("a per-question deferral does NOT condemn the other questions", async () => {
    const runner = vi.fn<RunCode>(async () => okResult("1"));
    const outcomes = await gradeCodeAnswers({
      questions: [
        // No tests authored: deferred, but not an infrastructure failure.
        { ...QUESTION, id: 1, tests: [] },
        // Should still be graded normally.
        { ...QUESTION, id: 2, tests: [{ name: "t", input: "1", expected: "1" }] },
      ],
      saved,
      runner,
    });
    expect(outcomes[0]?.kind).toBe("deferred");
    expect(outcomes[1]?.kind).toBe("scored");
    expect(runner).toHaveBeenCalled();
  });

  it("runs tests sequentially rather than fanning out at the shared instance", async () => {
    let concurrent = 0;
    let peak = 0;
    const runner: RunCode = async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await Promise.resolve();
      concurrent -= 1;
      return okResult("1");
    };
    await gradeCodeAnswers({
      questions: [{ ...QUESTION, id: 1, tests: [{ name: "t", input: "1", expected: "1" }] }, { ...QUESTION, id: 2, tests: [{ name: "t", input: "1", expected: "1" }] }],
      saved,
      runner,
    });
    expect(peak).toBe(1);
  });
});
