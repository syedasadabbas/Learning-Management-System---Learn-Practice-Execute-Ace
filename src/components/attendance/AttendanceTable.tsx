"use client";

import * as React from "react";

import { Badge, EmptyState } from "@/components/ui";
import { MIN_ATTENDANCE_PERCENT } from "@/lib/attendance";
import { POINTS } from "@/lib/contracts/scoring";

import { AttendanceToggle } from "./AttendanceToggle";

export type AttendanceTableLecture = {
  id: number;
  lectureNumber: number;
  title: string;
};

export type AttendanceTableStudent = {
  studentId: number;
  name: string;
  /** lectureId -> recorded state. A missing key means "not recorded" = absent. */
  marks: Record<number, { attended: boolean; participationScore: number }>;
  participation: {
    lecturesAttended: number;
    lectureTotal: number;
    attendanceRatePercent: number;
    meetsMinimumAttendance: boolean;
    points: number;
  };
};

export interface AttendanceTableProps {
  weekId: number;
  lectures: readonly AttendanceTableLecture[];
  students: readonly AttendanceTableStudent[];
  /**
   * Server action bound by the page. Passing it in keeps this component free of
   * any server import and makes it renderable in a unit test with a stub.
   */
  onMark: (input: {
    studentId: number;
    lectureId: number;
    weekId: number;
    attended: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Instructor attendance grid: one row per student, one checkbox per lecture, and
 * the resulting weekly participation points.
 *
 * The participation column is derived, never edited here — it comes from
 * `participationForWeek`, so the 80% cliff is applied in one place and this table
 * only reports it. Values refresh when the server action revalidates the page.
 */
export function AttendanceTable({
  weekId,
  lectures,
  students,
  onMark,
}: AttendanceTableProps) {
  if (lectures.length === 0) {
    return (
      <EmptyState
        title="No lectures in this week"
        description="Attendance can be recorded once this week has lectures."
      />
    );
  }
  if (students.length === 0) {
    return (
      <EmptyState
        title="No students enrolled"
        description="Enrol students in this cohort to record attendance."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm" data-testid="attendance-table">
        <caption className="sr-only">
          Attendance and participation for the selected week
        </caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="px-3 py-2 font-semibold">
              Student
            </th>
            {lectures.map((l) => (
              <th key={l.id} scope="col" className="px-3 py-2 text-center font-semibold">
                <abbr title={l.title} className="no-underline">
                  L{l.lectureNumber}
                </abbr>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Attendance
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Participation
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.studentId} className="border-b border-line/60">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {s.name}
              </th>
              {lectures.map((l) => (
                <td key={l.id} className="px-3 py-2 text-center">
                  <AttendanceToggle
                    studentId={s.studentId}
                    lectureId={l.id}
                    attended={s.marks[l.id]?.attended ?? false}
                    label={`${s.name} — ${l.title}`}
                    onChange={(next) =>
                      onMark({
                        studentId: s.studentId,
                        lectureId: l.id,
                        weekId,
                        attended: next,
                      })
                    }
                  />
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">
                {s.participation.lecturesAttended}/{s.participation.lectureTotal} (
                {s.participation.attendanceRatePercent}%)
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className="inline-flex items-center gap-2"
                  data-testid={`participation-${s.studentId}`}
                >
                  <span className="tabular-nums">
                    {s.participation.points}/{POINTS.PARTICIPATION_MAX}
                  </span>
                  {!s.participation.meetsMinimumAttendance && (
                    <Badge tone="danger" size="sm">
                      &lt;{MIN_ATTENDANCE_PERCENT}%
                    </Badge>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
