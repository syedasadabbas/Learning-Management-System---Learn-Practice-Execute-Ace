// =============================================================================
// DISTRIBUTION + HEATMAP TESTS.
// -----------------------------------------------------------------------------
// The load-bearing assertion here is that the letter bands are NOT restated in
// this stream: the expectations are computed from `courseMaxScore()` and compared
// against `letterGrade()`, both imported from the frozen scoring contract. If
// shared-contracts moves a cut-off, this test follows it instead of failing —
// which is the correct behaviour for a chart that must agree with the leaderboard.
// =============================================================================

import { describe, expect, it } from "vitest";

import { courseMaxScore, letterGrade } from "@/lib/contracts/scoring";

import { buildHeatmap, gradeDistribution, HOUR_BLOCKS, ISO_DAYS } from "./distribution";

describe("gradeDistribution", () => {
  const max = courseMaxScore();

  it("buckets by the scoring contract's own letterGrade, not a local copy", () => {
    const totals = [max, max * 0.85, max * 0.75, max * 0.65, 0];
    const dist = gradeDistribution(totals, 5);

    for (const total of totals) {
      const expected = letterGrade(total, max);
      const bucket = dist.buckets.find((b) => b.grade === expected);
      expect(bucket, `a bucket must exist for ${expected}`).toBeDefined();
      expect(bucket!.count).toBeGreaterThan(0);
    }
    expect(dist.buckets.reduce((n, b) => n + b.count, 0)).toBe(5);
    expect(dist.maxScore).toBe(max);
  });

  it("returns all five bands even when empty, so a flat bar is distinguishable from a missing one", () => {
    const dist = gradeDistribution([], 12);
    expect(dist.buckets.map((b) => b.grade)).toEqual(["A", "B", "C", "D", "F"]);
    expect(dist.buckets.every((b) => b.count === 0)).toBe(true);
    expect(dist.scoredStudentCount).toBe(0);
    expect(dist.unscoredStudentCount).toBe(12);
  });

  it("counts an unscored student as unscored, NOT as an F", () => {
    // A student with no leaderboard row has had nothing scored. "F" is a claim
    // about their work and would be a false one.
    const dist = gradeDistribution([max], 10);
    expect(dist.scoredStudentCount).toBe(1);
    expect(dist.unscoredStudentCount).toBe(9);
    expect(dist.buckets.find((b) => b.grade === "F")!.count).toBe(0);
  });

  it("never reports a negative unscored count when more totals than students arrive", () => {
    const dist = gradeDistribution([max, max, max], 1);
    expect(dist.unscoredStudentCount).toBe(0);
  });

  it("skips a non-finite total rather than turning the chart into NaN", () => {
    const dist = gradeDistribution([Number.NaN, max, Number.POSITIVE_INFINITY], 3);
    expect(dist.scoredStudentCount).toBe(1);
    expect(dist.buckets.reduce((n, b) => n + b.count, 0)).toBe(1);
  });
});

describe("buildHeatmap", () => {
  it("fills the whole 7x6 grid including quiet cells", () => {
    const map = buildHeatmap([{ dow: 1, block: 2, count: 5 }]);
    expect(map.cells.length).toBe(ISO_DAYS.length * HOUR_BLOCKS.length);
    expect(map.cells.length).toBe(42);
    expect(map.cells.filter((c) => c.count === 0).length).toBe(41);
    expect(map.max).toBe(5);
    expect(map.total).toBe(5);
  });

  it("scales intensity against the busiest cell", () => {
    const map = buildHeatmap([
      { dow: 1, block: 0, count: 10 },
      { dow: 2, block: 0, count: 5 },
    ]);
    expect(map.cells.find((c) => c.dow === 1 && c.block === 0)!.intensity).toBe(1);
    expect(map.cells.find((c) => c.dow === 2 && c.block === 0)!.intensity).toBe(0.5);
    expect(map.total).toBe(15);
  });

  it("gives every cell intensity 0 on an empty cohort — no division by zero", () => {
    const map = buildHeatmap([]);
    expect(map.max).toBe(0);
    expect(map.total).toBe(0);
    expect(map.cells.every((c) => c.intensity === 0)).toBe(true);
    expect(map.cells.every((c) => Number.isFinite(c.intensity))).toBe(true);
  });

  it("ignores a non-finite count", () => {
    const map = buildHeatmap([{ dow: 3, block: 3, count: Number.NaN }]);
    expect(map.total).toBe(0);
    expect(map.cells.every((c) => Number.isFinite(c.intensity))).toBe(true);
  });

  it("covers Monday..Sunday as ISO days 1..7", () => {
    // Postgres EXTRACT(ISODOW) is 1=Monday. A 0=Sunday assumption here would
    // silently rotate every column of the chart by one day.
    expect(ISO_DAYS.map((d) => d.dow)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ISO_DAYS[0]!.label).toBe("Mon");
  });

  it("covers the full 24 hours in six four-hour blocks", () => {
    expect(HOUR_BLOCKS.map((b) => b.block)).toEqual([0, 1, 2, 3, 4, 5]);
    // 23 / 4 === 5 in integer division, so hour 23 lands in the last block and
    // no event can fall outside the grid.
    expect(Math.trunc(23 / 4)).toBe(5);
  });
});
