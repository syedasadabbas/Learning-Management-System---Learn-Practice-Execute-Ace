// =============================================================================
// Overall cohort standings table. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// Presentational only: no scoring maths, no fetching. `letterGrade` arrives
// already computed from src/lib/contracts/scoring.ts (see queries.ts) — a
// component must never re-derive a grade, which is how a UI ends up disagreeing
// with the gradebook.
//
// EMPTY and SINGLE-ROW cases are handled explicitly, because both are real:
//   - a fresh cohort has no leaderboard rows at all until the first grading
//     event fires, and an empty <tbody> renders as a broken header-only table;
//   - a cohort of one is legitimate (first enrolment, or a pilot run), and it
//     renders as a normal table with a note rather than being special-cased into
//     something that looks like an error.
// =============================================================================

import { Avatar, Badge, Card, EmptyState, cn } from "@/components/ui";
import type { LeaderboardEntry } from "@/lib/leaderboard/types";
import { SortableHeader } from "./SortableHeader";
import type { LeaderboardLinkState } from "./query-link";

export interface LeaderboardTableProps {
  entries: readonly LeaderboardEntry[];
  state: LeaderboardLinkState;
  /** Course-wide maximum from scoring.ts. Shown as "184 / 310". */
  maxScore: number;
  cohortName: string | null;
}

export function LeaderboardTable({
  entries,
  state,
  maxScore,
  cohortName,
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <div data-testid="lb-empty">
        <EmptyState
          icon={<span className="text-3xl">▲</span>}
          title="No standings yet"
          description={
            cohortName
              ? `Nobody in ${cohortName} has been graded yet. Ranks appear as soon as the first quiz or assignment is marked.`
              : "Ranks appear as soon as the first quiz or assignment is marked."
          }
        />
      </div>
    );
  }

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Horizontal scroll on the wrapper, not the page: the score breakdown is
          seven columns wide and must not force the whole layout to scroll. */}
      <div className="overflow-x-auto">
        <table
          data-testid="leaderboard-table"
          className="w-full min-w-[36rem] border-collapse text-sm"
        >
          <caption className="sr-only">
            {cohortName
              ? `Overall standings for ${cohortName}`
              : "Overall cohort standings"}
            {`, ${entries.length} ${entries.length === 1 ? "student" : "students"}.`}
          </caption>
          <thead className="border-b border-line bg-surface">
            <tr>
              <SortableHeader columnKey="rank" label="#" state={state} />
              <SortableHeader columnKey="name" label="Student" state={state} />
              <SortableHeader columnKey="total" label="Total" state={state} numeric />
              <SortableHeader columnKey="quiz" label="Quiz" state={state} numeric compact />
              <SortableHeader
                columnKey="assignment"
                label="Assign."
                state={state}
                numeric
                compact
              />
              <SortableHeader
                columnKey="participation"
                label="Part."
                state={state}
                numeric
                compact
              />
              <SortableHeader
                columnKey="finalProject"
                label="Final"
                state={state}
                numeric
                compact
              />
              <SortableHeader columnKey="stars" label="Stars" state={state} numeric />
              <th
                scope="col"
                className="px-3 py-2 text-right text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Grade
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.studentId}
                // `id` is the scroll target for /leaderboard/me.
                id={entry.isCurrentUser ? "me" : undefined}
                data-testid={entry.isCurrentUser ? "lb-row-me" : "lb-row"}
                data-student-id={entry.studentId}
                data-rank={entry.ranking}
                data-current-user={entry.isCurrentUser ? "true" : "false"}
                // The highlight is a left border + tint + bold, not colour
                // alone: a 4.5:1 tint is not perceivable for every viewer, and
                // `aria-current` below carries it non-visually.
                aria-current={entry.isCurrentUser ? "true" : undefined}
                className={cn(
                  "border-b border-line last:border-b-0",
                  entry.isCurrentUser
                    ? "bg-brand/10 font-semibold text-ink shadow-[inset_3px_0_0_0_var(--color-brand)]"
                    : "hover:bg-surface",
                )}
              >
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  <RankCell rank={entry.ranking} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={entry.name} src={entry.avatarUrl} size="sm" />
                    <span className="truncate">{entry.name}</span>
                    {entry.isCurrentUser && (
                      <Badge tone="brand" size="sm" data-testid="lb-you-badge">
                        You
                      </Badge>
                    )}
                  </div>
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                  data-testid="lb-total"
                >
                  {entry.totalScore}
                  <span className="text-ink-muted"> / {maxScore}</span>
                </td>
                <ScoreCell value={entry.quizScore} />
                <ScoreCell value={entry.assignmentScore} />
                <ScoreCell value={entry.participationScore} />
                <ScoreCell value={entry.finalProjectScore} />
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {entry.avgStars === null ? (
                    <span className="text-ink-muted" title="No rated submissions yet">
                      —
                    </span>
                  ) : (
                    <>
                      <span aria-hidden="true">★ </span>
                      {entry.avgStars.toFixed(1)}
                      <span className="sr-only"> out of 5 stars average</span>
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Badge tone={gradeTone(entry.letterGrade)} size="sm">
                    {entry.letterGrade}
                  </Badge>
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
          Only one student has been graded in this cohort so far, so there is
          nobody to compare against yet.
        </p>
      )}
    </Card>
  );
}

function ScoreCell({ value }: { value: number }) {
  return (
    <td className="hidden px-3 py-2 text-right tabular-nums whitespace-nowrap sm:table-cell">
      {value}
    </td>
  );
}

/** Top three get a medal glyph; everyone else gets the plain ordinal. */
function RankCell({ rank }: { rank: number }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <span className="inline-flex items-center gap-1">
      {medal && <span aria-hidden="true">{medal}</span>}
      <span>{rank}</span>
    </span>
  );
}

function gradeTone(grade: LeaderboardEntry["letterGrade"]) {
  switch (grade) {
    case "A":
      return "success" as const;
    case "B":
      return "brand" as const;
    case "C":
      return "neutral" as const;
    case "D":
      return "warning" as const;
    default:
      return "danger" as const;
  }
}
