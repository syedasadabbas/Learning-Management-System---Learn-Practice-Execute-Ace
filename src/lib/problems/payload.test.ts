// =============================================================================
// UNIT TESTS — the hidden-test barrier. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// These exist because "hidden tests must never reach the browser" is otherwise
// enforced only by a comment, and a comment is not a barrier. They follow
// src/lib/quizzes/payload.test.ts exactly: assert the KEYS AND THE TEXT ARE ABSENT
// (not merely undefined) after a round-trip through JSON, which is what the browser
// actually receives.
//
// The fixture rows below deliberately carry live secrets — hidden test inputs, a
// hidden expected output, and a full reference solution — because the point is
// that they go in and do not come out.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  mayRevealSolution,
  stringArray,
  toProblemSummary,
  toStudentProblem,
  type AttemptRowLike,
  type ProblemRowLike,
  type TestRowLike,
} from "./payload";

const SECRET_INPUT = "9007199254740993";
const SECRET_EXPECTED = "HIDDEN-EXPECTED-9f2a";
const SECRET_SOLUTION = "function solve(n) { return SECRET_ANSWER_MARKER; }";

const PROBLEM: ProblemRowLike = {
  id: 42,
  slug: "js-running-total",
  title: "Running total",
  statement: "Read integers and print the running total.",
  track: "javascript",
  level: "beginner",
  isInterview: false,
  language: "javascript",
  starterCode: "// your code here\n",
  referenceSolution: SECRET_SOLUTION,
  hints: ["Read the whole input first.", "", 7, null],
  tags: ["arrays", "accumulate"],
  execution: "browser",
  timeLimitMs: 5000,
  orderIndex: 0,
};

const TESTS: TestRowLike[] = [
  { id: 3, name: "hidden — large values", input: SECRET_INPUT, expectedOutput: SECRET_EXPECTED, hidden: true, orderIndex: 2 },
  { id: 2, name: "example 2", input: "2\n3", expectedOutput: "5", hidden: false, orderIndex: 1 },
  { id: 1, name: "example 1", input: "1\n1", expectedOutput: "2", hidden: false, orderIndex: 0 },
  { id: 4, name: "hidden — empty input", input: "", expectedOutput: "0", hidden: true, orderIndex: 3 },
];

const NOW = new Date("2026-07-30T09:00:00.000Z");

function build(attempts: AttemptRowLike[] = [], problem: ProblemRowLike = PROBLEM) {
  const payload = toStudentProblem({ problem, tests: TESTS, attempts });
  if (!payload) throw new Error("fixture should produce a payload");
  return payload;
}

describe("toStudentProblem — hidden-test leakage", () => {
  it("emits no hidden test input or expected output in the serialised payload", () => {
    const json = JSON.stringify(build());
    expect(json).not.toContain(SECRET_INPUT);
    expect(json).not.toContain(SECRET_EXPECTED);
    expect(json).not.toContain("hidden — large values");
    expect(json).not.toContain("hidden — empty input");
  });

  it("emits no `hidden` key at all, so no row can be sent and filtered later", () => {
    expect(JSON.stringify(build())).not.toContain("hidden\"");
  });

  it("visible tests carry only id, name, input, expectedOutput and orderIndex", () => {
    for (const test of build().visibleTests) {
      expect(Object.keys(test).sort()).toEqual([
        "expectedOutput",
        "id",
        "input",
        "name",
        "orderIndex",
      ]);
    }
  });

  it("sends only the visible rows, sorted by orderIndex regardless of input order", () => {
    expect(build().visibleTests.map((t) => t.id)).toEqual([1, 2]);
  });

  it("reports the hidden COUNT, which is information not a leak", () => {
    expect(build().hiddenTestCount).toBe(2);
  });
});

