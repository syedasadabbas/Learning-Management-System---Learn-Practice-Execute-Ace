// =============================================================================
// /admin/students — account management. instructor-admin stream. ADMIN ONLY.
// -----------------------------------------------------------------------------
// Roles and cohort enrolment only. Passwords are not manageable here: the auth
// stream owns hashing, and email is not editable because rewriting it silently
// reassigns someone's login identity.
//
// The account list uses the explicit `STUDENT_COLUMNS` projection, so no bcrypt
// hash is fetched, let alone rendered.
// =============================================================================

import { AccountRowForm } from "@/components/instructor";
import { Badge, Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { listAccounts, listCohorts } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  await requireRole("admin");

  const [accounts, cohorts] = await Promise.all([listAccounts(), listCohorts()]);
  const byRole = {
    admin: accounts.filter((a) => a.role === "admin").length,
    instructor: accounts.filter((a) => a.role === "instructor").length,
    student: accounts.filter((a) => a.role === "student").length,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-ink-muted">
          {byRole.student} students · {byRole.instructor} instructors ·{" "}
          {byRole.admin} admins. Passwords and email addresses are managed by the
          account owner, not from here.
        </p>
      </header>

      <Card padded title="Roles and enrolment" data-testid="accounts-card">
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted">No accounts exist yet.</p>
        ) : (
          <div>
            {accounts.map((a) => (
              <div key={a.id}>
                <div className="flex items-center gap-2 pt-2 text-xs text-ink-muted">
                  <Badge
                    tone={
                      a.role === "admin"
                        ? "brand"
                        : a.role === "instructor"
                          ? "accent"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {a.role}
                  </Badge>
                  <span>joined {new Date(a.createdAt).toISOString().slice(0, 10)}</span>
                </div>
                <AccountRowForm
                  account={{
                    id: a.id,
                    name: a.name,
                    email: a.email,
                    role: a.role,
                    cohortId: a.cohortId,
                  }}
                  cohorts={cohorts.map((c) => ({ id: c.id, name: c.name }))}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
