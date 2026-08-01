// =============================================================================
// NEXT-AUTH TYPE AUGMENTATION — owned by the auth stream.
// -----------------------------------------------------------------------------
// Auth.js ships `Session.user` as `User | undefined`, where the base `User` is
// `{ id?: string; name?: string | null; email?: string | null; image?: ... }`.
// This app needs `role` and `cohortId` on every session, and downstream streams
// must read them without `any`.
//
// TRADE-OFF, stated plainly (house rule 7):
//   `users.id` is a Postgres `serial` (number), but Auth.js fixes `User.id` to
//   `string` in its own base interface. Interface merging cannot narrow an
//   existing property to a different type, so we do NOT try to redeclare it as
//   `number` — that would be a compile error, and monkey-patching the library
//   types is worse than converting once at the seam.
//
//   Therefore:
//     * `session.user.id`  -> string (Auth.js contract, e.g. "42")
//     * `requireUser().id` -> number (the app contract; see src/lib/guard.ts)
//
//   Every stream should read the session through `src/lib/guard.ts`, which does
//   the conversion in exactly one place and returns a numeric `id` ready to use
//   in Drizzle `eq(users.id, user.id)` comparisons.
// =============================================================================

import type { userRole } from "@/db/schema";

/** "student" | "instructor" | "admin" — sourced from the frozen pgEnum. */
type UserRole = (typeof userRole.enumValues)[number];

declare module "next-auth" {
  /**
   * Returned by the credentials provider's `authorize()` and therefore present
   * on `session.user`. `id` stays a string per the Auth.js base interface.
   */
  interface User {
    role: UserRole;
    /** Null for staff — instructors and admins are not cohort-scoped. */
    cohortId: number | null;
  }
}

declare module "next-auth/jwt" {
  /** The JWT payload. This is the whole session store — there is no DB adapter. */
  interface JWT {
    /** Stringified `users.id`. */
    id: string;
    role: UserRole;
    cohortId: number | null;
  }
}
