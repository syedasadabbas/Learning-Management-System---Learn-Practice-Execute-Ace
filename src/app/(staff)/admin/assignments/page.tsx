// =============================================================================
// /admin/assignments — assignment briefs and Google Form / Sheet wiring.
// instructor-admin stream. ADMIN ONLY.
// -----------------------------------------------------------------------------
// CORRECTED 2026-07-31 (submissions stream, one-line comment fix): this used to
// say "no assignment has a `googleFormUrl` in seeded data". That is no longer
// true — scripts/seed.ts -> backfillAssignmentLinks fills BOTH URL columns on all
// four assignments. What it fills them with is this repository's own LOCAL
// STAND-IN, not a Google Form, because no Form can be created from here; see the
// header of src/lib/submissions/stand-in.ts. So the grading queue is no longer
// empty for want of an address, and the job of this page is now to REPLACE the
// stand-ins with real Google URLs. A blank Form URL is still handled and still
// stated on the page.
// =============================================================================

import Link from "next/link";

import { AssignmentForm } from "@/components/instructor";
import { Badge, buttonClasses, Card, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { listAssignments, listWeeks } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ assignmentId?: string }>;
}

export default async function AdminAssignmentsPage({ searchParams }: PageProps) {
  await requireRole("admin");
  const params = await searchParams;

  const raw = Number(params.assignmentId);
  const assignmentId = Number.isInteger(raw) && raw > 0 ? raw : null;

  const [weeks, assignments] = await Promise.all([listWeeks(), listAssignments()]);
  const selected = assignmentId
    ? assignments.find((a) => a.id === assignmentId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Assignments</h1>
        <p className="text-sm text-ink-muted">
          Assignments are delivered through a Google Form and ingested from the
          linked Sheet. Without both URLs there is nothing to submit and nothing to
          grade.
        </p>
      </header>

      {assignments.length === 0 ? (
        <EmptyState
          title="No assignments yet"
          description="Create the first assignment below."
        />
      ) : (
        <Card padded={false} title="Existing assignments">
          <ul className="divide-y divide-line text-sm">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="font-medium">
                    Week {a.weekNumber} — {a.title}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    due {new Date(a.dueAt).toISOString().slice(0, 16)}Z ·{" "}
                    {a.latePenaltyPercentPerDay}%/day late ·{" "}
                    {a.submissionCount} submission{a.submissionCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={a.googleFormUrl ? "success" : "warning"} size="sm">
                    {a.googleFormUrl ? "form set" : "no form"}
                  </Badge>
                  <Badge tone={a.googleSheetCsvUrl ? "success" : "warning"} size="sm">
                    {a.googleSheetCsvUrl ? "sheet set" : "no sheet"}
                  </Badge>
                  <Link
                    href={`/admin/assignments?assignmentId=${a.id}`}
                    className={buttonClasses("secondary", "sm")}
                    data-testid={`edit-assignment-${a.id}`}
                  >
                    Edit
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AssignmentForm weeks={weeks} assignment={selected ?? undefined} />
    </div>
  );
}
