// =============================================================================
// UNIT TESTS for the prerequisite graph — CYCLES ARE THE POINT.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// Requirement 1 of feature 8 is that "course A requiring B requiring A must be
// impossible or detected", and that "a DAG whose validity is only checked in the UI
// is not checked". This file is where that claim is actually made, because
// `wouldCreateCycle` and `findCycle` are pure functions with no database, no
// session and no browser — a form that refuses a click proves nothing about the
// rule, and an e2e spec proves it for exactly the two courses it seeded.
//
// The three layers of the defence and where each is verified:
//   1. self-edge — `course_prerequisites_no_self` CHECK in the schema, PLUS
//      `wouldCreateCycle` here. The CHECK is not unit-testable (it is SQL); the
//      function is, and it is what produces the readable refusal.
//   2. longer cycles — `wouldCreateCycle`, tested here across chains, diamonds and
//      disconnected components, and re-run inside the insert transaction under an
//      advisory lock (`insertPrerequisite`). The LOCK is the part these tests
//      cannot reach; it is called out as unverified in the stream report.
//   3. the tripwire — `findCycle`, tested here on data no application path can
//      produce, which is precisely the data it exists to catch.
//
// Every traversal is also asserted to TERMINATE on cyclic input. A hang in
// `prerequisiteClosure` would be an unexplained lockout on a student's page, which
// is worse than a wrong answer because it has no message at all.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  buildRequirementMap,
  findCycle,
  prerequisiteClosure,
  reaches,
  topologicalOrder,
  wouldCreateCycle,
  type PrerequisiteEdge,
} from "./graph";

/** `edge(2, 1)` reads as "course 2 requires course 1". */
function edge(courseId: number, prerequisiteCourseId: number): PrerequisiteEdge {
  return { courseId, prerequisiteCourseId };
}

