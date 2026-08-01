// =============================================================================
// ACCOUNT UI STATUS CODES — owned by the `account` stream.
// -----------------------------------------------------------------------------
// WHY CODES IN A QUERY STRING RATHER THAN `useActionState`.
//
// Every account form is a plain server-rendered <form> posting to a server
// action, which then redirects back with `?status=<code>`. No client component,
// no hydration. Three reasons, in order of weight:
//
//   1. A PASSWORD RESET PAGE MUST WORK WITHOUT JAVASCRIPT. It is the page a
//      locked-out user reaches, often on a phone with a flaky connection. If the
//      client bundle fails, `useActionState` gives them a dead button; a plain
//      form still posts. The login page took the same decision for the same
//      reason — see the header of src/app/(auth)/login/page.tsx.
//   2. It matches the surrounding code, so there is one form idiom in the repo.
//   3. playwright.config.ts documents a real hazard in this environment where
//      client chunks can fail to load while pages still render. A no-JS flow is
//      not affected by it.
//
// THE MESSAGE TEXT NEVER TRAVELS IN THE URL — only a code from the closed sets
// below, resolved to text server-side. An arbitrary `?message=` parameter
// rendered back into the page is a text-injection surface (and, with a stray
// `dangerouslySetInnerHTML` anywhere downstream, worse). An unknown code falls
// back to a generic message rather than rendering the raw value.
//
// COST, stated plainly: a failed submission loses the typed values, because a
// redirect discards the POST body. For the profile form the server re-renders the
// stored values, so only the unsaved edit is lost; for password fields, which must
// never be echoed anyway, there is nothing to lose.
// =============================================================================

export type NoticeTone = "success" | "error";

export interface Notice {
  tone: NoticeTone;
  message: string;
}

/** Generic fallback for a code that is not in a map — e.g. a hand-edited URL. */
const GENERIC_ERROR: Notice = {
  tone: "error",
  message: "Something went wrong. Please try again.",
};

export const PROFILE_NOTICES: Record<string, Notice> = {
  saved: { tone: "success", message: "Profile updated." },
  invalid_name: {
    tone: "error",
    message: "Enter a name between 2 and 255 characters.",
  },
  invalid_url: {
    tone: "error",
    message:
      "Check the links: avatar, GitHub and LinkedIn must be full URLs starting with http:// or https://, or left empty.",
  },
  invalid_bio: { tone: "error", message: "Your bio must be 2000 characters or fewer." },
  no_such_user: {
    tone: "error",
    message: "Your account could not be found. Sign in again.",
  },
  failed: { tone: "error", message: "Could not save your profile. Please try again." },
};

export const PASSWORD_NOTICES: Record<string, Notice> = {
  changed: {
    tone: "success",
    message: "Password changed. Any outstanding reset links have been cancelled.",
  },
  wrong_current: { tone: "error", message: "That is not your current password." },
  mismatch: { tone: "error", message: "The new passwords do not match." },
  weak: { tone: "error", message: "Use a new password of at least 8 characters." },
  same: { tone: "error", message: "The new password must differ from the current one." },
  missing: { tone: "error", message: "Fill in all three password fields." },
  failed: { tone: "error", message: "Could not change your password. Please try again." },
};

export const FORGOT_NOTICES: Record<string, Notice> = {
  // Deliberately identical for "sent" and "no such account" — the caller cannot
  // produce two different codes here, because requestPasswordReset does not tell
  // it which happened. See src/lib/account/reset.ts.
  sent: {
    tone: "success",
    message:
      "If an account exists for that address, a reset link is on its way. The link is valid for 30 minutes.",
  },
  invalid_email: { tone: "error", message: "Enter a valid email address." },
  rate_limited: {
    tone: "error",
    message:
      "Too many reset requests for that address. Wait about 15 minutes and try again.",
  },
};

export const RESET_NOTICES: Record<string, Notice> = {
  // One message for malformed / unknown / expired / used. A link holder learns
  // nothing about which, and a probe learns nothing about which hashes exist.
  invalid_link: {
    tone: "error",
    message: "That reset link is no longer valid. Request a new one.",
  },
  mismatch: { tone: "error", message: "The passwords do not match." },
  weak: { tone: "error", message: "Use a password of at least 8 characters." },
  missing: { tone: "error", message: "Fill in both password fields." },
  failed: { tone: "error", message: "Could not reset your password. Please try again." },
};

/** Resolve a code against a map. Unknown codes never reach the page verbatim. */
export function resolveNotice(
  map: Record<string, Notice>,
  code: string | undefined,
): Notice | null {
  if (!code) return null;
  return map[code] ?? GENERIC_ERROR;
}
