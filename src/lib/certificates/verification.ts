// =============================================================================
// VERIFICATION CODES — the unguessable public identifier for a credential.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// A certificate is a CREDENTIAL, and its verify link is deliberately readable by
// anyone with the link and by nobody else. That makes the code itself the entire
// access control for the public surface, so it is built to the same standard as
// a password-reset token rather than as a slug:
//
//   * 16 bytes from `crypto.randomBytes` = 128 bits. Not `Math.random()`, which
//     is seeded from a value an attacker can often reconstruct and is not a CSPRNG
//     in any V8 build.
//   * Lowercase hex, so the code survives a copy-paste out of a PDF, a URL bar
//     that lowercases the path on some clients, and a phone keyboard. Base64url
//     would be shorter but is case-SIGNIFICANT, and "was that an l or an I" is a
//     support ticket for a string a human retypes off a printed certificate.
//   * NO STUDENT-DERIVED INPUT. Not a hash of the student id, the email, or the
//     issue date — anything derived is anything reproducible, and a verifier who
//     works out the recipe can enumerate the whole cohort's credentials from a
//     class list. The code carries no information about its holder at all.
//
// WHY NOT SIGN IT INSTEAD (a JWT, or an HMAC of the certificate id)? A signed
// token needs no lookup table, but it also cannot be REVOKED without one, and
// revocation is a stated requirement of this feature. Once a lookup is required
// anyway, a random opaque code is strictly simpler and leaks strictly less.
//
// COLLISION: at 128 bits, the probability of two codes colliding across even a
// billion certificates is negligible; the unique index
// `certificates_verification_code_idx` is nonetheless the authority, and
// src/lib/certificates/store.ts retries on it rather than assuming.
// =============================================================================

import { randomBytes } from "node:crypto";

/** Bytes of entropy per code. 16 -> 128 bits -> 32 hex characters. */
export const VERIFICATION_CODE_BYTES = 16;

/** Length of the rendered code, in characters. Two hex characters per byte. */
export const VERIFICATION_CODE_LENGTH = VERIFICATION_CODE_BYTES * 2;

/** Exactly what a valid code looks like. Anchored — a prefix match is not a match. */
const CODE_PATTERN = new RegExp(`^[0-9a-f]{${VERIFICATION_CODE_LENGTH}}$`);

/** A fresh, cryptographically random verification code. */
export function generateVerificationCode(): string {
  return randomBytes(VERIFICATION_CODE_BYTES).toString("hex");
}

/**
 * Is `value` shaped like a code this system issues?
 *
 * CHECKED BEFORE ANY DATABASE LOOKUP, on purpose. The public verify route takes
 * its parameter straight from the URL, so this is the cheap filter that keeps a
 * crawler walking `/verify/1`, `/verify/2`, ... from costing a query each. It is
 * a shape test and NOT an authorization decision — a well-formed code that
 * matches no row is still "not found".
 */
export function isVerificationCodeShape(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/**
 * Normalise a code arriving from a URL or a form before comparison.
 *
 * Trims and lowercases ONLY. It does not strip separators or repair characters:
 * a code is either the string we issued or it is not, and "helpfully" mapping a
 * near-miss onto a real credential is how a typo becomes someone else's
 * certificate. Uppercase is accepted because some mail clients and PDF readers
 * upper-case a URL they auto-link, which is a transport artefact rather than a
 * different code.
 */
export function normaliseVerificationCode(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The public verify URL path for a code.
 *
 * ORIGIN-RELATIVE, and that is load-bearing rather than tidy — see CHANGELOG.log
 * 2026-07-31 15:40, where an absolute URL baked at seed time and served to a
 * different origin dropped the session cookie and broke a whole e2e group. A
 * relative path is correct on every origin at once: localhost, 127.0.0.1, a
 * Vercel preview deployment, and a custom domain added later.
 *
 * The PDF is the one place that needs an ABSOLUTE URL, because a printed page has
 * no origin to resolve against. That is handled at the render call site, which is
 * the only place that knows the request's origin.
 */
export function verificationPath(code: string): string {
  return `/verify/${code}`;
}
