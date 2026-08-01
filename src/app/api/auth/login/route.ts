// =============================================================================
// POST /api/auth/login  —  ROUTE_AUTH: "public"
// -----------------------------------------------------------------------------
// A JSON entry point for the same credentials flow the /login form uses, for
// clients that are not the HTML form. On success the Auth.js session cookie is
// set on the response by signIn(); the caller then holds a session like any
// browser would.
//
// The failure message is deliberately identical for "no such email" and "wrong
// password" — see INVALID_CREDENTIALS_MESSAGE. Anything more specific turns this
// endpoint into an account-enumeration oracle.
// =============================================================================

import { loginSchema } from "@/lib/contracts/validation";
import { AuthError, INVALID_CREDENTIALS_MESSAGE, signIn } from "@/lib/auth";
import { apiError, apiOk, getSessionUser } from "@/lib/guard";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    // Still generic: a shape complaint that named the missing field would be
    // fine, but keeping one message keeps the enumeration surface at zero.
    return apiError(400, INVALID_CREDENTIALS_MESSAGE, "invalid_credentials");
  }

  try {
    const result: unknown = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      // Do not 302 a JSON caller. signIn still writes the session cookie.
      redirect: false,
    });

    // Defensive: if a future Auth.js version reports the failure by returning an
    // error URL instead of throwing, do not report success.
    if (typeof result === "string" && /[?&]error=/.test(result)) {
      return apiError(401, INVALID_CREDENTIALS_MESSAGE, "invalid_credentials");
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(401, INVALID_CREDENTIALS_MESSAGE, "invalid_credentials");
    }
    // Never echo the thrown value: it can contain the submitted password.
    console.error("[auth] login failed unexpectedly:", (err as Error)?.name);
    return apiError(500, "Could not sign in.", "login_failed");
  }

  const user = await getSessionUser();
  if (!user) {
    // Cookie was written but this request's context cannot see it yet. Report
    // success without a body rather than pretending the login failed.
    return apiOk({ signedIn: true });
  }
  return apiOk({ signedIn: true, user });
}
