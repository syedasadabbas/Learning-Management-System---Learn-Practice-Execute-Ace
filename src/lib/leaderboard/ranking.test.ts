// =============================================================================
// Unit tests for the leaderboard ranking maths. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// No database. Nothing in this file imports src/db — that is the whole reason
// ranking.ts is a pure module (see tests/setup.ts: a unit test reaching the real
// Neon database is a design smell). The SQL half of the write path is exercised
// by the Playwright spec in tests/e2e/leaderboard/.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { ScoringEvent, ScoringSource } from "@/lib/contracts/events";
import { POINTS, courseMaxScore } from "@/lib/contracts/scoring";
import {
  COLUMN_FOR_SOURCE,
  ZERO_SCORES,
  applyPoints,
  assignRanks,
  compareForRank,
  componentCaps,
  isMeaningfulEvent,
  rankOf,
  totalOf,
  type ComponentScores,
  type RankableRow,
} from "./ranking";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(over: Partial<RankableRow> & { studentId: number }): RankableRow {
  return {
    totalScore: 0,
    avgStars: null,
    finalProjectScore: 0,
    firstSubmittedAtMs: null,
    ...over,
  };
}

function event(over: Partial<ScoringEvent> = {}): ScoringEvent {
  return {
    studentId: 1,
    cohortId: 1,
    source: "quiz",
    weekId: 1,
    points: 20,
    ...over,
  };
}

const ALL_SOURCES: readonly ScoringSource[] = [
  "quiz",
  "assignment",
  "participation",
  "final_project",
];

// ---------------------------------------------------------------------------
// Source -> column mapping (requirement: points land in the right column)
// ---------------------------------------------------------------------------

describe("COLUMN_FOR_SOURCE", () => {
  it("maps every scoring source to its leaderboard column", () => {
    expect(COLUMN_FOR_SOURCE).toEqual({
      quiz: "quizScore",
      assignment: "assignmentScore",
      participation: "participationScore",
      final_project: "finalProjectScore",
    });
  });

  it("covers every source in the frozen contract with no extras", () => {
    expect(Object.keys(COLUMN_FOR_SOURCE).sort()).toEqual([...ALL_SOURCES].sort());
  });
});

describe("applyPoints — points land in the column matching the source", () => {
  it.each([
    ["quiz", "quizScore"],
    ["assignment", "assignmentScore"],
    ["participation", "participationScore"],
    ["final_project", "finalProjectScore"],
  ] as const)("source %s writes to %s and leaves the others alone", (source, column) => {
    const next = applyPoints({ ...ZERO_SCORES }, source, 7);

    expect(next[column]).toBe(7);
    for (const other of Object.values(COLUMN_FOR_SOURCE)) {
      if (other !== column) expect(next[other]).toBe(0);
    }
  });

  it("recomputes totalScore as the sum of the four components", () => {
    let scores: ComponentScores = { ...ZERO_SCORES };
    scores = applyPoints(scores, "quiz", 20);
    scores = applyPoints(scores, "assignment", 36);
    scores = applyPoints(scores, "participation", 8);
    const final = applyPoints(scores, "final_project", 27);

    expect(final.quizScore).toBe(20);
    expect(final.assignmentScore).toBe(36);
    expect(final.participationScore).toBe(8);
    expect(final.finalProjectScore).toBe(27);
    expect(final.totalScore).toBe(91);
    expect(final.totalScore).toBe(totalOf(final));
  });

  it("accumulates weekly sources across weeks", () => {
    let scores: ComponentScores = { ...ZERO_SCORES };
    for (let week = 0; week < 4; week += 1) {
      scores = applyPoints(scores, "quiz", POINTS.QUIZ_MAX);
    }
    expect(scores.quizScore).toBe(4 * POINTS.QUIZ_MAX);
  });

  it("treats final_project as a single slot: re-delivery is a no-op", () => {
    const once = applyPoints({ ...ZERO_SCORES }, "final_project", 25);
    const twice = applyPoints(once, "final_project", 25);

    expect(twice.finalProjectScore).toBe(25);
    expect(twice.totalScore).toBe(once.totalScore);
  });

  it("lets a final-project regrade upward through, but not downward", () => {
    const first = applyPoints({ ...ZERO_SCORES }, "final_project", 20);
    expect(applyPoints(first, "final_project", 28).finalProjectScore).toBe(28);
    // TODO(leaderboard): a downward final-project regrade needs rebuildLeaderboard()
    // (or a set-semantics event) — max() cannot express it. Documented in
    // rebuild.ts; harmless today because regrades only ever go up after appeal.
    expect(applyPoints(first, "final_project", 12).finalProjectScore).toBe(20);
  });

  it("clamps each component to its course-wide ceiling", () => {
    const caps = componentCaps(4);
    const over = applyPoints({ ...ZERO_SCORES }, "quiz", caps.quizScore + 500);
    expect(over.quizScore).toBe(caps.quizScore);
  });

  it("never lets a duplicated event push the total above courseMaxScore()", () => {
    let scores: ComponentScores = { ...ZERO_SCORES };
    // Deliver every weekly award 50 times — the pathological retry storm.
    for (let i = 0; i < 50; i += 1) {
      scores = applyPoints(scores, "quiz", POINTS.QUIZ_MAX);
      scores = applyPoints(scores, "assignment", POINTS.ASSIGNMENT_MAX);
      scores = applyPoints(scores, "participation", POINTS.PARTICIPATION_MAX);
      scores = applyPoints(scores, "final_project", POINTS.FINAL_PROJECT_MAX);
    }
    expect(totalOf(scores)).toBeLessThanOrEqual(courseMaxScore());
    expect(applyPoints(scores, "quiz", 999).totalScore).toBeLessThanOrEqual(
      courseMaxScore(),
    );
  });

  it("ignores negative and non-finite points instead of corrupting the total", () => {
    const base: ComponentScores = { ...ZERO_SCORES, quizScore: 10 };
    expect(applyPoints(base, "quiz", -50).quizScore).toBe(10);
    expect(applyPoints(base, "quiz", Number.NaN).quizScore).toBe(10);
    expect(applyPoints(base, "quiz", Number.NaN).totalScore).toBe(10);
    expect(applyPoints(base, "quiz", Number.POSITIVE_INFINITY).totalScore).toBe(10);
  });

  it("does not mutate the row it was given", () => {
    const base: ComponentScores = { ...ZERO_SCORES };
    applyPoints(base, "quiz", 20);
    expect(base).toEqual(ZERO_SCORES);
  });

  it("rounds fractional awards to whole points (the columns are integers)", () => {
    expect(applyPoints({ ...ZERO_SCORES }, "assignment", 36.4).assignmentScore).toBe(36);
    expect(applyPoints({ ...ZERO_SCORES }, "assignment", 36.5).assignmentScore).toBe(37);
  });
});

