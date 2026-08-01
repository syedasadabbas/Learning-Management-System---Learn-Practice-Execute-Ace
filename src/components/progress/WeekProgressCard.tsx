// =============================================================================
// One week card on the student dashboard. Server component (no interactivity).
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// Every value comes from the read model; nothing is computed here. A component
// that did its own arithmetic would be a second scoring implementation living in
// the view layer.
//
// A brand-new student hits this with zeroes and nulls everywhere: 0 lectures,
// `quizBestPercent: null`, no submission. Each label below has an explicit
// zero-state string, so the card is informative rather than blank or "NaN%".
// =============================================================================

import Link from "next/link";

import { Badge, Card, LockBadge, ProgressBar, cn } from "@/components/ui";
import type { WeekProgressDetail } from "@/lib/progress/aggregate";
import { assignmentHref, weekHref, WEEK_MAX_POINTS } from "@/lib/progress/dashboard";

import {
  formatDate,
  isoAttribute,
  lectureCountLabel,
  lecturePercent,
  quizPercentLabel,
} from "./format";

export interface WeekProgressCardProps {
  week: WeekProgressDetail;
  /** Reason shown on the padlock, e.g. "Pass the Week 1 quiz to unlock". */
  lockReason?: string;
  /** Highlights the week the student is currently working through. */
  current?: boolean;
}

/** Quiz status as a tone + label pair. Null best percent is "not attempted". */
function quizStatus(week: WeekProgressDetail): { tone: "success" | "warning" | "neutral" | "danger"; label: string } {
  if (week.quizCount === 0) return { tone: "neutral", label: "No quiz" };
  if (week.quizBestPercent == null) return { tone: "neutral", label: "Quiz not attempted" };
  if (week.quizCompleted && week.breakdown.quizPoints > 0) {
    return { tone: "success", label: `Quiz ${quizPercentLabel(week.quizBestPercent)}` };
  }
  return { tone: "danger", label: `Quiz ${quizPercentLabel(week.quizBestPercent)}` };
}

function assignmentStatus(week: WeekProgressDetail): {
  tone: "success" | "warning" | "neutral";
  label: string;
} {
  if (week.assignmentCount === 0) return { tone: "neutral", label: "No assignment" };
  if (week.gradedAssignmentCount >= week.assignmentCount) {
    return { tone: "success", label: "Assignment graded" };
  }
  if (week.assignmentCompleted) return { tone: "warning", label: "Assignment awaiting review" };
  return { tone: "neutral", label: "Assignment not submitted" };
}

export function WeekProgressCard({ week, lockReason, current = false }: WeekProgressCardProps) {
  const quiz = quizStatus(week);
  const assignment = assignmentStatus(week);
  const percent = lecturePercent(week.lecturesCompleted, week.lectureTotal);

  return (
    <Card
      id={`week-${week.weekNumber}`}
      data-testid="week-card"
      data-week-number={week.weekNumber}
      data-unlocked={week.unlocked}
      data-week-score={week.overallScore}
      className={cn(current && "ring-2 ring-brand/40")}
      title={`Week ${week.weekNumber}: ${week.title}`}
      subtitle={
        <span>
          Due{" "}
          <time dateTime={isoAttribute(week.dueAt)} data-testid="week-due-at">
            {formatDate(week.dueAt)}
          </time>
        </span>
      }
      action={
        <LockBadge
          locked={!week.unlocked}
          reason={week.unlocked ? undefined : lockReason}
          size="sm"
        />
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span data-testid="week-score">
            {week.overallScore} / {WEEK_MAX_POINTS} points
          </span>
          {week.unlocked ? (
            <Link
              href={week.assignmentCompleted ? weekHref(week.weekNumber) : assignmentHref(week.weekNumber)}
              className="font-medium text-brand underline-offset-2 hover:underline"
            >
              Open week {week.weekNumber}
            </Link>
          ) : (
            <span className="text-ink-muted">{lockReason ?? "Locked"}</span>
          )}
        </div>
      }
    >
      <ProgressBar
        percent={percent}
        label={lectureCountLabel(week.lecturesCompleted, week.lectureTotal)}
        tone={percent === 100 ? "success" : "brand"}
        size="sm"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={quiz.tone} size="sm" data-testid="week-quiz-status">
          {quiz.label}
        </Badge>
        <Badge tone={assignment.tone} size="sm" data-testid="week-assignment-status">
          {assignment.label}
        </Badge>
      </div>

      {/* Score breakdown, so the number in the footer is never unexplained. */}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink-muted">
        <div>
          <dt>Quiz</dt>
          <dd className="tabular-nums font-medium text-ink">{week.breakdown.quizPoints}</dd>
        </div>
        <div>
          <dt>Assignment</dt>
          <dd className="tabular-nums font-medium text-ink">{week.breakdown.assignmentPoints}</dd>
        </div>
        <div>
          <dt>Participation</dt>
          <dd className="tabular-nums font-medium text-ink">
            {week.breakdown.participationPoints}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
