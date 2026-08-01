// =============================================================================
// FEEDBACK RECEIVED — what the cohort said about my work.
// Owner: the peer-review stream. Server component.
// -----------------------------------------------------------------------------
// THE ANONYMITY IS ALREADY DONE BY THE TIME THE DATA ARRIVES HERE. This component
// renders `RevealedReview`, a type with no field an identity could travel in
// (src/lib/peer-review/reviews.ts), so there is nothing for it to be careful about
// and no way for a future edit to this file to leak a reviewer. That is the point of
// enforcing anonymity in the read model rather than in the markup: markup is where
// a debugging `{JSON.stringify(row)}` gets left behind.
//
// THE THREE STATES ARE ALL RENDERED EXPLICITLY, because collapsing any two of them
// tells the student something untrue:
//   round exists, not released   -> "with an instructor" (NOT "nobody reviewed you")
//   round released, no reviews   -> "nobody submitted a review of this"
//   round released, reviews      -> the reviews
// =============================================================================

import { Badge, Card, EmptyState, StarRating } from "@/components/ui";
import type { ReceivedReviewsForAssignment } from "@/lib/peer-review/reviews";

export interface ReceivedReviewsProps {
  groups: readonly ReceivedReviewsForAssignment[];
}

export function ReceivedReviews({ groups }: ReceivedReviewsProps) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No peer feedback yet"
        description="Peer feedback appears here once an instructor opens a round on an assignment you submitted."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="received-reviews">
      {groups.map((group) => (
        <Card
          key={group.roundId}
          title={group.assignmentTitle}
          subtitle={`Week ${group.weekNumber}`}
          action={
            group.released ? (
              <Badge tone="success" data-testid={`round-released-${group.roundId}`}>
                Released
              </Badge>
            ) : (
              <Badge tone="neutral" data-testid={`round-withheld-${group.roundId}`}>
                With an instructor
              </Badge>
            )
          }
          data-testid={`received-round-${group.roundId}`}
        >
          {!group.released ? (
            <p className="text-sm text-ink-muted" data-testid="not-released-note">
              Your classmates&apos; feedback is written but not yet released. An instructor reads
              it before you do; you will see it here once they release the round.
            </p>
          ) : group.reviews.length === 0 ? (
            <p className="text-sm text-ink-muted">
              This round was released, but no usable review of your submission was recorded.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {group.reviews.map((review) => (
                <li
                  key={review.reviewNumber}
                  className="rounded border border-line p-3"
                  data-testid={`review-${group.roundId}-${review.reviewNumber}`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    {/*
                      "Review 1 of 2" — a POSITIONAL label. Never the database row id:
                      a real id is a global sequence, so two students comparing the ids
                      they received could narrow down who reviewed whom. Asserted in
                      src/lib/peer-review/reviews.anonymity.test.ts.
                    */}
                    <span className="text-sm font-semibold">
                      Anonymous review {review.reviewNumber} of {group.reviewsPerSubmission}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {review.totalScore ?? 0} / {review.maxTotal}
                    </span>
                  </div>

                  <dl className="mb-3 grid gap-2 text-sm sm:grid-cols-3">
                    {review.scoreLines.map((line) => (
                      <div key={line.key}>
                        <dt className="text-ink-muted">{line.name}</dt>
                        <dd>
                          <StarRating
                            value={line.score ?? 0}
                            max={line.maxPoints}
                            readOnly
                            size="sm"
                            showValue
                            label={line.name}
                            testId={`received-score-${group.roundId}-${review.reviewNumber}-${line.key}`}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <p className="whitespace-pre-wrap text-sm">{review.content}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            Peer feedback does not affect your marks. Your assignment score comes from your
            instructor&apos;s rating only.
          </p>
        </Card>
      ))}
    </div>
  );
}
