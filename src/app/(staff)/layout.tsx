// =============================================================================
// STAFF ROUTE-GROUP LAYOUT — instructor-admin stream.
// -----------------------------------------------------------------------------
// Wraps every /instructor/* and /admin/* page. `(staff)` is a route group, so it
// contributes nothing to the URL: the hrefs stay exactly the ones ui-shell froze
// in @/components/nav/nav-links.ts.
//
// GUARDS AT TWO LEVELS, DELIBERATELY.
//   * Here: `requireRole("instructor")` — nobody without staff privileges renders
//     any page in this subtree, so a missing per-page guard cannot expose a whole
//     section. `ROLES_SATISFYING.instructor` is ["instructor","admin"], so admins
//     pass and students are redirected to /login?error=forbidden.
//   * Per admin page: `requireRole("admin")` again, because
//     `ROLES_SATISFYING.admin` is ["admin"] alone and an instructor must not
//     reach quiz CRUD, account management or exports. A layout cannot express
//     "instructor here, admin one level deeper", so the deeper requirement is
//     restated where it applies.
//
// The layout does not carry authorization for the ACTIONS those pages call —
// every server action re-guards itself. A hidden button is not access control.
// =============================================================================

import { SignOutButton } from "@/components/auth/SignOutButton";
import { AppShell } from "@/components/nav";
import type { Role } from "@/components/nav";
import { requireRole } from "@/lib/guard";
import { homeFor } from "@/lib/navigation/role-access";

export default async function StaffLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireRole("instructor");

  return (
    <AppShell
      role={user.role as Role}
      userName={user.name}
      // Was an inline ternary here. The role -> home mapping now has one owner,
      // derived from NAV_LINKS, so this cannot drift from the sidebar or from the
      // post-login redirect. See src/lib/navigation/role-access.ts.
      homeHref={homeFor(user.role)}
      // Without this, staff had NO sign-out control anywhere in /instructor/* or
      // /admin/*: the button was wired into the (app) layout only, so an
      // instructor had to navigate into the student area to end their session.
      actions={<SignOutButton />}
    >
      {children}
    </AppShell>
  );
}
