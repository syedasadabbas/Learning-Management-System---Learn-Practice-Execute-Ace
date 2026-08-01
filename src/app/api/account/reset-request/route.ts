// =============================================================================
// POST /api/account/reset-request — owned by the `account` stream.
// -----------------------------------------------------------------------------
// PUBLIC, and the response is IDENTICAL for a registered and an unregistered
// address: `{ ok: true, data: { accepted: true } }`, status 200, no field derived
// from the lookup. A locked-out user has no session, so this cannot be guarded —
// which makes it the most exposed endpoint this stream adds and the one where a
// difference of any kind hands over the cohort roster.
//
// WHAT IS DELIBERATELY *NOT* DIFFERENT:
//   * status code — 200 either way (429 only for rate limiting, which is keyed on
//     the submitted address and so is existence-independent);
//   * body — one literal;
//   * headers — nothing conditional;
//   * timing — padded to a floor inside requestPasswordReset;
//   * error behaviour — a transport or database failure still answers 200, because
//     "500 for this address, 200 for that one" is the same leak.
//
// A malformed address is 422, which is a property of the input rather than of the
// database, so it distinguishes nothing about who is registered.
// =============================================================================

import { apiError, apiOk } from "@/lib/guard";
import { clientIp } from "@/lib/account/rate-limit";
import { requestPasswordReset, RESET_REQUEST_ACKNOWLEDGEMENT } from "@/lib/account/reset";
import { resetRequestSchema } from "@/lib/account/validation";

// No guard call at all: this route is intentionally anonymous. Stated explicitly
// so a reviewer sees a decision rather than an omission.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = resetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, "Enter a valid email address.", "invalid_email");
  }

  const ip = clientIp(request.headers);

  let outcome: Awaited<ReturnType<typeof requestPasswordReset>>;
  try {
    outcome = await requestPasswordReset(parsed.data.email, ip);
  } catch (err) {
    // requestPasswordReset swallows its own failures; this is the backstop that
    // keeps an unexpected throw from becoming an address-dependent 500.
    console.error("[POST /api/account/reset-request] failed", err);
    return acknowledgement();
  }

  if (outcome.status === "rate_limited") {
    const response = apiError(
      429,
      "Too many reset requests for that address. Try again later.",
      "rate_limited",
    );
    // Seconds, because Retry-After is defined in seconds by RFC 9110 — the only
    // place in this stream where a duration is not expressed in milliseconds.
    response.headers.set(
      "retry-after",
      String(Math.ceil(outcome.retryAfterMs / 1_000)),
    );
    return response;
  }

  return acknowledgement();
}

/** The single 200 response. One literal, so no caller can vary it by accident. */
function acknowledgement(): Response {
  return apiOk({ accepted: true, message: RESET_REQUEST_ACKNOWLEDGEMENT });
}
