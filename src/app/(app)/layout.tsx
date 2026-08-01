// =============================================================================
// Authenticated route-group shell.
// -----------------------------------------------------------------------------
// Landed ahead of the feature streams so that eight streams could each add their
// own segment under (app)/ without colliding on this file. Wired up at
// integration: ui-shell built AppShell but this file was outside its allowlist,
// and the wiring needs the session, so it left a TODO and the exact call to make.
//
// SESSION IS READ VIA guard.ts, NOT auth() DIRECTLY.
// Auth.js fixes `User.id` as `string` in its own interface and TypeScript
// interface merging cannot narrow it, so `session.user.id` is a string while the
// database key is an integer. guard.ts does that conversion once and returns an
// AuthUser with `id: number`. Calling auth() here would reintroduce the string
// and every downstream query would compare a string to an integer column.
//
// requireUser() also makes this a real second line of defence. src/middleware.ts
// rejects at the edge by path prefix, but a page added under a prefix that is not
// in its table would slip through — see the PROTECTED list there.
// =============================================================================

import { requireUser } from "@/lib/guard";
import { AppShell } from "@/components/nav";
import { SignOutButton } from "@/components/auth/SignOutButton";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <AppShell
      role={user.role}
      userName={user.name}
      homeHref="/dashboard"
      actions={<SignOutButton />}
    >
      {children}
    </AppShell>
  );
}
