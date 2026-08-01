// =============================================================================
// One assignment, with this student's submission state. Owner: submissions stream.
// -----------------------------------------------------------------------------
// Presentational and server-rendered. Every number shown comes from
// `AssignmentHistoryItem`, which is built from the frozen scoring contract — this
// file computes nothing, so a change to the late-penalty rule cannot be missed
// here.
// =============================================================================

import Link from "next/link";

import { Badge, Card, StarRating } from "@/components/ui";
import type { AssignmentHistoryItem } from "@/lib/submissions/history";

import { LatenessBadge, SubmissionStatusBadge } from "./SubmissionStatus";

/** UTC, explicit, and always the same string on server and client. */
function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function AssignmentCard({
  item,
  href,
  showRequirements = false,
}: {
  item: AssignmentHistoryItem;
  /** When set, the title links to the assignment's own page. */
  href?: string;
  showRequirements?: boolean;
}) {
  const submitted = item.submittedAt != null;

  return (
    <Card
      title={
        href ? (
          <Link href={href} className="hover:underline">
            Week {item.weekNumber}: {item.assignmentTitle}
          </Link>
        ) : (
          `Week ${item.weekNumber}: ${item.assignmentTitle}`
        )
      }
      subtitle={`Due ${formatUtc(item.dueAt)}`}
      action={<SubmissionStatusBadge status={item.status} />}
      data-testid={`assignment-card-${item.assignmentId}`}
    >
      <div className="flex flex-col gap-3">
        {showRequirements && item.requirements.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold">Requirements</h4>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
              {item.requirements.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {item.gracePeriodDays > 0 && (
          <p className="text-xs text-ink-muted">
            Counts as late after {formatUtc(item.effectiveDueAt)} ({item.gracePeriodDays}-day grace
            period). After that, {item.latePenaltyPercentPerDay}% per day, capped at 20%.
          </p>
        )}

        {!submitted ? (
          <p className="text-sm text-ink-muted" data-testid="no-submission">
            No submission recorded yet. Responses are pulled from the response sheet once an hour,
            so a form you have just filled in can take up to 60 minutes to appear here.
          </p>
        ) : (
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <dt className="font-medium">Submitted</dt>
              <dd>{formatUtc(item.submittedAt!)}</dd>
              <LatenessBadge
                isLate={item.isLate}
                daysLate={item.daysLate}
                withinGrace={item.withinGrace}
                gracePeriodDays={item.gracePeriodDays}
              />
            </div>

            {item.githubUrl && (
              <div className="flex gap-2">
                <dt className="font-medium">Repository</dt>
                <dd className="truncate">
                  <a
                    className="text-brand hover:underline"
                    href={item.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.githubUrl}
                  </a>
                </dd>
              </div>
            )}
            {item.liveUrl && (
              <div className="flex gap-2">
                <dt className="font-medium">Live site</dt>
                <dd className="truncate">
                  <a
                    className="text-brand hover:underline"
                    href={item.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.liveUrl}
                  </a>
                </dd>
              </div>
            )}

            {item.status === "graded" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="font-medium">Score</dt>
                  <dd data-testid="submission-score">
                    {item.score ?? 0} / {item.maxScore}
                  </dd>
                  {item.stars != null && (
                    <dd>
                      <StarRating value={item.stars} readOnly showValue size="sm" label="Rating" />
                    </dd>
                  )}
                </div>
                {item.feedback && (
                  <div>
                    <dt className="font-medium">Instructor feedback</dt>
                    <dd
                      className="mt-1 whitespace-pre-wrap rounded-md bg-surface p-3 text-ink-muted"
                      data-testid="submission-feedback"
                    >
                      {item.feedback}
                    </dd>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <dt className="font-medium">Not graded yet</dt>
                <dd>
                  <Badge tone="neutral">
                    Maximum still available: {item.provisionalMaxScore ?? item.maxScore} /{" "}
                    {item.maxScore}
                  </Badge>
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </Card>
  );
}
