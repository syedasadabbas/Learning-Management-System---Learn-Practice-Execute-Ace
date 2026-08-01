// =============================================================================
// PASSWORD CHANGE FORM — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The CURRENT password field is not optional and is not a formality: see the
// header of src/lib/account/password.ts for why a valid session is not sufficient
// authority to change a password.
//
// autoComplete values matter for correctness, not just convenience:
// "current-password" on the first field and "new-password" on the other two is
// what stops a password manager from filling all three with the existing password
// and what makes it offer to store the new one.
//
// No value is ever echoed back into a password input — not on error, not on
// success. A redirect-based flow (see messages.ts) makes that structural: there is
// no POST body left to echo.
// =============================================================================

import { Button, Card } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/account/validation";
import { resolveNotice, PASSWORD_NOTICES } from "@/lib/account/messages";

import { Field } from "./Field";
import { FormNotice } from "./FormNotice";

export function PasswordForm({
  action,
  statusCode,
}: {
  action: (formData: FormData) => Promise<void>;
  statusCode?: string;
}) {
  const notice = resolveNotice(PASSWORD_NOTICES, statusCode);

  return (
    <Card
      title="Password"
      subtitle="Changing your password cancels any outstanding reset links."
    >
      <form action={action} className="flex flex-col gap-4" noValidate>
        <FormNotice notice={notice} testId="password-notice" />

        <Field
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          hint="Required even while you are signed in — it stops a borrowed session from taking over the account."
        />

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

        <div>
          <Button type="submit" data-testid="change-password">
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
