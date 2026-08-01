// =============================================================================
// Unit tests for display sorting. Pure — no database. Owner: leaderboard stream.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  defaultDirectionFor,
  parseDirection,
  parseSortKey,
  sortEntries,
  sortWeeklyEntries,
} from "./sorting";
import type { LeaderboardEntry, WeeklyLeaderboardEntry } from "./types";

function entry(over: Partial<LeaderboardEntry> & { studentId: number }): LeaderboardEntry {
  return {
    name: `Student ${over.studentId}`,
    avatarUrl: null,
    totalScore: 0,
    quizScore: 0,
    assignmentScore: 0,
    participationScore: 0,
    finalProjectScore: 0,
    ranking: over.studentId,
    avgStars: null,
    letterGrade: "F",
    isCurrentUser: false,
    ...over,
  };
}

function weekly(
  over: Partial<WeeklyLeaderboardEntry> & { studentId: number },
): WeeklyLeaderboardEntry {
  return {
    name: `Student ${over.studentId}`,
    avatarUrl: null,
    ranking: over.studentId,
    weekScore: 0,
    avgStars: null,
    lecturesCompleted: 0,
    quizCompleted: false,
    assignmentCompleted: false,
    isCurrentUser: false,
    ...over,
  };
}

describe("parseSortKey / parseDirection", () => {
  it("accepts every declared sort key", () => {
    for (const key of ["rank", "name", "total", "quiz", "assignment", "participation", "finalProject", "stars"]) {
      expect(parseSortKey(key)).toBe(key);
    }
  });

  it("falls back to rank for anything unrecognised", () => {
    expect(parseSortKey("email")).toBe("rank");
    expect(parseSortKey("'; drop table users; --")).toBe("rank");
    expect(parseSortKey(null)).toBe("rank");
    expect(parseSortKey(undefined)).toBe("rank");
  });

  it("returns null for a missing direction so the column default applies", () => {
    expect(parseDirection(null)).toBeNull();
    expect(parseDirection("sideways")).toBeNull();
    expect(parseDirection("asc")).toBe("asc");
    expect(parseDirection("desc")).toBe("desc");
  });

  it("defaults scores to descending and rank/name to ascending", () => {
    expect(defaultDirectionFor("rank")).toBe("asc");
    expect(defaultDirectionFor("name")).toBe("asc");
    expect(defaultDirectionFor("total")).toBe("desc");
    expect(defaultDirectionFor("stars")).toBe("desc");
  });
});

describe("sortEntries", () => {
  const rows = [
    entry({ studentId: 1, ranking: 2, totalScore: 80, quizScore: 20, avgStars: 3, name: "Bea" }),
    entry({ studentId: 2, ranking: 1, totalScore: 95, quizScore: 15, avgStars: null, name: "ada" }),
    entry({ studentId: 3, ranking: 3, totalScore: 60, quizScore: 18, avgStars: 5, name: "Cy" }),
  ];

  it("sorts by rank ascending by default", () => {
    expect(sortEntries(rows, "rank", "asc").map((r) => r.studentId)).toEqual([2, 1, 3]);
  });

  it("sorts by total descending", () => {
    expect(sortEntries(rows, "total", "desc").map((r) => r.totalScore)).toEqual([95, 80, 60]);
  });

  it("sorts by a component column independently of rank", () => {
    expect(sortEntries(rows, "quiz", "desc").map((r) => r.quizScore)).toEqual([20, 18, 15]);
  });

  it("sorts names case-insensitively", () => {
    expect(sortEntries(rows, "name", "asc").map((r) => r.name)).toEqual(["ada", "Bea", "Cy"]);
  });

  it("puts unrated students last in BOTH star directions", () => {
    expect(sortEntries(rows, "stars", "desc").at(-1)?.avgStars).toBeNull();
    expect(sortEntries(rows, "stars", "asc").at(-1)?.avgStars).toBeNull();
  });

  it("breaks display ties on rank, so the order stays deterministic", () => {
    const tied = [
      entry({ studentId: 1, ranking: 3, totalScore: 50 }),
      entry({ studentId: 2, ranking: 1, totalScore: 50 }),
      entry({ studentId: 3, ranking: 2, totalScore: 50 }),
    ];
    expect(sortEntries(tied, "total", "desc").map((r) => r.ranking)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.studentId);
    sortEntries(rows, "total", "desc");
    expect(rows.map((r) => r.studentId)).toEqual(before);
  });

  it("handles empty and single-row inputs", () => {
    expect(sortEntries([], "total", "desc")).toEqual([]);
    expect(sortEntries([rows[0]], "stars", "asc")).toHaveLength(1);
  });
});

describe("sortWeeklyEntries", () => {
  const rows = [
    weekly({ studentId: 1, ranking: 2, weekScore: 40, avgStars: 2 }),
    weekly({ studentId: 2, ranking: 1, weekScore: 70, avgStars: null }),
    weekly({ studentId: 3, ranking: 3, weekScore: 0, avgStars: 5 }),
  ];

  it("sorts by week score", () => {
    expect(sortWeeklyEntries(rows, "total", "desc").map((r) => r.weekScore)).toEqual([70, 40, 0]);
  });

  it("ignores columns a weekly board does not have and falls back to rank", () => {
    expect(sortWeeklyEntries(rows, "quiz", "desc").map((r) => r.ranking)).toEqual([1, 2, 3]);
  });

  it("handles the empty and single-student cases", () => {
    expect(sortWeeklyEntries([], "rank", "asc")).toEqual([]);
    expect(sortWeeklyEntries([rows[0]], "rank", "asc")).toHaveLength(1);
  });
});
