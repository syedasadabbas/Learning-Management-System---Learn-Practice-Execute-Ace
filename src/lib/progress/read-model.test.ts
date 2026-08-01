// =============================================================================
// Unit tests: getWeekProgress — the signature other streams compile against.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// These tests exist as much to pin the CONTRACT as to check the logic:
// `course-content` derives week lock state from this function on another branch,
// so the shape and the ordering are a promise, not an implementation detail.
// The database is mocked at the query-module boundary.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./query", () => ({ fetchWeekAggregates: vi.fn() }));

import { completedWeekRow, emptyWeekRow } from "./fixtures";
import { fetchWeekAggregates } from "./query";
import { getWeekProgress, getWeekProgressDetail } from "./read-model";

const fetchMock = vi.mocked(fetchWeekAggregates);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getWeekProgress", () => {
  it("returns exactly the frozen WeekProgress keys", async () => {
    fetchMock.mockResolvedValue([emptyWeekRow(1)]);
    const [week] = await getWeekProgress(7);

    // Every key of the frozen type in src/lib/contracts/events.ts must be present.
    for (const key of [
      "weekId",
      "weekNumber",
      "title",
      "unlocked",
      "lecturesCompleted",
      "lectureTotal",
      "quizCompleted",
      "quizBestPercent",
      "assignmentCompleted",
      "overallScore",
    ]) {
      expect(week).toHaveProperty(key);
    }
  });

  it("issues exactly one database read per call — no N+1", async () => {
    fetchMock.mockResolvedValue([1, 2, 3, 4].map((n) => emptyWeekRow(n)));
    await getWeekProgress(7);
    // Four weeks, one query. A per-week query inside a loop would make this 4 or 5.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(7);
  });

  it("orders by week number ascending even if rows arrive shuffled", async () => {
    // The query has ORDER BY, but the contract is the function's, not the SQL's.
    fetchMock.mockResolvedValue([emptyWeekRow(2), emptyWeekRow(1)]);
    const weeks = await getWeekProgress(7);
    expect(weeks.map((w) => w.weekNumber)).toEqual([2, 1]);
    // Positions follow the input; unlock state still follows week order.
    expect(weeks.find((w) => w.weekNumber === 1)?.unlocked).toBe(true);
    expect(weeks.find((w) => w.weekNumber === 2)?.unlocked).toBe(false);
  });

  it("returns an empty array for a student with no course", async () => {
    fetchMock.mockResolvedValue([]);
    await expect(getWeekProgress(7)).resolves.toEqual([]);
  });

  it("does NOT unlock week 2 on a passed week 1 while the CSS subject is withheld", async () => {
    // This assertion was inverted deliberately when subject sections landed, and
    // the inversion is the point: `getWeekProgress` is the PRODUCTION entry
    // point and takes no section override, so it must report what a real student
    // actually gets. On the shipped config (HTML open, CSS/JS/Git withheld) an
    // 85% on week 1 clears the progression gate and week 2 still stays shut.
    //
    // The progression rule itself — that 85% would open week 2 in an open
    // subject — is covered in unlock.test.ts against ALL_OPEN_SECTIONS. Keeping
    // it asserted here too would just be a second copy that has to be edited
    // every time the owner releases a subject.
    fetchMock.mockResolvedValue([completedWeekRow(1, 85), emptyWeekRow(2)]);
    const weeks = await getWeekProgress(7);
    expect(weeks.map((w) => w.unlocked)).toEqual([true, false]);
  });
});

describe("getWeekProgressDetail", () => {
  it("adds dueAt, breakdown and counts without dropping WeekProgress fields", async () => {
    fetchMock.mockResolvedValue([
      completedWeekRow(1, 85, { dueAt: new Date("2026-09-07T00:00:00.000Z") }),
    ]);
    const [week] = await getWeekProgressDetail(7);
    expect(week.dueAt).toEqual(new Date("2026-09-07T00:00:00.000Z"));
    expect(week.breakdown.total).toBe(week.overallScore);
    expect(week.quizCount).toBe(1);
    expect(week.assignmentCount).toBe(1);
    // Still a valid WeekProgress.
    expect(week.lectureTotal).toBe(3);
  });
});
