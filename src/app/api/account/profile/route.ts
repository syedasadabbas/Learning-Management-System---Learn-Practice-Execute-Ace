// =============================================================================
// GET / PATCH /api/account/profile — owned by the `account` stream.
// -----------------------------------------------------------------------------
// NOT IN THE FROZEN `ROUTE_AUTH` MAP: that map is part of the frozen seam and
// these paths were added after it. The required level is therefore stated here as
// a literal `"student"`, which in `ROLES_SATISFYING` means "any signed-in role"
// (staff satisfy student-scoped routes — see src/lib/guard.ts).
//
// SELF-ONLY, with no way to say otherwise. The id comes from the session; there is
// no `?userId=` to honour and no `id` key read from the body, following the rule
// /api/me/progress set: never accepting the parameter is safer than checking it.
//
// `email` and `role` are absent from `profileFormSchema` AND from the column list
// in profile.ts. A PATCH body carrying `"role":"admin"` is silently dropped by the
// schema and has no path to a column even if it were not.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { getAccountProfile, updateAccountProfile } from "@/lib/account/profile";
import { fieldErrors, profileFormSchema } from "@/lib/account/validation";

/** Any signed-in role. See the header for why this is a literal. */
const REQUIRED_AUTH = "student" as const;

// The response reflects a row this endpoint also writes; a cached GET would serve
// the pre-edit values.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  try {
    const profile = await getAccountProfile(gate.user.id);
    if (!profile) return apiError(404, "Account not found.", "no_such_user");
    return apiOk(profile);
  } catch (err) {
    console.error("[GET /api/account/profile] failed", err);
    return apiError(500, "Could not load your profile.", "profile_read_failed");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = profileFormSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      422,
      "Some fields are invalid.",
      // Field detail is safe here: the caller is authenticated and the fields are
      // their own. It is the reset endpoints where detail leaks.
      `invalid_fields:${Object.keys(fieldErrors(parsed.error)).join(",")}`,
    );
  }

  try {
    const profile = await updateAccountProfile(gate.user.id, parsed.data);
    if (!profile) return apiError(404, "Account not found.", "no_such_user");
    return apiOk(profile);
  } catch (err) {
    console.error("[PATCH /api/account/profile] failed", err);
    return apiError(500, "Could not save your profile.", "profile_write_failed");
  }
}
