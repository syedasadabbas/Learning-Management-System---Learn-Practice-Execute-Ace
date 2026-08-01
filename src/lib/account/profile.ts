// =============================================================================
// PROFILE READ / WRITE — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The write is an EXPLICIT COLUMN LIST, never a spread of parsed input:
//
//   .set({ name, avatarUrl, bio, githubProfile, linkedinProfile, updatedAt })
//
// `email` and `role` are absent, and that absence is the security property. A
// `.set({ ...parsed })` would depend entirely on the schema never gaining a key
// and on Zod stripping unknown ones; here, adding `role` to a request body has
// no expressible path to the column. A self-service role change is privilege
// escalation to admin, so it gets a structural barrier rather than a check.
//
// `passwordHash` never leaves this module. The read selects named columns, so it
// cannot be leaked by a future `select()` gaining a column — `toPublicUser` in
// src/lib/auth.ts covers the row-shaped path; this covers the projected one.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import type { UserRole } from "@/lib/guard";

import { blankToNull, type ProfileFormInput } from "./validation";

/** What the settings page renders. No hash, and role is display-only. */
export interface AccountProfile {
  id: number;
  email: string;
  name: string;
  /** Shown as read-only text. Changing it is an administrative action. */
  role: UserRole;
  cohortId: number | null;
  avatarUrl: string | null;
  bio: string | null;
  githubProfile: string | null;
  linkedinProfile: string | null;
  updatedAt: Date;
}

/** Named-column projection. See the header for why this is not `select()`. */
const PROFILE_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  cohortId: users.cohortId,
  avatarUrl: users.avatarUrl,
  bio: users.bio,
  githubProfile: users.githubProfile,
  linkedinProfile: users.linkedinProfile,
  updatedAt: users.updatedAt,
} as const;

/**
 * The signed-in user's own profile, or null when the row is gone.
 *
 * A null here with a live session means the account was deleted while the JWT
 * was still valid — the session strategy is stateless (see src/lib/auth.ts), so
 * that combination is reachable and must not be a crash.
 */
export async function getAccountProfile(userId: number): Promise<AccountProfile | null> {
  const [row] = await db
    .select(PROFILE_COLUMNS)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Apply a validated profile edit. Returns the refreshed profile.
 *
 * @param userId taken from the SESSION by every caller. There is deliberately no
 *               way to pass a different id from a request body.
 */
export async function updateAccountProfile(
  userId: number,
  input: ProfileFormInput,
  nowMs: number = Date.now(),
): Promise<AccountProfile | null> {
  const [row] = await db
    .update(users)
    .set({
      name: input.name.trim(),
      // Cleared fields become NULL rather than "" — see blankToNull.
      avatarUrl: blankToNull(input.avatarUrl),
      bio: blankToNull(input.bio),
      githubProfile: blankToNull(input.githubProfile),
      linkedinProfile: blankToNull(input.linkedinProfile),
      updatedAt: new Date(nowMs),
    })
    .where(eq(users.id, userId))
    .returning(PROFILE_COLUMNS);

  return row ?? null;
}
