// =============================================================================
// PASSWORD-RESET TOKEN PRIMITIVES — owned by the `account` stream.
// -----------------------------------------------------------------------------
// PURE. No database, no mail, no `process.env`. Everything here is a function of
// its arguments, which is why the security-critical boundaries (expiry, single
// use, hashing) can be unit-tested exactly rather than approximately. The
// database side lives in `token-store.ts`.
//
// THE HASH IS THE WHOLE POINT.
// `auth_tokens.token_hash` stores sha256(raw token) and the raw token exists in
// exactly one place: the email. A stolen database backup therefore contains no
// usable reset link. sha256 with no salt and no work factor is correct HERE and
// would be wrong for a password: the input is 256 bits of CSPRNG output, so
// there is no dictionary to attack and no benefit from slowing a lookup down —
// while a fast hash keeps the redemption query an index probe on a unique index.
//
// TOKEN LENGTH: 32 bytes (256 bits) from `crypto.randomBytes`, hex-encoded to 64
// characters. sha256 hex is also 64 characters, which is exactly the width of
// the frozen `varchar(64)` column.
// =============================================================================

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * How long a reset link is valid, in milliseconds (metric units per house rules).
 * 30 minutes: long enough to survive mail-delivery latency and a distracted
 * user, short enough that a link sitting in a mailbox or a forwarded thread is
 * usually already dead.
 */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;

/** Entropy of the raw token, in bytes. */
export const RESET_TOKEN_BYTES = 32;

/** Length of the hex-encoded raw token. Used to reject malformed input early. */
export const RESET_TOKEN_HEX_LENGTH = RESET_TOKEN_BYTES * 2;

/** A fresh raw token. Returned to the caller ONCE and never stored. */
export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString("hex");
}

/**
 * sha256 of the raw token, hex-encoded — the only form that reaches the database.
 * See the header for why an unsalted fast hash is the right choice here.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Is this string shaped like one of our tokens?
 *
 * A cheap structural check so obviously-malformed input (an empty query
 * parameter, a truncated link, a probe) is rejected before it costs a query.
 */
export function looksLikeResetToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === RESET_TOKEN_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(value)
  );
}

/** Expiry instant for a token issued at `issuedAtMs`. */
export function resetTokenExpiresAt(issuedAtMs: number): Date {
  return new Date(issuedAtMs + PASSWORD_RESET_TTL_MS);
}

/** Why a token cannot be redeemed, or that it can. */
export type TokenState = "usable" | "used" | "expired";

/**
 * The token lifecycle decision, as a pure function.
 *
 * `used` is reported ahead of `expired` because it is the more informative
 * outcome: a token that was consumed and then aged out is still, first and
 * foremost, already spent.
 *
 * The expiry comparison is `expiresAt <= now` -> expired, so the boundary
 * instant itself is NOT accepted. At exactly 30 minutes the link is dead; a
 * strict `<` would leave a one-millisecond window whose behaviour depends on
 * clock resolution.
 */
export function tokenState(
  row: { expiresAt: Date; usedAt: Date | null },
  nowMs: number,
): TokenState {
  if (row.usedAt !== null) return "used";
  if (row.expiresAt.getTime() <= nowMs) return "expired";
  return "usable";
}

/**
 * Constant-time comparison of two token hashes.
 *
 * Redemption looks a token up by its unique index, so this is not on the hot
 * path — it exists for any caller that has both values in hand and would
 * otherwise reach for `===`, which leaks a prefix-match length through timing.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself the answer.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Absolute reset URL for a raw token. `origin` must not end in a slash. */
export function resetUrl(origin: string, rawToken: string): string {
  return `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;
}
