// =============================================================================
// UNIT TESTS — completion is DERIVED. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// The whole point of these is the last case in the first block: 0 of 0 is NOT
// solved. Without the `totalCount > 0` guard, a problem whose tests were deleted
// (or an attempt row written before its tests existed) satisfies
// `passedCount === totalCount` and reports every student as having solved it.
// That is exactly the failure mode a stored `solved` flag would also produce, and
// it is why the schema comment forbids one.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  attemptCountsByProblem,
  attemptPassed,
  isSolved,
  solvedProblemIds,
  type AttemptCounts,
} from "./completion";

describe("attemptPassed", () => {
  it("passes only when every test that ran passed", () => {
    expect(attemptPassed({ passedCount: 4, totalCount: 4 })).toBe(true);
    expect(attemptPassed({ passedCount: 3, totalCount: 4 })).toBe(false);
    expect(attemptPassed({ passedCount: 0, totalCount: 4 })).toBe(false);
  });

  it("refuses 0 of 0 — an empty test set is a content bug, not a solve", () => {
    expect(attemptPassed({ passedCount: 0, totalCount: 0 })).toBe(false);
  });

  it("refuses a corrupt row claiming more passes than tests", () => {
    // Not reachable through gradeAndRecordAttempt, but a hand-written SQL row or a
    // future writer could produce it, and "more passes than tests" is not a solve.
    expect(attemptPassed({ passedCount: 5, totalCount: 4 })).toBe(false);
  });
});

describe("isSolved", () => {
  const attempts: AttemptCounts[] = [
    { problemId: 1, passedCount: 1, totalCount: 4 },
    { problemId: 1, passedCount: 4, totalCount: 4 },
    { problemId: 1, passedCount: 0, totalCount: 4 },
    { problemId: 2, passedCount: 3, totalCount: 4 },
  ];

  it("is true when ANY run passed, not only the latest", () => {
    // The student solved problem 1 and then broke it while experimenting. Practice
    // is for experimenting; making the newest run authoritative would punish it.
    expect(isSolved(attempts, 1)).toBe(true);
  });

  it("is false for a problem with attempts but no passing run", () => {
    expect(isSolved(attempts, 2)).toBe(false);
  });

  it("is false for a problem with no attempts at all", () => {
    expect(isSolved(attempts, 99)).toBe(false);
    expect(isSolved([], 1)).toBe(false);
  });

  it("never credits one problem's pass to another", () => {
    expect(isSolved([{ problemId: 7, passedCount: 2, totalCount: 2 }], 8)).toBe(false);
  });
});

describe("solvedProblemIds", () => {
  it("collects exactly the problems with a passing run", () => {
    const solved = solvedProblemIds([
      { problemId: 1, passedCount: 2, totalCount: 2 },
      { problemId: 2, passedCount: 1, totalCount: 2 },
      { problemId: 3, passedCount: 0, totalCount: 0 },
      { problemId: 4, passedCount: 5, totalCount: 5 },
    ]);
    expect([...solved].sort((a, b) => a - b)).toEqual([1, 4]);
  });
});

describe("attemptCountsByProblem", () => {
  it("counts every run, passing or not", () => {
    const counts = attemptCountsByProblem([
      { problemId: 1, passedCount: 0, totalCount: 3 },
      { problemId: 1, passedCount: 3, totalCount: 3 },
      { problemId: 2, passedCount: 1, totalCount: 3 },
    ]);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(3)).toBeUndefined();
  });
});
