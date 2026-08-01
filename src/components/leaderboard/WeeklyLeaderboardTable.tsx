// =============================================================================
// Per-week standings table. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// Weekly ranks are computed on read from `progress.overallScore` — the schema's
// `leaderboard` table has no per-week columns and is frozen. See the note at the
// top of src/lib/leaderboard/queries.ts.
//
// Unlike the overall board, this one lists the WHOLE cohort including students on
// zero, because a weekly board answers "who has done this week's work" and a
// student missing the week is exactly the interesting row.
// =============================================================================

import { Avatar, Badge, Card, EmptyState, ProgressBar, cn } from "@/components/ui";
import { POINTS } from "@/lib/contracts/scoring";
import type { WeeklyLeaderboardEntry } from "@/lib/leaderboard/types";
import { SortableHeader } from "./SortableHeader";
import type { LeaderboardLinkState } from "./query-link";

export interface WeeklyLeaderboardTableProps {
  entries: readonly WeeklyLeaderboardEntry[];
  state: LeaderboardLinkState;
  weekNumber: number | null;
  weekTitle: string | null;
}

export function WeeklyLeaderboardTable({
  entries,
  state,
  weekNumber,
  weekTitle,
}: WeeklyLeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <div data-testid="lb-empty">
        <EmptyState
          icon={<span className="text-3xl">▲</span>}
          title="Nobody enrolled yet"
          description="This cohort has no students, so there is no weekly ranking to show."
        />
      </div>
    );
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="overflow-x-auto">
        <table
          data-testid="leaderboard-week-table"
          className="w-full min-w-[32rem] border-collapse text-sm"
        >
          <caption className="sr-only">
            {weekNumber === null
              ? "Weekly standings"
              : `Week ${weekNumber} standings${weekTitle ? `: ${weekTitle}` : ""}`}
            {`, ${entries.length} ${entries.length === 1 ? "student" : "students"}.`}
          </caption>
          <thead className="border-b border-line bg-surface">
            <tr>
              <SortableHeader columnKey="rank" label="#" state={state} />
              <SortableHeader columnKey="name" label="Student" state={state} />
              <SortableHeader
                columnKey="total"
                label={`Week score / ${POINTS.WEEK_MAX}`}
                state={state}
                numeric
              />
              <SortableHeader columnKey="stars" label="Stars" state={state} numeric />
              <th
                scope="col"
                className="hidden px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase sm:table-cell"
              >
                Done
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.studentId}
                id={entry.isCurrentUser ? "me" : undefined}
                data-testid={entry.isCurrentUser ? "lb-row-me" : "lb-row"}
                data-student-id={entry.studentId}
                data-rank={entry.ranking}
                data-current-user={entry.isCurrentUser ? "true" : "false"}
                aria-current={entry.isCurrentUser ? "true" : undefined}
                className={cn(
                  "border-b border-line last:border-b-0",
                  entry.isCurrentUser
                    ? "bg-brand/10 font-semibold text-ink shadow-[inset_3px_0_0_0_var(--color-brand)]"
                    : "hover:bg-surface",
                )}
              >
                <td className="px-3 py-2 tabular-nums">{entry.ranking}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={entry.name} src={entry.avatarUrl} size="sm" />
                    <span className="truncate">{entry.name}</span>
                    {entry.isCurrentUser && (
                      <Badge tone="brand" size="sm">
                        You
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right" data-testid="lb-week-score">
                  <div className="flex items-center justify-end gap-2">
                    <span className="tabular-nums">{entry.weekScore}</span>
                    {/* `ariaLabel`, not `label`: a visible label would render
                        above the track and blow the row height out. Percent is
                        computed here because ProgressBar takes a percentage,
                        and clamping/NaN is handled inside it. */}
                    <ProgressBar
                      percent={(entry.weekScore / POINTS.WEEK_MAX) * 100}
                      size="sm"
                      className="w-16"
                      ariaLabel={`Week score for ${entry.name}: ${entry.weekScore} of ${POINTS.WEEK_MAX}`}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {entry.avgStars === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <>
                      <span aria-hidden="true">★ </span>
                      {entry.avgStars.toFixed(1)}
                    </>
                  )}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  <div className="flex gap-1">
                    <Badge tone={entry.quizCompleted ? "success" : "neutral"} size="sm">
                      Quiz
                    </Badge>
                    <Badge
                      tone={entry.assignmentCompleted ? "success" : "neutral"}
                      size="sm"
                    >
                      Assign.
                    </Badge>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.length === 1 && (
        <p
          data-testid="lb-single-student"
          className="border-t border-line bg-surface px-3 py-2 text-xs text-ink-muted"
        >
          This cohort has a single student, so the weekly ranking is a list of one.
        </p>
      )}
    </Card>
  );
}
