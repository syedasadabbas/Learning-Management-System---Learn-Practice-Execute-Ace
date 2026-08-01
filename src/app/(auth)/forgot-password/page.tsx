// =============================================================================
// /forgot-password — owned by the `account` stream.
// -----------------------------------------------------------------------------
// PUBLIC BY NECESSITY. A locked-out user has no session, so this page and its
// action must be reachable anonymously. It is not in middleware's PROTECTED
// prefix table and must not be added to it.
//
// THE PAGE RENDERS THE SAME THING FOR EVERY EMAIL. The action is handed one of
// two codes — `sent` or `rate_limited` — and `sent` is produced whether or not an
// account exists, because `requestPasswordReset` does not tell the caller which
// happened (see src/lib/account/reset.ts). The only way to render a difference
// would be to go and look, which nothing here does.
//
// The acknowledgement is shown INSTEAD OF the form, so a user does not sit there
// wondering whether to submit again, and the message states the 30-minute window.
//
// No client JavaScript, for the reason set out in src/lib/account/messages.ts:
// this is a page people reach when something is already going wrong.
// =============================================================================

import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { Button, Card } from "@/components/ui";
import { Field } from "@/components/account/Field";
import { FormNotice } from "@/components/account/FormNotice";
import { clientIp } from "@/lib/account/rate-limit";
import { requestPasswordReset } from "@/lib/account/reset";
import { resolveNotice, FORGOT_NOTICES } from "@/lib/account/messages";
import { resetRequestSchema } from "@/lib/account/validation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Forgot your password?" };

async function requestResetAction(formData: FormData): Promise<void> {
  "use server";

  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    // A malformed address is a client-side mistake, not a lookup, so answering
    // immediately reveals nothing: it is a property of the input, not of the
    // database. `[email protected]` and `not-an-email` get the same answer.
    redirect("/forgot-password?status=invalid_email");
  }

  // Per-IP limiting needs the peer address; see clientIp for why this header is
  // the supplement and the per-email rule is the primary control.
  const ip = clientIp(await headers());

  let outcome: Awaited<ReturnType<typeof requestPasswordReset>>;
  try {
    outcome = await requestPasswordReset(parsed.data.email, ip);
  } catch (err) {
    // requestPasswordReset already swallows its own failures; this is the last
    // line of defence, because a 500 here would be an enumeration oracle if it
    // ever depended on the address.
    console.error("[forgot-password] request failed", err);
    redirect("/forgot-password?status=sent");
  }

  redirect(
    outcome.status === "rate_limited"
      ? "/forgot-password?status=rate_limited"
      : "/forgot-password?status=sent",
  );
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const notice = resolveNotice(FORGOT_NOTICES, status);
  const acknowledged = status === "sent";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Forgot your password?</h1>
        <p className="text-sm text-ink-muted">
          Enter the email you registered with and we will send a reset link.
        </p>
      </header>

      <Card>
        <div className="flex flex-col gap-4">
          <FormNotice notice={notice} testId="forgot-notice" />

          {acknowledged ? (
            <p className="text-sm text-ink-muted">
              Check your inbox, including the spam folder. If nothing arrives, ask
              an administrator — the platform may not have mail configured yet.
            </p>
          ) : (
            <form action={requestResetAction} className="flex flex-col gap-4" noValidate>
              <Field
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                required
                maxLength={255}
              />
              <Button type="submit" data-testid="request-reset" fullWidth>
                Send reset link
              </Button>
            </form>
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
