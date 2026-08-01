// =============================================================================
// LOCKED-WEEK REFUSAL PAGE BODY.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// Rendered when a student reaches a week or lecture URL they have not earned —
// by typing it, from a stale bookmark, or from a link that was valid before a
// quiz retake. It is a REFUSAL, not a redirect: silently bouncing to /weeks
// leaves the student wondering whether the link was broken, whereas this states
// the rule and gives them the one action that changes it.
//
// The content itself is never sent — data.ts refuses before the page renders, so
// there is nothing here to leak beyond the week number and title the student can
// already see in the week list.
// =============================================================================

import * as React from "react";
import Link from "next/link";

import { EmptyState } from "@/components/ui";

// Styled as a link, not wrapped around a <Button>: <a><button> is invalid HTML
// (interactive content inside an anchor) and browsers disagree about which one
// receives the click.
const ACTION_LINK_CLASSES =
  "inline-flex h-8 items-center rounded-md border border-line bg-panel px-3 text-sm font-medium text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export interface LockedNoticeProps {
  weekNumber: number;
  title: string;
  reason: string;
  /** Week the student must pass a quiz on; links straight to it when known. */
  previousWeekId?: number;
}

export function LockedNotice({
  weekNumber,
  title,
  reason,
  previousWeekId,
}: LockedNoticeProps) {
  return (
    <div data-testid="locked-notice" data-week-number={weekNumber}>
      <EmptyState
        icon={<span className="text-2xl">🔒</span>}
        title={`Week ${weekNumber}: ${title} is locked`}
        description={reason}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/weeks"
              className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Back to all weeks
            </Link>
            {previousWeekId != null && (
              <Link href={`/weeks/${previousWeekId}`} className={ACTION_LINK_CLASSES}>
                Go to the previous week
              </Link>
            )}
          </div>
        }
      />
    </div>
  );
}
