// =============================================================================
// GRADING QUEUE TABLE + FILTERS — instructor-admin stream.
// -----------------------------------------------------------------------------
// Filters are LINKS, not client state: a week/status view is then bookmarkable
// and shareable ("look at week 3's ungraded work"), and the table stays a server
// component with no hydration cost.
//
// THE EMPTY QUEUE IS NOT AN ERROR. With no Google Form URL configured, nothing
// has been ingested, so an empty queue is the normal first state of a fresh
// install. It renders an EmptyState that says so, in the wording of the actual
// cause, rather than a spinner that never resolves or a red banner.
// =============================================================================

import Link from "next/link";

import { Badge, buttonClasses, Card, EmptyState, StarRating } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import type { QueueRow, SubmissionStatus } from "@/lib/instructor/queue";

const STATUS_TONE: Record<SubmissionStatus, BadgeTone> = {
  submitted: "brand",
  under_review: "warning",
  graded: "success",
  returned: "neutral",
};

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  graded: "Graded",
  returned: "Returned",
};

export interface QueueFiltersProps {
  weekNumbers: readonly number[];
  counts: Record<SubmissionStatus, number>;
  activeWeek: number | null;
  activeStatus: SubmissionStatus | "all" | null;
  basePath?: string;
}

function href(basePath: string, week: number | null, status: string | null): string {
  const params = new URLSearchParams();
  if (week !== null) params.set("week", String(week));
  if (status !== null) params.set("status", status);
  const q = params.toString();
  return q ? `${basePath}?${q}` : basePath;
}

export function QueueFilters({
  weekNumbers,
  counts,
  activeWeek,
  activeStatus,
  basePath = "/instructor/grading",
}: QueueFiltersProps) {
  const statuses: (SubmissionStatus | "all")[] = [
    "submitted",
    "under_review",
    "graded",
    "returned",
    "all",
  ];

  return (
    <div className="space-y-3" data-testid="queue-filters">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-muted uppercase">Status</span>
        <Link
          href={href(basePath, activeWeek, null)}
          data-testid="filter-status-needs-review"
          aria-current={activeStatus === null ? "page" : undefined}
          className={buttonClasses(activeStatus === null ? "primary" : "secondary", "sm")}
        >
          Needs review
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={href(basePath, activeWeek, s)}
            data-testid={`filter-status-${s}`}
            aria-current={activeStatus === s ? "page" : undefined}
            className={buttonClasses(activeStatus === s ? "primary" : "secondary", "sm")}
          >
            {s === "all" ? "All" : STATUS_LABEL[s]}
            {s !== "all" && (
              <span className="ml-1 tabular-nums opacity-70">{counts[s] ?? 0}</span>
            )}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-muted uppercase">Week</span>
        <Link
          href={href(basePath, null, activeStatus)}
          data-testid="filter-week-all"
          aria-current={activeWeek === null ? "page" : undefined}
          className={buttonClasses(activeWeek === null ? "primary" : "secondary", "sm")}
        >
          All weeks
        </Link>
        {weekNumbers.map((w) => (
          <Link
            key={w}
            href={href(basePath, w, activeStatus)}
            data-testid={`filter-week-${w}`}
            aria-current={activeWeek === w ? "page" : undefined}
            className={buttonClasses(activeWeek === w ? "primary" : "secondary", "sm")}
          >
            Week {w}
          </Link>
        ))}
      </div>
    </div>
  );
}

export interface QueueTableProps {
  rows: readonly QueueRow[];
  /** Submission currently open in the grade panel, highlighted in the list. */
  selectedId?: number | null;
  basePath?: string;
  /** True when a week/status filter is applied — changes the empty wording. */
  filtered?: boolean;
}

export function QueueTable({
  rows,
  selectedId = null,
  basePath = "/instructor/grading",
  filtered = false,
}: QueueTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        // EmptyState renders data-testid="empty-state" itself; specs assert on
        // that plus the copy, so no extra test hook is needed (or accepted — its
        // props are a closed set).
        title={filtered ? "Nothing matches this filter" : "Nothing to grade yet"}
        description={
          filtered ? (
            <>
              No submissions match the selected week and status. Clear the filters
              to see the whole queue.
            </>
          ) : (
            <>
              The queue is empty because no assignment submissions have been
              ingested yet. Assignments are delivered through Google Forms, and no
              form or sheet URL is configured — set those on{" "}
              <Link className="text-brand underline" href="/admin/assignments">
                Admin - Assignments
              </Link>{" "}
              and the queue fills as students submit. This is the expected state of
              a new cohort, not a fault.
            </>
          )
        }
        action={
          filtered ? (
            <Link href={basePath} className={buttonClasses("secondary", "sm")}>
              Clear filters
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card padded={false} data-testid="queue-table-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="queue-table">
          <caption className="sr-only">
            Submissions awaiting or holding a grade
          </caption>
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Student</th>
              <th scope="col" className="px-3 py-2">Week</th>
              <th scope="col" className="px-3 py-2">Assignment</th>
              <th scope="col" className="px-3 py-2">Submitted</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Rating</th>
              <th scope="col" className="px-3 py-2">Score</th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.submissionId}
                data-testid="queue-row"
                data-submission-id={row.submissionId}
                className={
                  row.submissionId === selectedId
                    ? "border-t border-line bg-brand/5"
                    : "border-t border-line"
                }
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{row.studentName}</span>
                  <span className="block text-xs text-ink-muted">
                    {row.studentEmail}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.weekNumber}</td>
                <td className="px-3 py-2">{row.assignmentTitle}</td>
                <td className="px-3 py-2">
                  <span className="tabular-nums">
                    {new Date(row.submittedAt).toISOString().slice(0, 10)}
                  </span>
                  {row.daysLate > 0 && (
                    <Badge tone="warning" size="sm" className="ml-2">
                      +{row.daysLate}d
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[row.status]} size="sm">
                    {STATUS_LABEL[row.status]}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {row.stars === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <StarRating value={row.stars} size="sm" testId="row-stars" />
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {row.score === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    `${row.score} / 40`
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`${basePath}?submission=${row.submissionId}`}
                    className={buttonClasses("secondary", "sm")}
                    data-testid="open-grade"
                  >
                    {row.status === "graded" ? "Re-grade" : "Grade"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
