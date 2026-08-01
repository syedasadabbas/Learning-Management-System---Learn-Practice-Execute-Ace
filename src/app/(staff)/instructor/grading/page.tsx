// =============================================================================
// /instructor/grading — the grading queue. instructor-admin stream.
// -----------------------------------------------------------------------------
// Guarded by the (staff) layout's requireRole("instructor"); repeated here
// because a page must not depend on a layout for its authorization (a future
// refactor that moves the file breaks the guard silently otherwise).
//
// Filters come from the query string, so a view is linkable. An empty queue is
// rendered by QueueTable as an explained EmptyState — with no Google Form URL
// configured, nothing has been ingested and empty is the correct first state.
// =============================================================================

import { GradeForm, QueueFilters, QueueTable } from "@/components/instructor";
import { requireRole } from "@/lib/guard";
import {
  getGradingQueue,
  getQueueCounts,
  getQueueRow,
  parseStatus,
  parseWeekNumber,
} from "@/lib/instructor/queue";
import { listWeeks } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ week?: string; status?: string; submission?: string }>;
}

export default async function GradingPage({ searchParams }: PageProps) {
  await requireRole("instructor");
  const params = await searchParams;

  const status = parseStatus(params.status);
  const weekNumber = parseWeekNumber(params.week);
  const allStatuses = params.status === "all";
  const selectedId = Number(params.submission);
  const hasSelection = Number.isInteger(selectedId) && selectedId > 0;

  const [rows, counts, weeks] = await Promise.all([
    getGradingQueue({ status, weekNumber, allStatuses }),
    getQueueCounts(),
    listWeeks(),
  ]);

  // Fetched unfiltered on purpose: the selected submission may be outside the
  // current filter (it was just graded while the filter shows "needs review"),
  // and searching `rows` would silently render nothing.
  const selected = hasSelection ? await getQueueRow(selectedId) : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Grading queue</h1>
        <p className="text-sm text-ink-muted">
          {rows.length} submission{rows.length === 1 ? "" : "s"} in this view.
          Ratings below 3 stars reduce the assignment score by 10 points per star.
        </p>
      </header>

      <QueueFilters
        weekNumbers={weeks.map((w) => w.weekNumber)}
        counts={counts}
        activeWeek={weekNumber ?? null}
        activeStatus={allStatuses ? "all" : (status ?? null)}
      />

      {selected && <GradeForm row={selected} />}

      {hasSelection && !selected && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Submission {selectedId} no longer exists.
        </p>
      )}

      <QueueTable
        rows={rows}
        selectedId={hasSelection ? selectedId : null}
        filtered={status !== undefined || weekNumber !== undefined || allStatuses}
      />
    </div>
  );
}
