// =============================================================================
// Submission status chips. Owner: submissions stream.
// -----------------------------------------------------------------------------
// Server components (no "use client"): everything here is derived from props and
// renders once. Colours come from the ui-shell `Badge` tones, so no hex appears in
// this stream.
// =============================================================================

import { Badge } from "@/components/ui";
import type { SubmissionState } from "@/lib/submissions/history";

const STATUS_LABELS: Record<SubmissionState, string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  under_review: "Under review",
  graded: "Graded",
  returned: "Returned for changes",
};

const STATUS_TONES: Record<SubmissionState, "neutral" | "brand" | "success" | "warning"> = {
  not_submitted: "neutral",
  submitted: "brand",
  under_review: "brand",
  graded: "success",
  returned: "warning",
};

export function SubmissionStatusBadge({ status }: { status: SubmissionState }) {
  return (
    <Badge tone={STATUS_TONES[status]} data-testid="submission-status">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Lateness chip.
 *
 * Three distinct states, not two. "Inside the grace period" is called out
 * explicitly because it is the case a student is most likely to dispute: the
 * submission IS past the published deadline, and the reason no penalty applied is
 * the cohort's grace window. Saying so here means the answer is on the page rather
 * than in a support conversation.
 */
export function LatenessBadge({
  isLate,
  daysLate,
  withinGrace,
  gracePeriodDays,
}: {
  isLate: boolean;
  daysLate: number;
  withinGrace: boolean;
  gracePeriodDays: number;
}) {
  if (isLate) {
    return (
      <Badge tone="danger" data-testid="lateness-badge">
        {daysLate} day{daysLate === 1 ? "" : "s"} late
      </Badge>
    );
  }
  if (withinGrace) {
    return (
      <Badge tone="warning" data-testid="lateness-badge">
        Within {gracePeriodDays}-day grace period — not counted late
      </Badge>
    );
  }
  return (
    <Badge tone="success" data-testid="lateness-badge">
      On time
    </Badge>
  );
}
