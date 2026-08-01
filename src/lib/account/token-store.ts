// =============================================================================
// PASSWORD-RESET TOKEN STORE — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The database half of the reset flow. Token maths lives in `tokens.ts` (pure);
// this file is only queries, so that everything security-critical can be tested
// without a database and everything here can be exercised end-to-end instead.
//
// SINGLE USE IS ENFORCED BY A CONDITIONAL UPDATE, NOT BY A READ-THEN-WRITE.
//
//   UPDATE auth_tokens SET used_at = $now
//    WHERE token_hash = $h AND purpose = 'password_reset'
//      AND used_at IS NULL AND expires_at > $now
//   RETURNING user_id
//
// A single statement takes the row lock, and Postgres re-evaluates the WHERE
// clause after acquiring it, so of two concurrent redemptions of the same link
// exactly one gets a row back and the other gets zero. A `SELECT ... then UPDATE`
// would let both readers see `used_at IS NULL` and both proceed — the classic
// double-redeem race, which for a reset link means a second party silently
// setting the password after the first.
//
// The password write and the sibling-token invalidation happen INSIDE the same
// transaction as that UPDATE. If the password write fails, the token is not
// consumed either, so the user's link still works.
// =============================================================================

import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { authTokens, users } from "@/db/schema";

import {
  generateResetToken,
  hashToken,
  looksLikeResetToken,
  resetTokenExpiresAt,
  tokenState,
} from "./tokens";

/** What `issuePasswordResetToken` hands back. The raw token is never persisted. */
export interface IssuedResetToken {
  /** The only copy of the raw token. Goes into the email and nowhere else. */
  rawToken: string;
  expiresAt: Date;
}

/**
 * Mint and store a reset token for `userId`.
 *
 * Existing outstanding tokens are NOT invalidated here. A user who clicks
 * "forgot password" twice because the first mail was slow would otherwise find
 * that only the newest link works, while the older mail — possibly the one that
 * arrived — is dead. Multiple live links are acceptable: each is single-use, each
 * expires in 30 minutes, and all of them are invalidated the moment one is
 * redeemed (see `consumePasswordResetToken`). The per-email rate limit is what
 * bounds how many can exist.
 */
export async function issuePasswordResetToken(
  userId: number,
  nowMs: number = Date.now(),
): Promise<IssuedResetToken> {
  const rawToken = generateResetToken();
  const expiresAt = resetTokenExpiresAt(nowMs);

  await db.insert(authTokens).values({
    userId,
    purpose: "password_reset",
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export type ConsumeResetOutcome =
  | { ok: true; userId: number; invalidatedSiblings: number }
  | { ok: false; reason: "malformed" | "unknown" | "expired" | "used" };

/**
 * Redeem a reset token and set the new password, atomically.
 *
 * @param rawToken       the token from the link (raw, not hashed)
 * @param newPasswordHash a bcrypt hash — hashing is the caller's job, so this
 *                        module never has a plaintext password in scope
 */
export async function consumePasswordResetToken(
  rawToken: string,
  newPasswordHash: string,
  nowMs: number = Date.now(),
): Promise<ConsumeResetOutcome> {
  // Structural rejection first: no query for input that cannot be a token.
  if (!looksLikeResetToken(rawToken)) return { ok: false, reason: "malformed" };

  const tokenHash = hashToken(rawToken);
  const now = new Date(nowMs);

  return db.transaction(async (tx) => {
    // The atomic claim. See the file header for why this is one statement.
    const claimed = await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.usedAt),
          sql`${authTokens.expiresAt} > ${now}`,
        ),
      )
      .returning({ id: authTokens.id, userId: authTokens.userId });

    const row = claimed[0];
    if (!row) {
      // Nothing claimable. Read the row (still inside the transaction) purely to
      // report WHY — the caller renders one generic message either way, but the
      // distinction belongs in the server log.
      const [existing] = await tx
        .select({ expiresAt: authTokens.expiresAt, usedAt: authTokens.usedAt })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, tokenHash),
            eq(authTokens.purpose, "password_reset"),
          ),
        )
        .limit(1);

      if (!existing) return { ok: false, reason: "unknown" as const };
      const state = tokenState(existing, nowMs);
      return { ok: false, reason: state === "used" ? ("used" as const) : ("expired" as const) };
    }

    await tx
      .update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: now })
      .where(eq(users.id, row.userId));

    // Invalidate this user's OTHER outstanding reset tokens. A password change is
    // exactly the moment every previously mailed link must stop working: if the
    // request was triggered by an attacker who also holds an old link, leaving it
    // live would let them re-take the account minutes later.
    const siblings = await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.userId, row.userId),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.usedAt),
          ne(authTokens.id, row.id),
        ),
      )
      .returning({ id: authTokens.id });

    return { ok: true as const, userId: row.userId, invalidatedSiblings: siblings.length };
  });
}

/**
 * Invalidate every outstanding reset token for a user without redeeming one.
 *
 * Used by the authenticated password change: after a deliberate password change,
 * any reset link already in a mailbox must be dead for the same reason as above.
 */
export async function invalidateResetTokens(
  userId: number,
  nowMs: number = Date.now(),
): Promise<number> {
  const rows = await db
    .update(authTokens)
    .set({ usedAt: new Date(nowMs) })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, "password_reset"),
        isNull(authTokens.usedAt),
      ),
    )
    .returning({ id: authTokens.id });
  return rows.length;
}
