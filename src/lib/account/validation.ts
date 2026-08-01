// =============================================================================
// ACCOUNT VALIDATION SCHEMAS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// Every account boundary (server action, route handler) parses with a schema from
// this file. A server action is a public POST target: whatever the form renders,
// the request body is attacker-chosen, so validation is not a UX nicety.
//
// THE SCHEMA IS ALSO THE AUTHORIZATION BOUNDARY FOR FIELD WRITES.
// `profileFormSchema` has no `email` and no `role` key, and the update statement
// in `profile.ts` sets named columns only. Both matter: a schema that stripped
// unknown keys but an update that spread the parsed object would still be safe,
// whereas a schema that passed unknown keys through to a spread would be a
// self-service role change — i.e. privilege escalation to admin from a form.
//
// Built on the FROZEN `profileUpdateSchema` in src/lib/contracts/validation.ts
// rather than re-declaring the field rules. `name` is added here because the
// frozen schema does not carry it and the contract file cannot be edited.
// =============================================================================

import { z } from "zod";

import { profileUpdateSchema } from "@/lib/contracts/validation";

/**
 * Minimum password length. Mirrors `registerSchema` in the frozen contracts —
 * a reset flow that accepted a weaker password than registration would be a way
 * to downgrade an account's password policy.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

/**
 * Empty optional text fields arrive from an HTML form as "", never as undefined.
 * Normalise to null so a cleared field actually clears the column instead of
 * storing an empty string that then renders as an empty link.
 */
export function blankToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The editable profile surface. Note what is absent: `email` (changing it would
 * need a verification round trip this stream does not own) and `role`.
 */
export const profileFormSchema = profileUpdateSchema.extend({
  name: z
    .string()
    .trim()
    .min(2, "Your name needs at least 2 characters.")
    .max(255, "Your name must be 255 characters or fewer."),
});

export type ProfileFormInput = z.infer<typeof profileFormSchema>;

/**
 * Password change for a signed-in user.
 *
 * `currentPassword` is `min(1)` and not the full password policy: it is verified
 * against bcrypt, not stored, and an account whose existing password predates the
 * current policy must still be changeable.
 */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Repeat the new password."),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The new passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "The new password must differ from the current one.",
    path: ["newPassword"],
  });

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

/** Reset request. Only an email; deliberately nothing else to correlate on. */
export const resetRequestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(255),
});

export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

/** Reset completion. The token is opaque here; `looksLikeResetToken` shapes it. */
export const resetConfirmSchema = z
  .object({
    token: z.string().min(1, "The reset link is incomplete."),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Repeat the new password."),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

/**
 * Flatten a Zod error into `{ field: message }`, first message per field wins.
 * The forms render one message under each input, so only the first is useful.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    out[key] ??= issue.message;
  }
  return out;
}
