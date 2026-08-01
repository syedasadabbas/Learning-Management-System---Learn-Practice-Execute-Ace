"use client";

// =============================================================================
// <AttendanceReport /> — the instructor's roster for one class.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// STAFF-ONLY, AND THE ROUTE IS WHAT ENFORCES IT.
// `GET /api/classes/:id/attendance` is `ROUTE_AUTH: "instructor"` and further
// filters on class ownership in its WHERE clause. This component renders no
// permission check of its own beyond not being mounted on a student page,
// because a UI-level check is a suggestion and the WHERE clause is the control.
//
// IT IS A REAL <table>. A grid of divs with `role="row"` is the usual outcome of
// wanting Tailwind control over cells, and it loses everything a screen-reader
// user needs: column headers announced with each cell, row and column counts,
// and the table navigation commands. Twelve students' attendance is exactly the
// kind of data that is unreadable without them. It scrolls horizontally INSIDE
// its own container at narrow widths — the page never does.
//
// `markedPresent` IS EDITABLE AND IT IS NOT THE SAME AS HAVING A ROW.
// `patchAttendanceSchema`'s comment makes the distinction: the row says "this
// account opened the session", the flag says "I count this as attendance". The
// toggle is optimistic and rolls back, matching ChatPanel.
//
// Durations are MINUTES throughout, which is what the column stores.
// =============================================================================

import * as React from "react";

import { AsyncSection } from "@/components/async/AsyncSection";
import { LiveRegion, useAnnouncer } from "@/components/learn/visualizations/controls";
import { Badge, Button, cn } from "@/components/ui";
import { apiPath, apiPathWithQuery, apiRequest } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";

import type { AttendanceReportPayload, AttendanceRow } from "./types";

const ATTENDANCE_GET = "GET  /api/classes/:classId/attendance" as const;
const ATTENDANCE_PATCH = "PATCH /api/classes/:classId/attendance/:studentId" as const;

export interface AttendanceReportProps {
  classId: number;
  /** Allow editing `markedPresent`. The route enforces it regardless. */
  editable?: boolean;
  className?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Attendance as a percentage of the class's planned length.
 *
 * Clamped to 100: a student who joins early and leaves late legitimately
 * accumulates more minutes than the class was scheduled for, and "112% present"
 * in a report is a number an instructor has to stop and reason about.
 */
export function presencePercent(minutes: number, classDurationMinutes: number): number {
  if (classDurationMinutes <= 0) return 0;
  return Math.min(100, Math.round((minutes / classDurationMinutes) * 100));
}

export function AttendanceReport({
  classId,
  editable = true,
  className,
  fetchImpl,
}: AttendanceReportProps) {
  const url = React.useMemo(
    () => apiPathWithQuery(ATTENDANCE_GET, { classId }, { limit: 100 }),
    [classId],
  );

  const { state, reload, setData } = useApiResource<AttendanceReportPayload>(
    ATTENDANCE_GET,
    url,
    { fetchImpl },
  );
  const { message, announce } = useAnnouncer();
  const [savingFor, setSavingFor] = React.useState<number | null>(null);

  async function togglePresent(row: AttendanceRow): Promise<void> {
    const next = !row.markedPresent;
    setSavingFor(row.studentId);

    setData((page) =>
      page === null
        ? page
        : {
            ...page,
            items: page.items.map((item) =>
              item.studentId === row.studentId ? { ...item, markedPresent: next } : item,
            ),
          },
    );

    const result = await apiRequest<AttendanceRow>(
      ATTENDANCE_PATCH,
      apiPath(ATTENDANCE_PATCH, { classId, studentId: row.studentId }),
      { body: { markedPresent: next }, fetchImpl },
    );
    setSavingFor(null);

    if (!result.ok) {
      if (result.aborted) return;
      // Roll back to the value we started from, not to `!next` — those differ
      // if a poll landed in between.
      setData((page) =>
        page === null
          ? page
          : {
              ...page,
              items: page.items.map((item) =>
                item.studentId === row.studentId
                  ? { ...item, markedPresent: row.markedPresent }
                  : item,
              ),
            },
      );
      announce(`Could not update ${row.studentName ?? "the student"}. ${result.error}`);
      return;
    }

    announce(
      `${row.studentName ?? "Student"} marked ${next ? "present" : "not counted"}.`,
    );
  }

  return (
    <section
      aria-labelledby={`attendance-${classId}-heading`}
      className={cn("flex flex-col gap-3", className)}
      data-testid="attendance-report"
    >
      <h2 id={`attendance-${classId}-heading`} className="text-lg font-semibold text-ink">
        Attendance
      </h2>

      <AsyncSection
        state={state}
        loadingLabel="Loading the attendance roster"
        loadingLines={6}
        onRetry={() => void reload()}
        isEmpty={(page) => page.items.length === 0}
        emptyTitle="Nobody attended"
        emptyDescription="No student opened this class room. Attendance is written the first time each student joins."
      >
        {(page) => (
          <>
            <p className="text-sm text-ink-muted">
              {`${page.total} student${page.total === 1 ? "" : "s"} joined a ${page.classDurationMinutes}-minute class.`}
            </p>

            {/* The scroll container, not the page. */}
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">
                  {`Attendance for class ${classId}: student, time present, participation, and whether attendance is counted.`}
                </caption>
                <thead>
                  <tr className="bg-surface text-left">
                    <th scope="col" className="p-2 font-semibold text-ink">
                      Student
                    </th>
                    <th scope="col" className="p-2 font-semibold text-ink">
                      Present
                    </th>
                    <th scope="col" className="p-2 font-semibold text-ink">
                      Chat
                    </th>
                    <th scope="col" className="p-2 font-semibold text-ink">
                      Questions
                    </th>
                    <th scope="col" className="p-2 font-semibold text-ink">
                      Participation
                    </th>
                    <th scope="col" className="p-2 font-semibold text-ink">
                      Counted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((row) => (
                    <tr
                      key={row.studentId}
                      className="border-t border-line"
                      data-testid={`attendance-row-${row.studentId}`}
                    >
                      {/* scope="row" so each cell is announced with the student
                          it belongs to, which is the whole point of a table. */}
                      <th scope="row" className="p-2 text-left font-medium text-ink">
                        {row.studentName ?? `Student ${row.studentId}`}
                        {row.studentEmail && (
                          <span className="block text-xs font-normal text-ink-muted">
                            {row.studentEmail}
                          </span>
                        )}
                      </th>
                      <td className="p-2 text-ink-muted">
                        {`${row.timePresentMinutes} min (${presencePercent(row.timePresentMinutes, page.classDurationMinutes)}%)`}
                      </td>
                      <td className="p-2 text-ink-muted">{row.messagesSent}</td>
                      <td className="p-2 text-ink-muted">{row.questionsAsked}</td>
                      <td className="p-2 text-ink-muted">{`${row.participationScore} / 100`}</td>
                      <td className="p-2">
                        {editable ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={savingFor === row.studentId}
                            disabled={savingFor === row.studentId}
                            onClick={() => void togglePresent(row)}
                            aria-label={
                              row.markedPresent
                                ? `Stop counting ${row.studentName ?? "this student"} as present`
                                : `Count ${row.studentName ?? "this student"} as present`
                            }
                          >
                            {row.markedPresent ? "Counted" : "Not counted"}
                          </Button>
                        ) : (
                          <Badge tone={row.markedPresent ? "success" : "neutral"} size="sm">
                            {row.markedPresent ? "Counted" : "Not counted"}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AsyncSection>

      <LiveRegion message={message} testId="attendance-live-region" />
    </section>
  );
}
