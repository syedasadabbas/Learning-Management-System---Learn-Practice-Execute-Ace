"use client";

// =============================================================================
// INSTRUCTOR CONTROLS — open, allocate, release, flag.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// THIS IS THE SURFACE THE GAMING DEFENCE LIVES ON, so it shows the two things an
// instructor needs to make a judgement and nothing else:
//   * the LENGTH of each review, because a 121-character review that passed the floor
//     is the shape a low-effort review takes, and length is the only automatic signal
//     that exists (src/lib/peer-review/config.ts is explicit that no automated check
//     catches fluent nonsense);
//   * the REVIEWER'S NAME, because accountability is the entire point of this view.
//     It is the ONLY projection in the stream that carries one
//     (src/lib/peer-review/reviews.ts#getRoundOverview), reachable only from a page
//     guarded by requireRole("instructor").
//
// THE BUTTONS ARE NOT THE AUTHORIZATION. Every one of them calls a server action
// whose first statement is `requireRole("instructor")`. Hiding a button is a
// courtesy; a student who calls the action directly is refused by the guard.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, Toast } from "@/components/ui";
import {
  allocatePeerReviewersAction,
  releasePeerReviewRoundAction,
  setPeerReviewFlagAction,
} from "@/lib/peer-review/actions";
import { MIN_REVIEW_CHARS } from "@/lib/peer-review/config";
import type { RoundOverview } from "@/lib/peer-review/reviews";
import type { RoundSummary } from "@/lib/peer-review/rounds";

/** Reviews at most this far above the floor are highlighted as worth reading first. */
const THIN_REVIEW_CHARS = MIN_REVIEW_CHARS + 40;

export interface RoundAdminPanelProps {
  round: RoundSummary;
  overview: RoundOverview;
}

export function RoundAdminPanel({ round, overview }: RoundAdminPanelProps) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<
    { tone: "success" | "error" | "warning"; message: string } | null
  >(null);

  async function onAllocate() {
    setPending("allocate");
    const result = await allocatePeerReviewersAction({ roundId: round.roundId });
    setPending(null);
    if (!result.ok) {
      setToast({ tone: "error", message: result.error });
      return;
    }
    const d = result.data;
    if (d.reason === "cohort_too_small" || d.reason === "no_submissions") {
      // Reported, not hidden. An instructor who presses Allocate and sees nothing
      // happen would otherwise assume the feature is broken.
      setToast({
        tone: "warning",
        message:
          d.reason === "no_submissions"
            ? "Nothing to allocate: no student has submitted this assignment yet."
            : "Nothing to allocate: only one submission exists, and its only possible reviewer is its author.",
      });
      return;
    }
    setToast({
      tone: d.degraded ? "warning" : "success",
      message:
        `${d.inserted} new allocation(s), ${d.removed} stale removed, ${d.notified} reviewer(s) emailed. ` +
        (d.degraded
          ? `Only ${d.reviewsPerSubmission} review(s) per submission are possible with ${d.reviewers} submissions.`
          : `${d.reviewers} reviewers, ${d.reviewsPerSubmission} review(s) each.`),
    });
  }

  async function onRelease() {
    setPending("release");
    const result = await releasePeerReviewRoundAction({ roundId: round.roundId });
    setPending(null);
    if (!result.ok) {
      setToast({ tone: "error", message: result.error });
      return;
    }
    setToast({
      tone: "success",
      message: result.data.alreadyReleased
        ? "This round was already released."
        : `Released. ${result.data.revealed} review(s) are now visible to the students they are about.`,
    });
  }

  async function onFlag(reviewId: number, flagged: boolean) {
    setPending(`flag-${reviewId}`);
    const result = await setPeerReviewFlagAction({ reviewId, flagged });
    setPending(null);
    setToast(
      result.ok
        ? {
            tone: "success",
            message: flagged
              ? "Withheld. The student it is about will not see this review."
              : "Restored. The student will see this review once the round is released.",
          }
        : { tone: "error", message: result.error },
    );
  }

  return (
    <Card
      title={round.assignmentTitle}
      subtitle={`Week ${round.weekNumber} — ${round.reviewsPerSubmission} review(s) per submission, reviews due ${round.reviewDueAt.toISOString().slice(0, 10)}`}
      action={
        round.releasedAt ? (
          <Badge tone="success">Released</Badge>
        ) : round.allocatedAt ? (
          <Badge tone="brand">Allocated, not released</Badge>
        ) : (
          <Badge tone="neutral">Not allocated</Badge>
        )
      }
      data-testid={`round-panel-${round.roundId}`}
    >
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Reviewers</dt>
          <dd className="text-lg font-semibold">{overview.reviewers}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Submitted</dt>
          <dd className="text-lg font-semibold" data-testid="overview-submitted">
            {overview.submitted}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Outstanding</dt>
          <dd className="text-lg font-semibold">{overview.outstanding}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Withheld</dt>
          <dd className="text-lg font-semibold">{overview.flagged}</dd>
        </div>
      </dl>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={onAllocate}
          disabled={pending !== null}
          data-testid={`allocate-${round.roundId}`}
        >
          {pending === "allocate" ? "Allocating…" : round.allocatedAt ? "Re-allocate" : "Allocate reviewers"}
        </Button>
        <Button
          variant="secondary"
          onClick={onRelease}
          disabled={pending !== null || round.releasedAt != null}
          data-testid={`release-${round.roundId}`}
        >
          {round.releasedAt ? "Already released" : "Release feedback to students"}
        </Button>
      </div>

      {!round.releasedAt && (
        <p className="mb-4 text-xs text-ink-muted">
          Students cannot see any review of their own work until you release this round. Read the
          short ones first — a review barely over the {MIN_REVIEW_CHARS}-character minimum is the
          shape a low-effort review takes.
        </p>
      )}

      {overview.allocations.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No reviewers allocated yet. Peer review needs at least two submissions.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="round-overview-table">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 pr-3">Reviewer</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Length</th>
                <th className="py-1 pr-3">Score</th>
                <th className="py-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.allocations.map((row) => (
                <tr key={row.allocationId} className="border-t border-line align-top">
                  <td className="py-2 pr-3">{row.reviewerName}</td>
                  <td className="py-2 pr-3">
                    {row.submittedAt == null ? (
                      <Badge tone="neutral" size="sm">
                        Not written
                      </Badge>
                    ) : row.flagged ? (
                      <Badge tone="warning" size="sm">
                        Withheld
                      </Badge>
                    ) : row.revealed ? (
                      <Badge tone="success" size="sm">
                        Visible to student
                      </Badge>
                    ) : (
                      <Badge tone="brand" size="sm">
                        Held
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.submittedAt == null ? (
                      "—"
                    ) : row.contentChars <= THIN_REVIEW_CHARS ? (
                      <span className="text-amber-700" data-testid={`thin-${row.allocationId}`}>
                        {row.contentChars}
                      </span>
                    ) : (
                      row.contentChars
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{row.totalScore ?? "—"}</td>
                  <td className="py-2">
                    {row.reviewId != null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending !== null}
                        onClick={() => onFlag(row.reviewId as number, !row.flagged)}
                        data-testid={`flag-${row.allocationId}`}
                      >
                        {row.flagged ? "Restore" : "Withhold"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <Toast tone={toast.tone} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </Card>
  );
}
