// =============================================================================
// The grid of week cards, plus the empty state when no weeks exist.
// Owner: progress-tracking stream. Server component.
// -----------------------------------------------------------------------------
// The lock reason is composed here rather than inside the card so that the
// threshold text is generated once, from the scoring contract, and every padlock
// tells the student the same thing.
// =============================================================================

import { EmptyState } from "@/components/ui";
import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";
import type { WeekProgressDetail } from "@/lib/progress/aggregate";

import { WeekProgressCard } from "./WeekProgressCard";

export interface WeekProgressListProps {
  weeks: readonly WeekProgressDetail[];
  /** Week to highlight as "current". */
  currentWeekNumber?: number | null;
}

/** "Score 70% or more on the Week 2 quiz to unlock this week." */
export function lockReasonFor(
  week: WeekProgressDetail,
  weeks: readonly WeekProgressDetail[],
): string | undefined {
  if (week.unlocked) return undefined;
  const previous = weeks.find((w) => w.weekNumber === week.weekNumber - 1);
  if (!previous) return "Locked";
  return `Score ${QUIZ_PASS_PERCENT}% or more on the Week ${previous.weekNumber} quiz to unlock this week.`;
}

export function WeekProgressList({ weeks, currentWeekNumber }: WeekProgressListProps) {
  if (weeks.length === 0) {
    // Not a failure — a cohort can be enrolled before the curriculum is loaded.
    // Rendering nothing at all would look like a broken page.
    return (
      <EmptyState
        title="No course content yet"
        description="Your weeks will appear here as soon as the curriculum is published."
      />
    );
  }

  return (
    <ul
      className="grid gap-4 sm:grid-cols-2"
      data-testid="week-progress-list"
      data-week-count={weeks.length}
    >
      {weeks.map((week) => (
        <li key={week.weekId}>
          <WeekProgressCard
            week={week}
            lockReason={lockReasonFor(week, weeks)}
            current={currentWeekNumber === week.weekNumber}
          />
        </li>
      ))}
    </ul>
  );
}