describe("componentCaps", () => {
  it("derives weekly ceilings from scoring.ts and the course length", () => {
    expect(componentCaps(4)).toEqual({
      quizScore: 4 * POINTS.QUIZ_MAX,
      assignmentScore: 4 * POINTS.ASSIGNMENT_MAX,
      participationScore: 4 * POINTS.PARTICIPATION_MAX,
      finalProjectScore: POINTS.FINAL_PROJECT_MAX,
    });
  });

  it("sums to courseMaxScore() for the same week count", () => {
    for (const weekCount of [1, 4, 12]) {
      expect(totalOf(componentCaps(weekCount))).toBe(courseMaxScore(weekCount));
    }
  });

  it("does not go negative for a nonsense week count", () => {
    expect(componentCaps(-3).quizScore).toBe(0);
  });
});

describe("isMeaningfulEvent", () => {
  it("accepts a normal event", () => {
    expect(isMeaningfulEvent(event())).toBe(true);
  });

  it("rejects a non-positive or non-integer student id", () => {
    expect(isMeaningfulEvent(event({ studentId: 0 }))).toBe(false);
    expect(isMeaningfulEvent(event({ studentId: -1 }))).toBe(false);
    expect(isMeaningfulEvent(event({ studentId: 1.5 }))).toBe(false);
  });

  it("rejects non-finite points", () => {
    expect(isMeaningfulEvent(event({ points: Number.NaN }))).toBe(false);
  });

  it("accepts a null cohort — an unassigned student still has a standing", () => {
    expect(isMeaningfulEvent(event({ cohortId: null }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rank assignment
// ---------------------------------------------------------------------------

describe("assignRanks — ordering", () => {
  it("orders by totalScore descending", () => {
    const ranked = assignRanks([
      row({ studentId: 1, totalScore: 40 }),
      row({ studentId: 2, totalScore: 90 }),
      row({ studentId: 3, totalScore: 65 }),
    ]);

    expect(ranked.map((r) => r.studentId)).toEqual([2, 3, 1]);
    expect(ranked.map((r) => r.ranking)).toEqual([1, 2, 3]);
  });

  it("produces ordinal ranks with no duplicates and no gaps", () => {
    const ranked = assignRanks(
      Array.from({ length: 12 }, (_, i) => row({ studentId: i + 1, totalScore: 50 })),
    );
    expect(ranked.map((r) => r.ranking)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(ranked.map((r) => r.ranking)).size).toBe(12);
  });

  it("does not mutate the input array", () => {
    const input = [row({ studentId: 1, totalScore: 1 }), row({ studentId: 2, totalScore: 9 })];
    const snapshot = input.map((r) => r.studentId);
    assignRanks(input);
    expect(input.map((r) => r.studentId)).toEqual(snapshot);
  });
});

describe("assignRanks — tie-breaks, in documented precedence", () => {
  it("1) totalScore beats every other key", () => {
    const ranked = assignRanks([
      row({ studentId: 1, totalScore: 10, avgStars: 5, finalProjectScore: 30 }),
      row({ studentId: 2, totalScore: 11, avgStars: 1, finalProjectScore: 0 }),
    ]);
    expect(ranked[0].studentId).toBe(2);
  });

  it("2) equal totals: higher average stars wins", () => {
    const ranked = assignRanks([
      row({ studentId: 1, totalScore: 100, avgStars: 3 }),
      row({ studentId: 2, totalScore: 100, avgStars: 4.5 }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([2, 1]);
  });

  it("2) an unrated student never out-ranks a rated one (nulls last)", () => {
    const ranked = assignRanks([
      row({ studentId: 1, totalScore: 100, avgStars: null }),
      row({ studentId: 2, totalScore: 100, avgStars: 1 }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([2, 1]);
  });

  it("3) equal totals and stars: higher final-project score wins", () => {
    const ranked = assignRanks([
      row({ studentId: 1, totalScore: 100, avgStars: 4, finalProjectScore: 10 }),
      row({ studentId: 2, totalScore: 100, avgStars: 4, finalProjectScore: 25 }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([2, 1]);
  });

  it("4) then the earliest submission wins", () => {
    const ranked = assignRanks([
      row({
        studentId: 1,
        totalScore: 100,
        avgStars: 4,
        finalProjectScore: 10,
        firstSubmittedAtMs: 2_000,
      }),
      row({
        studentId: 2,
        totalScore: 100,
        avgStars: 4,
        finalProjectScore: 10,
        firstSubmittedAtMs: 1_000,
      }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([2, 1]);
  });

  it("4) a student who has never submitted sorts last on that key", () => {
    const ranked = assignRanks([
      row({ studentId: 1, totalScore: 100, avgStars: 4, firstSubmittedAtMs: null }),
      row({ studentId: 2, totalScore: 100, avgStars: 4, firstSubmittedAtMs: 9_999_999 }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([2, 1]);
  });

  it("5) a total tie falls back to studentId ascending", () => {
    const ranked = assignRanks([
      row({ studentId: 7, totalScore: 50 }),
      row({ studentId: 3, totalScore: 50 }),
      row({ studentId: 11, totalScore: 50 }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([3, 7, 11]);
  });

  it("is STABLE: the same rows in any input order rank identically", () => {
    // This is the flicker regression. Ranks must not depend on the order the
    // driver happened to return rows in.
    const rows = [
      row({ studentId: 4, totalScore: 100, avgStars: 4 }),
      row({ studentId: 9, totalScore: 100, avgStars: 4 }),
      row({ studentId: 2, totalScore: 100, avgStars: null }),
      row({ studentId: 6, totalScore: 100, avgStars: 4 }),
    ];
    const expected = assignRanks(rows).map((r) => r.studentId);

    for (const permutation of [
      [...rows].reverse(),
      [rows[2], rows[0], rows[3], rows[1]],
      [rows[3], rows[2], rows[1], rows[0]],
    ]) {
      expect(assignRanks(permutation).map((r) => r.studentId)).toEqual(expected);
    }
  });

  it("compareForRank is a total order — no pair ever compares as equal", () => {
    const rows = [
      row({ studentId: 1 }),
      row({ studentId: 2 }),
      row({ studentId: 3, totalScore: 5 }),
    ];
    for (const a of rows) {
      for (const b of rows) {
        if (a === b) expect(compareForRank(a, b)).toBe(0);
        else expect(compareForRank(a, b)).not.toBe(0);
      }
    }
  });

  it("is antisymmetric: compare(a,b) and compare(b,a) have opposite signs", () => {
    const a = row({ studentId: 1, totalScore: 10, avgStars: 2 });
    const b = row({ studentId: 2, totalScore: 10, avgStars: 4 });
    expect(Math.sign(compareForRank(a, b))).toBe(-Math.sign(compareForRank(b, a)));
  });
});

describe("assignRanks — degenerate cohorts", () => {
  it("an empty cohort returns an empty array, not an error", () => {
    expect(assignRanks([])).toEqual([]);
  });

  it("a cohort of one gets rank 1", () => {
    const ranked = assignRanks([row({ studentId: 42, totalScore: 0 })]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].ranking).toBe(1);
    expect(ranked[0].studentId).toBe(42);
  });

  it("a fresh cohort where everyone is on zero still gets stable 1..N ranks", () => {
    const ranked = assignRanks([
      row({ studentId: 5 }),
      row({ studentId: 1 }),
      row({ studentId: 3 }),
    ]);
    expect(ranked.map((r) => r.studentId)).toEqual([1, 3, 5]);
    expect(ranked.map((r) => r.ranking)).toEqual([1, 2, 3]);
  });

  it("preserves extra fields on the rows it ranks", () => {
    const ranked = assignRanks([{ ...row({ studentId: 1, totalScore: 5 }), name: "Ada" }]);
    expect(ranked[0].name).toBe("Ada");
  });
});

describe("rankOf", () => {
  const rows = [
    row({ studentId: 1, totalScore: 30 }),
    row({ studentId: 2, totalScore: 90 }),
    row({ studentId: 3, totalScore: 60 }),
  ];

  it("agrees with assignRanks for every member", () => {
    for (const ranked of assignRanks(rows)) {
      expect(rankOf(rows, ranked.studentId)).toBe(ranked.ranking);
    }
  });

  it("returns null for someone outside the set", () => {
    expect(rankOf(rows, 999)).toBeNull();
  });

  it("returns null for an empty set", () => {
    expect(rankOf([], 1)).toBeNull();
  });
});
