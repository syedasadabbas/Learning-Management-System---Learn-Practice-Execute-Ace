// =============================================================================
// WEEK CARD — one week in the week list.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// A LOCKED CARD IS NOT A LINK. This is the whole point of the component: the
// unlocked variant renders <Link>, the locked variant renders a plain <div> with
// no href anywhere inside it. A disabled-looking anchor that still navigates is
// the classic version of this bug, and it is invisible in a screenshot review.
//
// Server-side gating in components/course/data.ts is what actually enforces
// access; this only removes the affordance and, critically, explains WHY.
// =============================================================================

import * as React from "react";
import Link from "next/link";

import { Badge, Card, LockBadge, ProgressBar } from "@/components/ui";

import type { WeekLockState } from "./lock-state";

export interface WeekCardProps {
  weekId: number;
  weekNumber: number;
  title: string;
  description: string | null;
  lectureTotal: number;
  /** ISO 8601 UTC deadline, or null when none is configured. */
  dueAt: string | null;
  lock: WeekLockState;
}

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Fixed locale + UTC so the server-rendered string matches the client and does
  // not trigger a hydration mismatch on a student in another timezone.
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function WeekBody({
  description,
  lectureTotal,
  dueAt,
  lock,
}: Pick<WeekCardProps, "description" | "lectureTotal" | "dueAt" | "lock">) {
  const due = formatDue(dueAt);

  return (
    <div className="space-y-3">
      {description && <p className="text-sm text-ink-muted">{description}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge tone="neutral" size="sm">
          {lectureTotal} lecture{lectureTotal === 1 ? "" : "s"}
        </Badge>
        {due && <span>Due {due}</span>}
        {lock.quizBestPercent != null && (
          <Badge tone={lock.quizBestPercent >= 70 ? "success" : "warning"} size="sm">
            Quiz best {lock.quizBestPercent}%
          </Badge>
        )}
      </div>

      {lock.locked ? (
        <p data-testid="week-lock-reason" className="text-sm text-ink-muted">
          {lock.reason}
        </p>
      ) : (
        <ProgressBar
          percent={lock.completionPercent}
          label={`${lock.lecturesCompleted} of ${lock.lectureTotal} lectures`}
          size="sm"
        />
      )}
    </div>
  );
}

export function WeekCard(props: WeekCardProps) {
  const { weekId, weekNumber, title, lock } = props;

  const header = {
    title: `Week ${weekNumber}: ${title}`,
    action: <LockBadge locked={lock.locked} reason={lock.reason ?? undefined} size="sm" />,
  };

  if (lock.locked) {
    return (
      <Card
        {...header}
        data-testid="week-card"
        data-week-number={weekNumber}
        data-locked="true"
        // aria-disabled on the container, and no interactive descendant at all,
        // so keyboard users cannot tab into a dead end either.
        aria-disabled="true"
        className="opacity-70"
      >
        <WeekBody {...props} />
      </Card>
    );
  }

  return (
    <Link
      href={`/weeks/${weekId}`}
      className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Card
        {...header}
        interactive
        data-testid="week-card"
        data-week-number={weekNumber}
        data-locked="false"
      >
        <WeekBody {...props} />
      </Card>
    </Link>
  );
}
