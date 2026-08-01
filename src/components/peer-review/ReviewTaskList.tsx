// =============================================================================
// REVIEWER TASK LIST — "what do I have to review?"
// Owner: the peer-review stream. Server component: no state, no handlers.
// -----------------------------------------------------------------------------
// One row per allocation, outstanding first (the ordering is done in SQL by
// src/lib/peer-review/reviews.ts#getMyReviewTasks, not re-sorted here).
//
// NOTHING IN THIS COMPONENT NAMES ANOTHER STUDENT, and it cannot: `ReviewTask`
// carries no author field. See src/lib/peer-review/visibility.ts for the model and
// its honest limit — the GitHub URL on the linked page frequently identifies its
// owner, which is why the claim is single-blind-enforced rather than double-blind.
// =============================================================================

import Link from "next/link";

import { Badge, Card, EmptyState } from "@/components/ui";
import type { ReviewTask } from "@/lib/peer-review/reviews";

export interface ReviewTaskListProps {
  tasks: readonly ReviewTask[];
}

export function ReviewTaskList({ tasks }: ReviewTaskListProps) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No peer reviews assigned"
        // The three real reasons a student sees this, so it is not read as a fault.
        // "You did not submit" is the one that surprises people and it is stated
        // first — see the header of src/lib/peer-review/allocate.ts.
        description={
          <>
            Reviews are assigned once an instructor opens a peer-review round. You are only
            given work to review if you submitted the assignment yourself, and a cohort with
            fewer than two submissions cannot be paired at all.
          </>
        }
      />
    );
  }

  const outstanding = tasks.filter((t) => t.submittedAt == null).length;

  return (
    <div className="flex flex-col gap-4" data-testid="review-task-list">
      <Card title="Reviews assigned to you" data-testid="review-task-summary">
        <p className="text-sm text-ink-muted">
          {outstanding === 0
            ? `All ${tasks.length} of your reviews are submitted.`
            : `${outstanding} of ${tasks.length} still to write.`}
        </p>
      </Card>

      <ul className="flex flex-col gap-3">
        {tasks.map((task) => (
          <li key={task.allocationId}>
            <Card
              title={task.assignmentTitle}
              subtitle={`Week ${task.weekNumber} — due ${task.reviewDueAt.toISOString().slice(0, 10)}`}
              action={
                task.submittedAt ? (
                  task.flagged ? (
                    <Badge tone="warning">Withheld</Badge>
                  ) : (
                    <Badge tone="success">Submitted</Badge>
                  )
                ) : (
                  <Badge tone="brand">To write</Badge>
                )
              }
              data-testid={`review-task-${task.allocationId}`}
            >
              <Link
                className="text-sm text-brand underline"
                href={`/peer-review/${task.allocationId}`}
                data-testid={`review-task-link-${task.allocationId}`}
              >
                {task.submittedAt ? "Read what you wrote" : "Write this review"}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
