// =============================================================================
// SETTINGS SERVER ACTIONS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// A SERVER ACTION IS A PUBLIC POST TARGET. Next.js exposes it at a generated
// endpoint that anyone can call with a hand-built body; being reachable only from
// a page that called requireUser() proves nothing about the caller. So each action
// re-guards itself with `requireUser()` and takes the user id FROM THE SESSION.
// Neither action accepts a user id, which is the reason neither can be pointed at
// somebody else's account.
//
// The layout guard, the middleware prefix table and these calls are three
// independent layers, and all three are now in place: `{ prefix: "/settings",
// required: "student" }` was added to PROTECTED in src/middleware.ts after this
// stream reported the gap. (Corrected by qa-hardening — this comment previously
// claimed /settings was still absent from that table, which was no longer true.)
//
// Both actions end in `redirect()`, which signals by THROWING. Nothing here may
// wrap a redirect in a try/catch — see the comment in the login page's action.
// =============================================================================

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/guard";
import { changePassword } from "@/lib/account/password";
import { updateAccountProfile } from "@/lib/account/profile";
import {
  fieldErrors,
  passwordChangeSchema,
  profileFormSchema,
} from "@/lib/account/validation";

const SETTINGS_PATH = "/settings";

/** Redirect back to /settings with one status code. Never carries free text. */
function back(scope: "profile" | "password", code: string): never {
  redirect(`${SETTINGS_PATH}?${scope}=${encodeURIComponent(code)}`);
}

/**
 * Map the first Zod failure onto one of the closed status codes in messages.ts.
 * Zod's own message text is not forwarded: only codes travel in the URL.
 */
function profileCodeFor(errors: Record<string, string>): string {
  if (errors.name) return "invalid_name";
  if (errors.bio) return "invalid_bio";
  if (errors.avatarUrl || errors.githubProfile || errors.linkedinProfile) {
    return "invalid_url";
  }
  return "invalid_url";
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser(SETTINGS_PATH);

  const parsed = profileFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    avatarUrl: String(formData.get("avatarUrl") ?? ""),
    bio: String(formData.get("bio") ?? ""),
    githubProfile: String(formData.get("githubProfile") ?? ""),
    linkedinProfile: String(formData.get("linkedinProfile") ?? ""),
  });

  if (!parsed.success) {
    back("profile", profileCodeFor(fieldErrors(parsed.error)));
  }

  let saved: unknown;
  try {
    saved = await updateAccountProfile(user.id, parsed.data);
  } catch (err) {
    // Driver errors can carry the connection host and the failing SQL; log them
    // and show the visitor a generic message.
    console.error("[settings] profile update failed", err);
    back("profile", "failed");
  }

  // A stateless JWT holds the display name minted at sign-in, so the shell's
  // greeting keeps the old name until the token refreshes. Revalidating the
  // segment at least makes the form itself show the saved values immediately.
  if (!saved) back("profile", "no_such_user");
  revalidatePath(SETTINGS_PATH);
  back("profile", "saved");
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser(SETTINGS_PATH);

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    back("password", "missing");
  }

  const parsed = passwordChangeSchema.safeParse({
    currentPassword,
    newPassword,
    confirmPassword,
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.confirmPassword) back("password", "mismatch");
    if (errors.newPassword) {
      back("password", newPassword === currentPassword ? "same" : "weak");
    }
    back("password", "missing");
  }

  let outcome: Awaited<ReturnType<typeof changePassword>>;
  try {
    outcome = await changePassword(
      user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
  } catch (err) {
    console.error("[settings] password change failed", err);
    back("password", "failed");
  }

  if (!outcome.ok) {
    // "no_such_user" is collapsed into the same message as a wrong password: the
    // session is valid, so the only way to see it is a deleted account, and a
    // distinct message would be a free oracle for a borrowed cookie.
    back("password", "wrong_current");
  }

  back("password", "changed");
}
