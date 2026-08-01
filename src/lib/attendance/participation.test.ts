import { describe, expect, it } from "vitest";

import { POINTS } from "@/lib/contracts/scoring";

import {
  MIN_ATTENDANCE_PERCENT,
  participationForWeek,
  type AttendanceRecord,
} from "./participation";

function rec(
  lectureId: number,
  attended: boolean,
  participationScore = 0,
): AttendanceRecord {
  return { lectureId, attended, participationScore };
}

describe("participationForWeek", () => {
  it("reports zero for a week with no lectures", () => {
    const result = participationForWeek([], 0);
    expect(result.points).toBe(0);
    expect(result.meetsMinimumAttendance).toBe(false);
    expect(result.rationale).toContain("No lectures");
  });

  it("awards the full participation maximum for full attendance", () => {
    const records = [rec(1, true), rec(2, true), rec(3, true), rec(4, true)];
    const result = participationForWeek(records, 4);
    expect(result.attendanceRatePercent).toBe(100);
    expect(result.points).toBe(POINTS.PARTICIPATION_MAX);
  });

  it("awards zero below the 80% minimum (3 of 4 = 75%)", () => {
    const records = [rec(1, true), rec(2, true), rec(3, true), rec(4, false)];
    const result = participationForWeek(records, 4);
    expect(result.attendanceRatePercent).toBe(75);
    expect(result.meetsMinimumAttendance).toBe(false);
    expect(result.points).toBe(0);
    expect(result.rationale).toContain(`${MIN_ATTENDANCE_PERCENT}% minimum`);
  });

  it("awards points exactly at the 80% boundary (4 of 5)", () => {
    const records = [rec(1, true), rec(2, true), rec(3, true), rec(4, true), rec(5, false)];
    const result = participationForWeek(records, 5);
    expect(result.attendanceRatePercent).toBe(MIN_ATTENDANCE_PERCENT);
    expect(result.meetsMinimumAttendance).toBe(true);
    expect(result.points).toBe(8);
  });

  it("treats an unrecorded lecture as an absence", () => {
    // Two lectures recorded and attended, but the week has four: 50%, not 100%.
    const result = participationForWeek([rec(1, true), rec(2, true)], 4);
    expect(result.attendanceRatePercent).toBe(50);
    expect(result.points).toBe(0);
  });

  it("prefers the instructor's per-lecture participation scores when entered", () => {
    const records = [rec(1, true, 6), rec(2, true, 8), rec(3, true, 7), rec(4, true, 7)];
    const result = participationForWeek(records, 4);
    // mean(6,8,7,7) = 7
    expect(result.points).toBe(7);
    expect(result.rationale).toContain("instructor participation average");
  });

  it("gates instructor scores behind the attendance cliff", () => {
    // Perfect scores for the two lectures attended, but only 50% attendance.
    const records = [rec(1, true, 10), rec(2, true, 10), rec(3, false), rec(4, false)];
    expect(participationForWeek(records, 4).points).toBe(0);
  });

  it("never exceeds POINTS.PARTICIPATION_MAX even with out-of-range input", () => {
    const records = [rec(1, true, 999), rec(2, true, 999)];
    expect(participationForWeek(records, 2).points).toBe(POINTS.PARTICIPATION_MAX);
  });

  it("ignores absence rows when averaging instructor scores", () => {
    const records = [rec(1, true, 9), rec(2, true, 9), rec(3, true, 9), rec(4, true, 9)];
    expect(participationForWeek(records, 4).points).toBe(9);
  });
});
