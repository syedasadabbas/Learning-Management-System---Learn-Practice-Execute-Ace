// =============================================================================
// /admin — admin console home. instructor-admin stream.
// -----------------------------------------------------------------------------
// requireRole("admin"), NOT "instructor". `ROLES_SATISFYING.admin` is ["admin"]
// alone, so an instructor who navigates here is redirected to
// /login?error=forbidden even though the (staff) layout above admitted them.
// =============================================================================

import Link from "next/link";

import { StatTile } from "@/components/instructor";
import { buttonClasses, Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { listAccounts, listAssignments, listCohorts, listQuizzes } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/quizzes", label: "Quizzes", description: "Create and edit MCQ sets" },
  { href: "/admin/assignments", label: "Assignments", description: "Briefs, Google Form and Sheet URLs" },
  { href: "/admin/students", label: "Accounts", description: "Roles and cohort enrolment" },
  { href: "/admin/deadlines", label: "Deadlines", description: "Week due dates and grace window" },
  { href: "/admin/reports", label: "Reports", description: "CSV export of grades" },
  { href: "/admin/analytics", label: "Analytics", description: "Pass rates and averages" },
  // Course access requests. Placed in this list rather than in a console of its
  // own because the brief for that stream was to match the existing admin
  // surface, and this array IS how a section is discovered here.
  {
    href: "/admin/course-requests",
    label: "Access requests",
    description: "Approve or decline access to a course",
  },
];

export default async function AdminHomePage() {
  await requireRole("admin");

  const [quizzes, assignments, accounts, cohorts] = await Promise.all([
    listQuizzes(),
    listAssignments(),
    listAccounts(),
    listCohorts(),
  ]);

  const unconfigured = assignments.filter((a) => !a.googleFormUrl).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin console</h1>
        <p className="text-sm text-ink-muted">
          Course content, accounts, deadlines and reports.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Quizzes" value={quizzes.length} muted={quizzes.length === 0} />
        <StatTile
          label="Assignments"
          value={assignments.length}
          hint={
            unconfigured > 0
              ? `${unconfigured} without a Google Form URL`
              : "All have a submission form"
          }
          muted={assignments.length === 0}
        />
        <StatTile label="Accounts" value={accounts.length} />
        <StatTile label="Cohorts" value={cohorts.length} muted={cohorts.length === 0} />
      </div>

      {unconfigured > 0 && (
        <Card title="Assignments have no submission form" data-testid="unconfigured-warning">
          <p className="text-sm text-ink-muted">
            {unconfigured} assignment{unconfigured === 1 ? "" : "s"} still{" "}
            {unconfigured === 1 ? "has" : "have"} no Google Form URL, so students
            have nowhere to submit and the grading queue cannot fill.{" "}
            <Link className="text-brand underline" href="/admin/assignments">
              Set the URLs
            </Link>
            .
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Card key={s.href} title={s.label} subtitle={s.description} interactive>
            <Link href={s.href} className={buttonClasses("secondary", "sm")}>
              Open {s.label.toLowerCase()}
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
