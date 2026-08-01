// =============================================================================
// Dashboard header: overall percentage, points, next deadline, next action.
// Owner: progress-tracking stream. Server component.
// -----------------------------------------------------------------------------
// `overallPercent` is already guarded in `score.ts` (returns 0 when the ceiling is
// 0), so this component can render it directly. That guard is deliberately NOT
// duplicated here — two places clamping the same number is how they drift.
// =============================================================================

import Link from "next/link";

import { Badge, Card, ProgressBar, buttonClasses } from "@/components/ui";
import type { DashboardModel } from "@/lib/progress/dashboard";

import { formatDate, isoAttribute, relativeDays } from "./format";

export interface ProgressSummaryProps {
  model: DashboardModel;
  studentName?: string;
}

export function ProgressSummary({ model, studentName }: ProgressSummaryProps) {
  const { nextAction, nextDeadline } = model;

  return (
    <Card
      data-testid="progress-summary"
      title={studentName ? `Welcome back, ${studentName}` : "Your progress"}
      subtitle={
        model.isNewStudent
          ? "Nothing recorded yet — Week 1 is open and waiting."
          : `${model.weeksCompleted} of ${model.weeks.length} weeks complete`
      }
    >
      <ProgressBar
        percent={model.overallPercent}
        label="Overall progress"
        tone={model.overallPercent >= 70 ? "success" : "brand"}
        size="lg"
      />

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-muted">Points</dt>
          <dd className="tabular-nums text-lg font-semibold" data-testid="total-score">
            {model.totalScore} / {model.maxScore}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Overall</dt>
          <dd className="tabular-nums text-lg font-semibold" data-testid="overall-percent">
            {model.overallPercent}%
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Weeks unlocked</dt>
          <dd className="tabular-nums text-lg font-semibold" data-testid="weeks-unlocked">
            {model.weeksUnlocked} / {model.weeks.length}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Current week</dt>
          <dd className="tabular-nums text-lg font-semibold" data-testid="current-week">
            {model.currentWeekNumber ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">Next up</p>
          <p className="font-medium" data-testid="next-action-label">
            {nextAction.label}
          </p>
        </div>

        {nextDeadline ? (
          <div className="min-w-0" data-testid="next-deadline">
            <p className="text-xs text-ink-muted">Next deadline</p>
            <p className="text-sm">
              <time dateTime={isoAttribute(nextDeadline.dueAt)}>
                {formatDate(nextDeadline.dueAt)}
              </time>{" "}
              <Badge tone={nextDeadline.overdue ? "danger" : "neutral"} size="sm">
                {relativeDays(nextDeadline.daysRemaining)}
              </Badge>
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted" data-testid="next-deadline">
            No deadlines scheduled yet
          </p>
        )}

        {/* A navigation target must be an <a>, not a <button> wrapping one —
            hence `buttonClasses` rather than <Button>. See Button.tsx. */}
        <Link
          href={nextAction.href}
          data-testid="next-action-link"
          className={buttonClasses("primary", "md", "sm:shrink-0")}
        >
          {nextAction.kind === "done" ? "View leaderboard" : "Go"}
        </Link>
      </div>
    </Card>
  );
}
