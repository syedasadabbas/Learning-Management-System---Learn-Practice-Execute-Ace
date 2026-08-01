// =============================================================================
// POST /api/auth/register  —  ROUTE_AUTH: "public"
// -----------------------------------------------------------------------------
// Public by design (and reviewed as such in src/lib/contracts/api.ts): a visitor
// has no session yet, so requiring one would make registration impossible.
//
// Always creates a `student`. Role is never taken from the request body — that
// would let anyone mint themselves an admin.
// =============================================================================

import { ZodError } from "zod";

import { registerSchema } from "@/lib/contracts/validation";
import { createStudentAccount, DuplicateEmailError, type PublicUser } from "@/lib/auth";
import { apiError, apiOk } from "@/lib/guard";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, firstIssueMessage(parsed.error), "validation_failed");
  }

  try {
    const user: PublicUser = await createStudentAccount(parsed.data);
    // `PublicUser` has no passwordHash field at all, so there is no way to leak
    // the hash from here even by accident.
    return apiOk(user, 201);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      // Registration DOES disclose that an email is taken — it has to, or the
      // user cannot tell why the form failed. Login deliberately does not (see
      // INVALID_CREDENTIALS_MESSAGE); that asymmetry is intentional.
      return apiError(409, err.message, err.code);
    }
    console.error("[auth] registration failed:", err);
    return apiError(500, "Could not create the account.", "registration_failed");
  }
}

/** The first validation problem, phrased for a form field. */
function firstIssueMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The submitted details are not valid.";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}