// ---------------------------------------------------------------------------
describe("wouldCreateCycle — the check that makes A->B->A impossible", () => {
  it("refuses a self-reference", () => {
    // Also forbidden by a database CHECK. Asserted here because this branch is
    // what turns it into a sentence an admin can read instead of a constraint
    // violation.
    expect(wouldCreateCycle([], edge(1, 1))).toBe(true);
  });

  it("refuses the two-course cycle: B requires A, then A requires B", () => {
    // THE headline case from the requirement. If this ever returns false, two
    // courses can be made permanently un-enterable by two ordinary edits.
    const existing = [edge(2, 1)]; // 2 requires 1
    expect(wouldCreateCycle(existing, edge(1, 2))).toBe(true); // 1 requires 2 -> cycle
  });

  it("refuses a cycle closed through a long chain", () => {
    // 5 -> 4 -> 3 -> 2 -> 1. Adding "1 requires 5" closes it.
    const chain = [edge(5, 4), edge(4, 3), edge(3, 2), edge(2, 1)];
    expect(wouldCreateCycle(chain, edge(1, 5))).toBe(true);
  });

  it("allows a second, independent edge into the same prerequisite", () => {
    // A diamond is a DAG. Refusing this would make "two courses both need the
    // fundamentals course" impossible, which is the most ordinary shape there is.
    const existing = [edge(2, 1)];
    expect(wouldCreateCycle(existing, edge(3, 1))).toBe(false);
  });

  it("allows a diamond to close: 4 requires both 2 and 3, which both require 1", () => {
    const existing = [edge(2, 1), edge(3, 1), edge(4, 2)];
    expect(wouldCreateCycle(existing, edge(4, 3))).toBe(false);
  });

  it("allows an edge between disconnected components", () => {
    const existing = [edge(2, 1), edge(4, 3)];
    expect(wouldCreateCycle(existing, edge(3, 1))).toBe(false);
  });

  it("allows the reverse of an edge that does NOT exist", () => {
    // Guards against an over-eager implementation that treats any shared node as
    // a cycle.
    const existing = [edge(2, 1)];
    expect(wouldCreateCycle(existing, edge(1, 3))).toBe(false);
  });

  it("does not mutate the edge list it was given", () => {
    // The insert path passes the freshly-read edges straight in. A function that
    // appended the candidate would make the SECOND call in a transaction see a
    // graph that was never committed.
    const existing = [edge(2, 1)];
    const snapshot = JSON.stringify(existing);
    wouldCreateCycle(existing, edge(1, 2));
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("terminates on an ALREADY cyclic graph instead of recursing forever", () => {
    // Unreachable through the app, reachable through a restored dump. The
    // requirement is that the answer arrives at all.
    const cyclic = [edge(1, 2), edge(2, 1)];
    expect(wouldCreateCycle(cyclic, edge(3, 1))).toBe(false);
  });

  it("scales to a deep chain without a stack overflow", () => {
    // 500 courses in a line. The walk is iterative precisely so this returns an
    // answer rather than throwing RangeError inside a gate, where the surrounding
    // catch would decide the access outcome.
    const deep: PrerequisiteEdge[] = [];
    for (let i = 2; i <= 500; i += 1) deep.push(edge(i, i - 1));
    expect(wouldCreateCycle(deep, edge(1, 500))).toBe(true);
    expect(wouldCreateCycle(deep, edge(1, 501))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("reaches — the primitive the cycle check is built on", () => {
  it("treats a node as reaching itself", () => {
    expect(reaches(buildRequirementMap([]), 1, 1)).toBe(true);
  });

  it("follows the courseId -> prerequisiteCourseId direction, not the reverse", () => {
    // Direction is the thing every reader gets wrong once, so it is pinned.
    const map = buildRequirementMap([edge(2, 1)]); // 2 requires 1
    expect(reaches(map, 2, 1)).toBe(true);
    expect(reaches(map, 1, 2)).toBe(false);
  });

  it("follows a transitive chain", () => {
    const map = buildRequirementMap([edge(3, 2), edge(2, 1)]);
    expect(reaches(map, 3, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("findCycle — the tripwire for data the application cannot create", () => {
  it("returns null for an empty graph", () => {
    expect(findCycle([])).toBeNull();
  });

  it("returns null for a DAG, including a diamond", () => {
    expect(findCycle([edge(2, 1), edge(3, 1), edge(4, 2), edge(4, 3)])).toBeNull();
  });

  it("names a two-course cycle, closing on the node it started from", () => {
    const found = findCycle([edge(1, 2), edge(2, 1)]);
    expect(found).not.toBeNull();
    // The banner has to PRINT the cycle, so the closing node is repeated. A
    // detector that only said "yes" would give an admin nothing to act on.
    expect(found![0]).toBe(found![found!.length - 1]);
    expect(new Set(found!)).toEqual(new Set([1, 2]));
  });

  it("names a three-course cycle", () => {
    const found = findCycle([edge(1, 2), edge(2, 3), edge(3, 1)]);
    expect(found).not.toBeNull();
    expect(new Set(found!)).toEqual(new Set([1, 2, 3]));
  });

  it("finds a cycle that is not reachable from the first node it visits", () => {
    // A DFS that only rooted at nodes with outgoing edges, in insertion order,
    // could miss this. The 1->2 chain is explored and exhausted first.
    const found = findCycle([edge(1, 2), edge(3, 4), edge(4, 3)]);
    expect(found).not.toBeNull();
    expect(new Set(found!)).toEqual(new Set([3, 4]));
  });

  it("finds a self-edge, which no application path can create", () => {
    expect(findCycle([edge(1, 1)])).not.toBeNull();
  });

  it("does not report a cycle for a node visited twice by different parents", () => {
    // The classic false positive: a shared prerequisite is not a back edge.
    expect(findCycle([edge(3, 1), edge(2, 1), edge(4, 2), edge(4, 3)])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("prerequisiteClosure — for DISPLAY, and it must always terminate", () => {
  it("is empty for a course with no requirements", () => {
    expect(prerequisiteClosure([edge(2, 1)], 3)).toEqual([]);
  });

  it("excludes the course itself", () => {
    expect(prerequisiteClosure([edge(2, 1)], 2)).toEqual([1]);
  });

  it("lists nearest requirements before deeper ones", () => {
    // Breadth-first, because the order a student can act on is "what blocks me
    // now", not "what blocks the thing that blocks me".
    const edges = [edge(4, 3), edge(3, 2), edge(2, 1)];
    expect(prerequisiteClosure(edges, 4)).toEqual([3, 2, 1]);
  });

  it("de-duplicates a diamond", () => {
    const edges = [edge(4, 2), edge(4, 3), edge(2, 1), edge(3, 1)];
    const closure = prerequisiteClosure(edges, 4);
    expect(closure.filter((id) => id === 1)).toHaveLength(1);
    expect(new Set(closure)).toEqual(new Set([2, 3, 1]));
  });

  it("TERMINATES on a cyclic graph", () => {
    // The assertion that matters most in this describe block. Without the visited
    // set this test would never finish, and in production it would be a hung
    // request on a student's course page — a lockout with no message.
    const cyclic = [edge(1, 2), edge(2, 3), edge(3, 1)];
    expect(new Set(prerequisiteClosure(cyclic, 1))).toEqual(new Set([2, 3]));
  });
});

// ---------------------------------------------------------------------------
describe("topologicalOrder — the derived learning path", () => {
  it("orders prerequisites before the courses that need them", () => {
    const order = topologicalOrder([edge(3, 2), edge(2, 1)], [1, 2, 3]);
    expect(order.cycle).toBeNull();
    expect(order.order).toEqual([1, 2, 3]);
  });

  it("keeps the caller's order among courses of equal rank", () => {
    // Stability matters: an admin page whose list reshuffles between reloads looks
    // broken even when every position is valid.
    const order = topologicalOrder([], [3, 1, 2]);
    expect(order.order).toEqual([3, 1, 2]);
  });

  it("ignores edges pointing outside the selected set", () => {
    const order = topologicalOrder([edge(2, 99)], [1, 2]);
    expect(order.cycle).toBeNull();
    expect(order.order).toEqual([1, 2]);
  });

  it("returns the orderable prefix PLUS the cycle when one exists", () => {
    // A partial answer plus the named defect beats throwing: the admin page still
    // renders the usable part and says what is wrong with the rest.
    const order = topologicalOrder([edge(2, 3), edge(3, 2)], [1, 2, 3]);
    expect(order.order).toEqual([1]);
    expect(order.cycle).not.toBeNull();
    expect(new Set(order.cycle!)).toEqual(new Set([2, 3]));
  });

  it("handles an empty selection", () => {
    expect(topologicalOrder([edge(2, 1)], [])).toEqual({ order: [], cycle: null });
  });
});
