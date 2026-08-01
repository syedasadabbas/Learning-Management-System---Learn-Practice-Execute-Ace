// =============================================================================
// /settings — owned by the `account` stream.
// -----------------------------------------------------------------------------
// ONE PAGE FOR ALL THREE ROLES. There is no student variant and no admin variant,
// because the editable surface is identical: name, avatar, bio, GitHub, LinkedIn.
// A role-specific settings page would be a second place where the "role is not
// self-editable" rule has to be remembered, and the second place is the one that
// gets it wrong. `requireUser()` — signed in, any role — is therefore exactly the
// right guard, rather than `requireRole("student")`.
//
// force-dynamic: the page reflects a row that the form on it just changed, and a
// cached render would show the previous values immediately after a save.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";

import { requireUser } from "@/lib/guard";
import { getAccountProfile } from "@/lib/account/profile";
import { ProfileForm } from "@/components/account/ProfileForm";
import { PasswordForm } from "@/components/account/PasswordForm";

import { changePasswordAction, updateProfileAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Account settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; password?: string }>;
}) {
  const user = await requireUser("/settings");
  const { profile: profileStatus, password: passwordStatus } = await searchParams;

  const profile = await getAccountProfile(user.id);
  if (!profile) {
    // Session is valid but the row is gone (stateless JWT — see src/lib/auth.ts).
    // Sending them to sign in again is the only honest outcome.
    redirect("/login?error=forbidden");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Account settings</h1>
        <p className="text-sm text-ink-muted">
          Update how you appear to your cohort, or change your password.
        </p>
      </header>

      <ProfileForm
        profile={profile}
        action={updateProfileAction}
        statusCode={profileStatus}
      />

      <PasswordForm action={changePasswordAction} statusCode={passwordStatus} />

      <p className="text-sm text-ink-muted">
        Forgotten your password instead?{" "}
        <Link href="/forgot-password" className="font-medium underline">
          Request a reset link
        </Link>
        .
      </p>
    </main>
  );
}
