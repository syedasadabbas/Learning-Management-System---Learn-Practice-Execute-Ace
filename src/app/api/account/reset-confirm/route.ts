// =============================================================================
// POST /api/account/reset-confirm — owned by the `account` stream.
// -----------------------------------------------------------------------------
// PUBLIC: the token is the authorisation. Redeem it, set the new password.
//
// ONE ERROR FOR FOUR CAUSES. malformed / unknown / expired / used all return 400
// with `code: "invalid_link"`. Distinguishing them would tell a scanner which
// guessed token hashes exist in the table and would confirm, for a token found in
// a forwarded mail, whether it had already been spent. The specific reason is
// logged server-side, where it is useful and not reachable.
//
// Single use and the invalidation of the user's other outstanding links happen
// inside one transaction — see src/lib/account/token-store.ts.
//
// The response says nothing about WHOSE password was reset: no email, no user id.
// A token holder does not need it, and a token guesser must not receive it.
// =============================================================================

import { apiError, apiOk } from "@/lib/guard";
import { completePasswordReset, RESET_LINK_UNUSABLE_MESSAGE } from "@/lib/account/reset";
import { looksLikeResetToken } from "@/lib/account/tokens";
import { resetConfirmSchema } from "@/lib/account/validation";

// Intentionally anonymous — see the header.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = resetConfirmSchema.safeParse(body);
  if (!parsed.success) {
    // Describes the caller's own input (length, mismatch), not stored state.
    return apiError(
      422,
      parsed.error.issues[0]?.message ?? "Invalid request.",
      "invalid_fields",
    );
  }

  // Reject a structurally impossible token before spending bcrypt time on it.
  if (!looksLikeResetToken(parsed.data.token)) {
    return apiError(400, RESET_LINK_UNUSABLE_MESSAGE, "invalid_link");
  }

  try {
    const outcome = await completePasswordReset(parsed.data.token, parsed.data.newPassword);
    if (!outcome.ok) {
      console.warn(`[POST /api/account/reset-confirm] token refused: ${outcome.reason}`);
      return apiError(400, RESET_LINK_UNUSABLE_MESSAGE, "invalid_link");
    }
    // Deliberately no user id and no email in the payload.
    return apiOk({ reset: true });
  } catch (err) {
    console.error("[POST /api/account/reset-confirm] failed", err);
    return apiError(500, "Could not reset your password.", "reset_failed");
  }
}
