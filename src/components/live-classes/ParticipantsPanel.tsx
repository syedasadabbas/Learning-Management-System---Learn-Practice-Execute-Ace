"use client";

// =============================================================================
// <ParticipantsPanel /> — who is in the room.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHAT THIS PANEL CAN AND CANNOT KNOW, because the honest answer is narrower
// than the component name suggests and the gap must not be papered over.
//
// A STUDENT CANNOT SEE THE ROSTER. `GET /api/classes/:id/attendance` is
// `ROUTE_AUTH: "instructor"`, and the contract file says why in a comment on
// that line: "A student may see their OWN attendance (via join/leave), never
// the roster." That is a privacy decision — the roster names every classmate
// and their participation score — and this component does not try to work
// around it.
//
// The real-time service DOES broadcast presence (`presence:joined`,
// `presence:left`, and a `presence` snapshot inside `class:snapshot`), which is
// the intended source for a live participant list. But that service is
// unreachable in this deployment (see the header of
// src/lib/live-classes/use-realtime.ts), so `presence` arrives as `unknown` and
// is typed as such.
//
// SO THE PANEL RENDERS, IN ORDER OF WHAT IT ACTUALLY HAS:
//   - the Jitsi conference's own participant COUNT, when the embed reports one;
//   - the instructor's roster, when the caller is staff and it was fetched;
//   - otherwise an honest statement that the list is not available, rather than
//     an empty list, which reads as "nobody is here".
// The last case is the one that matters: an empty participants panel in a live
// class is actively misleading, and "I cannot show this" is information.
// =============================================================================

import * as React from "react";

import { AsyncSection } from "@/components/async/AsyncSection";
import { Avatar, Badge, Card, EmptyState, cn } from "@/components/ui";
import { apiPathWithQuery } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";

import type { AttendanceReportPayload } from "./types";

const ATTENDANCE_GET = "GET  /api/classes/:classId/attendance" as const;

/** Roster refresh while a class runs. Slower than chat; nobody joins every 10 s. */
export const ROSTER_POLL_MS = 30_000;

export interface ParticipantsPanelProps {
  classId: number;
  /**
   * Whether the caller may read the roster. Derived from the SESSION by the
   * page — never from a client value. The route enforces it independently and
   * additionally filters on class ownership, so a forged `true` yields a 404.
   */
  canSeeRoster?: boolean;
  /** Live count reported by the Jitsi embed, when it exposes one. */
  conferenceCount?: number | null;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function ParticipantsPanel({
  classId,
  canSeeRoster = false,
  conferenceCount = null,
  className,
  fetchImpl,
}: ParticipantsPanelProps) {
  const url = React.useMemo(
    () => apiPathWithQuery(ATTENDANCE_GET, { classId }, { limit: 100 }),
    [classId],
  );

  const { state, reload } = useApiResource<AttendanceReportPayload>(ATTENDANCE_GET, url, {
    // `enabled` rather than a conditional hook call: the roster request must not
    // be made at all by a student, because a 403 in the network tab reads as a
    // bug and the poll would repeat it every thirty seconds.
    enabled: canSeeRoster,
    refreshMs: ROSTER_POLL_MS,
    fetchImpl,
  });

  return (
    <section
      aria-labelledby={`participants-${classId}-heading`}
      className={cn("flex min-h-0 flex-col gap-2", className)}
      data-testid="participants-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`participants-${classId}-heading`} className="text-base font-semibold text-ink">
          Participants
        </h3>
        {conferenceCount !== null && (
          <Badge tone="brand" size="sm" data-testid="conference-count">
            {`${conferenceCount} in the video call`}
          </Badge>
        )}
      </div>

      {!canSeeRoster ? (
        <EmptyState
          title="The participant list is not shown to students"
          description="Who attended a class, and how much they took part, is only visible to the instructor. The video window shows who is currently on the call."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AsyncSection
            state={state}
            loadingLabel="Loading the participant list"
            loadingLines={4}
            onRetry={() => void reload()}
            isEmpty={(page) => page.items.length === 0}
            emptyTitle="Nobody has joined yet"
            emptyDescription="Attendance is recorded the first time each student opens the room."
          >
            {(page) => (
              <ul className="flex flex-col gap-1">
                {page.items.map((row) => (
                  <li key={row.id}>
                    <Card padded={false} className="flex items-center gap-2 p-2">
                      <Avatar name={row.studentName ?? "Unknown student"} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {row.studentName ?? `Student ${row.studentId}`}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {/* Present/left is stated in words. A grey dot would
                              be the only cue otherwise. */}
                          {row.leftAt === null
                            ? `In the room — ${row.timePresentMinutes} min so far`
                            : `Left after ${row.timePresentMinutes} min`}
                        </span>
                      </span>
                      <Badge tone={row.markedPresent ? "success" : "neutral"} size="sm">
                        {row.markedPresent ? "Present" : "Not counted"}
                      </Badge>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </AsyncSection>
        </div>
      )}
    </section>
  );
}