describe("toStudentProblem — reference solution", () => {
  it("withholds the solution key entirely from an unsolved executable problem", () => {
    const payload = build();
    expect("referenceSolution" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("SECRET_ANSWER_MARKER");
  });

  it("reveals it once the student has a passing run", () => {
    const payload = build([
      { id: 1, passedCount: 4, totalCount: 4, execution: "piston", runtimeMs: 120, createdAt: NOW },
    ]);
    expect(payload.solved).toBe(true);
    expect(payload.referenceSolution).toBe(SECRET_SOLUTION);
  });

  it("reveals it on a reference-only problem, where it is the whole content", () => {
    const payload = build([], { ...PROBLEM, execution: "none" });
    expect(payload.referenceSolution).toBe(SECRET_SOLUTION);
  });

  it("reveals it for a server-graded problem when the server runner is down", () => {
    // The documented C++ degradation: no in-browser toolchain, so with Piston
    // unreachable the alternative is a statement the student cannot attempt and
    // cannot learn from.
    const payload = toStudentProblem({
      problem: { ...PROBLEM, execution: "piston", track: "cpp", language: "cpp" },
      tests: TESTS,
      attempts: [],
      serverGradingAvailable: false,
    })!;
    expect(payload.serverGradingAvailable).toBe(false);
    expect(payload.referenceSolution).toBe(SECRET_SOLUTION);
  });

  it("does NOT reveal a browser-backed problem's answer during a server outage", () => {
    // Its Run works with no server at all, so an outage is no reason to hand out
    // the answer — that would be a leak dressed up as a degradation.
    const payload = toStudentProblem({
      problem: PROBLEM,
      tests: TESTS,
      attempts: [],
      serverGradingAvailable: false,
    })!;
    expect("referenceSolution" in payload).toBe(false);
  });

  it("mayRevealSolution states the rule in one place", () => {
    expect(mayRevealSolution("browser", false)).toBe(false);
    expect(mayRevealSolution("piston", false)).toBe(false);
    expect(mayRevealSolution("browser", true)).toBe(true);
    expect(mayRevealSolution("none", false)).toBe(true);
    // The degradation, and its scope.
    expect(mayRevealSolution("piston", false, false)).toBe(true);
    expect(mayRevealSolution("browser", false, false)).toBe(false);
  });
});

describe("toStudentProblem — shape", () => {
  it("drops empty and non-string jsonb hints rather than rendering null", () => {
    expect(build().hints).toEqual(["Read the whole input first."]);
  });

  it("reports solved false when a run passed only some tests", () => {
    const payload = build([
      { id: 1, passedCount: 3, totalCount: 4, execution: "piston", runtimeMs: 90, createdAt: NOW },
    ]);
    expect(payload.solved).toBe(false);
    expect("referenceSolution" in payload).toBe(false);
  });

  it("orders attempt history newest first", () => {
    const payload = build([
      { id: 1, passedCount: 1, totalCount: 4, execution: "piston", runtimeMs: 10, createdAt: new Date("2026-07-01T00:00:00Z") },
      { id: 2, passedCount: 4, totalCount: 4, execution: "piston", runtimeMs: 10, createdAt: new Date("2026-07-20T00:00:00Z") },
    ]);
    expect(payload.attempts.map((a) => a.id)).toEqual([2, 1]);
    expect(payload.attempts[0].passed).toBe(true);
  });

  it("maps is_interview onto the bank rather than exposing the column", () => {
    expect(build().bank).toBe("practice");
    expect(build([], { ...PROBLEM, isInterview: true }).bank).toBe("interview");
  });

  it("returns null for a row whose track is not allow-listed", () => {
    expect(
      toStudentProblem({ problem: { ...PROBLEM, track: "brainfuck" }, tests: [], attempts: [] }),
    ).toBeNull();
  });
});

describe("toProblemSummary", () => {
  it("carries no statement, tests or solution — it is a browse row", () => {
    const summary = toProblemSummary({ problem: PROBLEM, solved: false, attemptCount: 2, locked: true });
    expect(summary).not.toBeNull();
    expect(Object.keys(summary!).sort()).toEqual([
      "attemptCount",
      "bank",
      "execution",
      "language",
      "level",
      "locked",
      "slug",
      "solved",
      "tags",
      "title",
      "track",
    ]);
    const json = JSON.stringify(summary);
    expect(json).not.toContain("SECRET_ANSWER_MARKER");
    expect(json).not.toContain(PROBLEM.statement);
  });

  it("drops an unknown track instead of throwing inside a server component", () => {
    expect(
      toProblemSummary({
        problem: { ...PROBLEM, track: "cobol" },
        solved: false,
        attemptCount: 0,
        locked: false,
      }),
    ).toBeNull();
  });
});

describe("stringArray", () => {
  it("returns an empty array for anything that is not an array of strings", () => {
    expect(stringArray(null)).toEqual([]);
    expect(stringArray("not an array")).toEqual([]);
    expect(stringArray({ 0: "a" })).toEqual([]);
    expect(stringArray([1, null, "  ", "keep"])).toEqual(["keep"]);
  });
});
