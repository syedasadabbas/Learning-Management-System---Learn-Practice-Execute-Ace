// =============================================================================
// /reset-password?token=… — owned by the `account` stream.
// -----------------------------------------------------------------------------
// PUBLIC BY NECESSITY: the token IS the authorisation. That is why it is 256 bits
// of CSPRNG output, stored only as sha256, valid for 30 minutes, and redeemable
// once (see src/lib/account/tokens.ts and token-store.ts).
//
// THE TOKEN IS NOT VALIDATED ON GET, deliberately. The page shows the form for any
// syntactically plausible token and only finds out on submit. Two reasons:
//   * A "this link is valid" page is an oracle a scanner can run against guessed
//     tokens with no side effect; making the check happen only at redemption means
//     a probe either consumes the token or learns nothing.
//   * Mail clients and security scanners PREFETCH links. A GET that consumed or
//     validated the token would let a scanner burn a user's only link before they
//     clicked it. GET is therefore side-effect free.
//
// THE TOKEN IS CARRIED IN A HIDDEN FIELD, so the POST does not depend on the
// browser preserving the query string, and the failure redirect deliberately DROPS
// it: after a failed attempt the URL no longer contains a live token, so it cannot
// leak through a Referer header, a screenshot or a shared link. The cost is that a
// mistyped-confirmation retry needs the link from the mail again — accepted, and
// the message says to request a new one.
//
// No client JavaScript. See src/lib/account/messages.ts.
// =============================================================================

import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, Card } from "@/components/ui";
import { Field } from "@/components/account/Field";
import { FormNotice } from "@/components/account/FormNotice";
import { completePasswordReset } from "@/lib/account/reset";
import { looksLikeResetToken } from "@/lib/account/tokens";
import { resolveNotice, RESET_NOTICES } from "@/lib/account/messages";
import { PASSWORD_MIN_LENGTH, resetConfirmSchema } from "@/lib/account/validation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Choose a new password" };

async function resetPasswordAction(formData: FormData): Promise<void> {
  "use server";

  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!newPassword || !confirmPassword) {
    redirect(`/reset-password?status=missing&token=${encodeURIComponent(token)}`);
  }

  const parsed = resetConfirmSchema.safeParse({ token, newPassword, confirmPassword });
  if (!parsed.success) {
    // Validation failures keep the token so the user can fix a typo without
    // going back to the mail. Only a REDEMPTION failure drops it.
    const code = newPassword === confirmPassword ? "weak" : "mismatch";
    redirect(`/reset-password?status=${code}&token=${encodeURIComponent(token)}`);
  }

  // Structural check before spending ~100 ms of bcrypt on an obvious probe.
  if (!looksLikeResetToken(parsed.data.token)) {
    redirect("/reset-password?status=invalid_link");
  }

  let outcome: Awaited<ReturnType<typeof completePasswordReset>>;
  try {
    outcome = await completePasswordReset(parsed.data.token, parsed.data.newPassword);
  } catch (err) {
    console.error("[reset-password] completion failed", err);
    redirect("/reset-password?status=failed");
  }

  if (!outcome.ok) {
    // malformed / unknown / expired / used all collapse to one code. The reason
    // stays in the log; the page says the same thing either way.
    console.warn(`[reset-password] token refused: ${outcome.reason}`);
    redirect("/reset-password?status=invalid_link");
  }

  // Success does NOT sign the user in. Making them type the new password once on
  // the login form proves the reset actually took effect, and it means a reset
  // link is never, by itself, a session.
  redirect("/reset-password?status=done");
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token, status } = await searchParams;

  if (status === "done") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">Password updated</h1>
        </header>
        <Card>
          <p data-testid="reset-done" className="text-sm">
            Your password has been changed and the link has been used up. Sign in
            with the new password.
          </p>
        </Card>
        <Link href="/login" className="text-sm font-medium underline">
          Go to sign in
        </Link>
      </main>
    );
  }

  const notice = resolveNotice(RESET_NOTICES, status);
  // No token at all: nothing to submit. Show the message and point at the
  // request page rather than rendering a form that cannot succeed.
  const hasToken = looksLikeResetToken(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Choose a new password</h1>
        <p className="text-sm text-ink-muted">
          Reset links are valid for 30 minutes and can be used once.
        </p>
      </header>

      <Card>
        <div className="flex flex-col gap-4">
          <FormNotice
            notice={
              notice ??
              (hasToken
                ? null
                : {
                    tone: "error" as const,
                    message: RESET_NOTICES.invalid_link.message,
                  })
            }
            testId="reset-notice"
          />

          {hasToken ? (
            <form action={resetPasswordAction} className="flex flex-col gap-4" noValidate>
              <input type="hidden" name="token" value={token} />
              <Field
                id="newPassword"
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              />
              <Field
                id="confirmPassword"
                label="Repeat new password"
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
              <Button type="submit" data-testid="submit-reset" fullWidth>
                Set new password
              </Button>
            </form>
          ) : (
            <Link href="/forgot-password" className="text-sm font-medium underline">
              Request a new reset link
            </Link>
          )}
        </div>
      </Card>

      <p className="text-sm text-ink-muted">
        <Link href="/login" className="font-medium underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
