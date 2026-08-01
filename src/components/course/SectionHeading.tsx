// =============================================================================
// SECTION HEADING — the banner above one subject's weeks on /weeks.
// -----------------------------------------------------------------------------
// Owner: course-content stream. Presentational only; it enforces nothing. The
// enforcement lives in `deriveWeekLockStates` (rule 0) and `gateWeek`, which
// refuse a closed subject's content whether or not this banner is rendered.
//
// WHY A CLOSED SUBJECT IS SHOWN AT ALL RATHER THAN HIDDEN
// Hiding it would leave a student unable to see what the course contains or that
// more is coming — and the week numbers would jump from 1 to nothing with no
// explanation. Showing the subject, greyed, with a plain statement of when it
// opens, is honest about the shape of the course. The weeks under it are still
// rendered as locked cards, which are not links (see WeekCard).
// =============================================================================

import * as React from "react";

import { Badge } from "@/components/ui";

export interface SectionHeadingProps {
  /** Stable slug, used for the anchor id so the nav can deep-link a subject. */
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  /** Whether the cohort has been given this subject. */
  enabled: boolean;
  /** How many weeks sit under this heading, for the count chip. */
  weekCount: number;
}

export function SectionHeading({
  slug,
  title,
  subtitle,
  description,
  enabled,
  weekCount,
}: SectionHeadingProps) {
  return (
    <div
      data-testid="section-heading"
      data-section-slug={slug}
      data-section-enabled={enabled ? "true" : "false"}
      className={
        "border-b border-black/10 pb-3" + (enabled ? "" : " opacity-70")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`section-${slug}`} className="text-lg font-semibold text-ink">
          {title}
        </h2>

        {enabled ? (
          <Badge tone="success" size="sm">
            Open
          </Badge>
        ) : (
          // "Coming soon" rather than "Locked": a padlock here would read as
          // something the student can earn, and no quiz result opens a subject.
          <Badge tone="neutral" size="sm">
            Coming soon
          </Badge>
        )}

        <Badge tone="neutral" size="sm">
          {weekCount} week{weekCount === 1 ? "" : "s"}
        </Badge>
      </div>

      <p className="mt-1 text-sm font-medium text-ink-muted">{subtitle}</p>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>

      {!enabled && (
        <p className="mt-2 text-sm text-ink-muted">
          Your instructor will open this subject. It is not unlocked by quiz
          scores, so there is nothing to retake in the meantime.
        </p>
      )}
    </div>
  );
}
