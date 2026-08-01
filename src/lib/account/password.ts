// =============================================================================
// AUTHENTICATED PASSWORD CHANGE — owned by the `account` stream.
// -----------------------------------------------------------------------------
// THE CURRENT PASSWORD IS REQUIRED EVEN THOUGH THE CALLER HOLDS A VALID SESSION.
//
// This is the whole point of the file. Sessions here are stateless JWTs with a
// 30-day lifetime and no server-side record to revoke (see the cost stated in
// src/lib/auth.ts). Without the current-password check, anyone who obtained a
// session cookie — a shared laptop, an XSS payload, a stolen backup of a browser
// profile — could set a new password and convert 30 days of borrowed access into
// permanent ownership of the account, locking the real student out. Re-proving
// knowledge of the password is what keeps a session compromise temporary.
//
// A wrong current password is reported as one generic message and never
// distinguishes "wrong password" from "no such user": the endpoint requires a
// session, so the user id is known, but a distinct error would still be a free
// oracle for anyone probing with a borrowed cookie.
//
// DEPENDENCIES ARE INJECTED (`ChangePasswordDeps`) so the refusal path is unit
// tested against real bcrypt hashes with no database. Callers use the default.
// =============================================================================

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { BCRYPT_ROUNDS } from "@/lib/auth";

import { invalidateResetTokens } from "./token-store";

export type ChangePasswordOutcome =
  | { ok: true; invalidatedResetTokens: number }
  | { ok: false; reason: "wrong_current_password" | "no_such_user" };

/** The single user-facing message for a refused change. Says nothing extra. */
export const WRONG_CURRENT_PASSWORD_MESSAGE =
  "That is not your current password.";

export interface ChangePasswordDeps {
  /** The stored bcrypt hash, or null when the row does not exist. */
  loadPasswordHash(userId: number): Promise<string | null>;
  storePasswordHash(userId: number, hash: string, nowMs: number): Promise<void>;
  /** Kills outstanding reset links. Returns how many were invalidated. */
  invalidateResetTokens(userId: number, nowMs: number): Promise<number>;
  compare(plain: string, hash: string): Promise<boolean>;
  hash(plain: string): Promise<string>;
  nowMs(): number;
}

export const defaultChangePasswordDeps: ChangePasswordDeps = {
  async loadPasswordHash(userId) {
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.passwordHash ?? null;
  },
  async storePasswordHash(userId, hash, nowMs) {
    await db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date(nowMs) })
      .where(eq(users.id, userId));
  },
  invalidateResetTokens,
  compare: (plain, hash) => bcrypt.compare(plain, hash),
  hash: (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS),
  nowMs: () => Date.now(),
};

/**
 * Change the password of `userId` after verifying `currentPassword`.
 *
 * The new hash is written only after a successful compare, and the user's
 * outstanding reset links are then invalidated: a deliberate password change is
 * exactly when a reset mail sitting in a mailbox must stop working.
 *
 * NOT DONE HERE, and stated plainly rather than implied: existing sessions are
 * NOT revoked, because a stateless JWT cannot be revoked without a sessions
 * table, and that table is a frozen-schema change. Consequence: after a change,
 * a previously stolen cookie still reads pages until it expires — but it can no
 * longer change the password or take the account over, which is the property this
 * function guarantees.
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  deps: ChangePasswordDeps = defaultChangePasswordDeps,
): Promise<ChangePasswordOutcome> {
  const storedHash = await deps.loadPasswordHash(userId);
  if (storedHash === null) return { ok: false, reason: "no_such_user" };

  const matches = await deps.compare(currentPassword, storedHash);
  if (!matches) return { ok: false, reason: "wrong_current_password" };

  const nowMs = deps.nowMs();
  const nextHash = await deps.hash(newPassword);
  await deps.storePasswordHash(userId, nextHash, nowMs);
  const invalidated = await deps.invalidateResetTokens(userId, nowMs);

  return { ok: true, invalidatedResetTokens: invalidated };
}
