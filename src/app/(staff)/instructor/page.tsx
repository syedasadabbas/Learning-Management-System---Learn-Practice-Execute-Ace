// =============================================================================
// /instructor — cohort overview. instructor-admin stream.
// -----------------------------------------------------------------------------
// Landing page for staff: what needs grading, how the cohort is doing, who is at
// risk. Every figure is aggregated in SQL and every rate handles a zero
// denominator by rendering "no data".
// =============================================================================

import Link from "next/link";

import {
  AnalyticsSummary,
  AtRiskList,
  StatTile,
} from "@/components/instructor";
import { buttonClasses, Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { getCohortAnalytics } from "@/lib/instructor/analytics";
import { getQueueCounts } from "@/lib/instructor/queue";

export const dynamic = "force-dynamic";

export default async function InstructorOverviewPage() {
  const user = await requireRole("instructor");

  const [analytics, counts] = await Promise.all([
    getCohortAnalytics(null),
    getQueueCounts(),
  ]);

  const needsReview = counts.submitted + counts.under_review;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cohort at a glance</h1>
          <p className="text-sm text-ink-muted">
            Signed in as {user.name} ({user.role}). Analytics computed in{" "}
            {analytics.computeMs} ms.
          </p>
        </div>
        <Link href="/instructor/grading" className={buttonClasses("primary", "md")}>
          Open grading queue
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Needs review"
          value={needsReview}
          hint={`${counts.submitted} submitted, ${counts.under_review} under review`}
          muted={needsReview === 0}
          testId="tile-needs-review"
        />
        <StatTile label="Graded" value={counts.graded} muted={counts.graded === 0} />
        <StatTile label="Returned" value={counts.returned} muted={counts.returned === 0} />
        <StatTile
          label="Weeks"
          value={analytics.weeks.length}
          hint="Course structure"
          muted={analytics.weeks.length === 0}
        />
      </div>

      <AnalyticsSummary analytics={analytics} />

      {needsReview === 0 && (
        <Card title="The queue is empty" data-testid="empty-queue-note">
          <p className="text-sm text-ink-muted">
            Nothing is waiting to be graded. On a new cohort this is expected:
            assignments are delivered through Google Forms and no form or sheet URL
            is configured yet, so no submissions have been ingested.{" "}
            {user.role === "admin" ? (
              <Link className="text-brand underline" href="/admin/assignments">
                Configure assignment URLs
              </Link>
            ) : (
              "An admin can configure those URLs from the admin console."
            )}
          </p>
        </Card>
      )}

      <AtRiskList students={analytics.atRisk} />
    </div>
  );
}
