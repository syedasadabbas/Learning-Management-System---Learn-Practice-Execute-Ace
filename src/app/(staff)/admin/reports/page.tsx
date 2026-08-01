// =============================================================================
// /admin/reports — CSV export. instructor-admin stream. ADMIN ONLY.
// -----------------------------------------------------------------------------
// The export is produced by an admin-guarded server action, not by a download
// route: this stream owns no export path in the frozen ROUTES map, and adding one
// would create an endpoint with no ROUTE_AUTH entry.
//
// `buildCsv` re-checks every header against a credential deny-list, so an export
// cannot carry a password hash even if the underlying projection changes.
// =============================================================================

import { ExportButton } from "@/components/instructor";
import { Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { GRADE_EXPORT_COLUMNS } from "@/lib/instructor/csv";
import { listCohorts } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  await requireRole("admin");
  const cohorts = await listCohorts();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-ink-muted">
          Grade exports as RFC 4180 CSV, UTF-8, CRLF line endings. Timestamps are
          ISO 8601 in UTC.
        </p>
      </header>

      <Card title="Grade export" subtitle="All cohorts" data-testid="export-all-card">
        <p className="mb-3 text-sm text-ink-muted">
          Columns: {GRADE_EXPORT_COLUMNS.map((c) => c.header).join(", ")}.
        </p>
        <ExportButton />
      </Card>

      {cohorts.map((c) => (
        <Card
          key={c.id}
          title={`Grade export — ${c.name}`}
          subtitle={`${c.studentCount} student(s)`}
          data-testid={`export-cohort-${c.id}`}
        >
          <ExportButton cohortId={c.id} label={`Export ${c.name} (CSV)`} />
        </Card>
      ))}
    </div>
  );
}
