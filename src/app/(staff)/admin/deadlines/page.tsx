// =============================================================================
// /admin/deadlines — week due dates and the cohort grace window.
// instructor-admin stream. ADMIN ONLY.
// -----------------------------------------------------------------------------
// `weeks.dueAt` is what the student dashboard displays; `assignments.dueAt` is
// what the late-penalty maths uses. Saving here moves both by default (see
// setWeekDeadline), because a dashboard date that disagrees with the penalty
// calculation is a support ticket waiting to happen.
// =============================================================================

import { CohortForm, DeadlineRowForm } from "@/components/instructor";
import { Card, EmptyState } from "@/components/ui";
import { appConfig } from "@/lib/config/app.config";
import { requireRole } from "@/lib/guard";
import { listCohorts, listWeeks } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

export default async function AdminDeadlinesPage() {
  await requireRole("admin");

  const [weeks, cohorts] = await Promise.all([listWeeks(), listCohorts()]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Deadlines</h1>
        <p className="text-sm text-ink-muted">
          Seed defaults come from app.config (week offsets{" "}
          {appConfig.schedule.weekDueOffsetsDays.join(", ")} days after cohort
          start). Changes made here override them in the database.
        </p>
      </header>

      <Card padded title="Week due dates" data-testid="deadlines-card">
        {weeks.length === 0 ? (
          <EmptyState
            title="No weeks configured"
            description="Create the course structure before setting deadlines."
          />
        ) : (
          <div>
            {weeks.map((w) => (
              <DeadlineRowForm key={w.id} week={w} />
            ))}
          </div>
        )}
      </Card>

      {cohorts.length === 0 ? (
        <EmptyState
          title="No cohorts"
          description="A cohort holds the start date and the grace window."
        />
      ) : (
        cohorts.map((c) => <CohortForm key={c.id} cohort={c} />)
      )}
    </div>
  );
}
