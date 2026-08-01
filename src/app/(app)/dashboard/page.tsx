// =============================================================================
// STUDENT DASHBOARD — /dashboard. Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// Server component. One database round trip (`getDashboard` -> one aggregated
// SQL statement); everything else is pure derivation in @/lib/progress.
//
// THE ZERO-ACTIVITY STUDENT IS THE PRIMARY CASE. A student who registered ten
// seconds ago has no progress rows, no attempts, no submissions and no
// attendance. That path must render:
//   - "0 / 280 points" and "0%", never "NaN%" and never a division by zero
//   - four week cards, with Week 1 unlocked and Weeks 2-4 padlocked with a reason
//   - a next action that points at Week 1
// It is exercised by tests/e2e/progress-tracking/dashboard.spec.ts and by the
// buildDashboard unit tests.
//
// Route protection: middleware.ts (auth stream) gates the (app) group;
// `requireRole("student")` here is the defence in depth that also gives us the
// session id. The id is never read from a query parameter — a student sees only
// their own progress.
// =============================================================================

import type { Metadata } from "next";

import { ProgressSummary, WeekProgressList } from "@/components/progress";
import { appConfig } from "@/lib/config/app.config";
import { requireRole } from "@/lib/guard";
import { getDashboard } from "@/lib/progress/dashboard";

export const metadata: Metadata = {
  title: `Dashboard — ${appConfig.branding.appName}`,
  description: "Your weekly progress, scores and what to do next.",
};

// Progress changes the instant a quiz is submitted or a sheet is ingested, so
// this page must never be statically cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const user = await requireRole("student", "/dashboard");
  const model = await getDashboard(user.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6" data-testid="dashboard">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-ink-muted">{appConfig.course.title}</p>
      </header>

      <ProgressSummary model={model} studentName={user.name || undefined} />

      <section aria-labelledby="weeks-heading" className="flex flex-col gap-3">
        <h2 id="weeks-heading" className="text-lg font-semibold">
          Your weeks
        </h2>
        <WeekProgressList weeks={model.weeks} currentWeekNumber={model.currentWeekNumber} />
      </section>
    </main>
  );
}
