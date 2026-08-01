// =============================================================================
// POST /api/account/password — owned by the `account` stream.
// -----------------------------------------------------------------------------
// Change the signed-in user's password. Requires the CURRENT password even though
// the request carries a valid session — the reasoning is in the header of
// src/lib/account/password.ts and is the point of the endpoint.
//
// Not in the frozen ROUTE_AUTH map (added after the freeze); guarded with the
// literal "student", which means "any signed-in role".
//
// A wrong current password is 403, not 401: the caller IS authenticated, and a 401
// would invite a client to treat it as an expired session and bounce the user to
// the login page mid-form.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import {
  changePassword,
  WRONG_CURRENT_PASSWORD_MESSAGE,
} from "@/lib/account/password";
import { passwordChangeSchema } from "@/lib/account/validation";

const REQUIRED_AUTH = "student" as const;

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = passwordChangeSchema.safeParse(body);
  if (!parsed.success) {
    // The first message is safe to return: it describes the caller's own input
    // ("passwords do not match", "at least 8 characters"), not any stored state.
    return apiError(
      422,
      parsed.error.issues[0]?.message ?? "Invalid request.",
      "invalid_fields",
    );
  }

  try {
    const outcome = await changePassword(
      gate.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    if (!outcome.ok) {
      // "no_such_user" is deliberately reported identically to a wrong password.
      return apiError(403, WRONG_CURRENT_PASSWORD_MESSAGE, "wrong_current_password");
    }

    // No token, no hash, nothing derived from the password in the response.
    return apiOk({
      changed: true,
      invalidatedResetTokens: outcome.invalidatedResetTokens,
    });
  } catch (err) {
    console.error("[POST /api/account/password] failed", err);
    return apiError(500, "Could not change your password.", "password_change_failed");
  }
}
