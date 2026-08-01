// =============================================================================
// AUTH.JS (NextAuth v5) CONFIGURATION — owned by the auth stream.
// -----------------------------------------------------------------------------
// Installed version: next-auth 5.0.0-beta.32 (@auth/core 0.40.x). The v5 API is
// used throughout: `NextAuth(config)` returns `{ handlers, auth, signIn, signOut }`.
//
// SESSION STRATEGY: JWT, and this is not a preference — it is forced by the
// frozen schema. `src/db/schema.ts` has no `sessions` and no `accounts` table,
// so a Drizzle adapter would have nowhere to write. The JWT *is* the session
// store; everything a request needs (`id`, `role`, `cohortId`) is minted into
// the token at sign-in and read back in the `session` callback.
//
// COST of that choice, stated plainly (house rule 7): a role or cohort change
// does not take effect until the token is refreshed, because no server-side
// session record exists to invalidate. If instant revocation is ever required,
// that is a coordinated schema change (add a `sessions` table), not a
// per-stream decision.
//
// RUNTIME: this module imports `pg` and `bcryptjs`, so it is Node-runtime only.
// It must NEVER be imported from `middleware.ts` — see middleware.ts for how the
// edge verifies the token without pulling this file in.
// =============================================================================

import NextAuth, { AuthError, CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { loginSchema, type RegisterInput } from "@/lib/contracts/validation";

/**
 * bcrypt work factor. MUST match `scripts/seed.ts` (10 rounds) — the seeded demo
 * accounts were hashed with it, and bcrypt embeds the cost in the hash so a
 * mismatch would not break verification, but keeping one number in two places
 * consistent avoids a silently weaker hash for newly registered students.
 *
 * 10 rounds is roughly 100 ms per hash on current hardware: slow enough to make
 * offline cracking expensive, fast enough for an interactive login. Raise it
 * only together with a login-latency measurement (milliseconds, metric units).
 */
export const BCRYPT_ROUNDS = 10;

/**
 * JWT / session lifetime in SECONDS (Auth.js expresses `maxAge` in seconds, not
 * milliseconds). 30 days = 2_592_000 s.
 */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * A bcrypt hash of a value nobody can supply. Compared against when the email
 * is unknown so that "no such user" and "wrong password" take about the same
 * time (~100 ms). Without this, response latency alone leaks which emails are
 * registered — the same enumeration leak the generic error message prevents.
 */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/** The single user-facing login failure message. Never says which half failed. */
export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

/** Thrown by `authorize()` so the login form can render one generic message. */
class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}

/**
 * Where a freshly authenticated user lands.
 *
 * Now /dashboard: progress-tracking has landed and src/app/(app)/dashboard exists.
 * It renders correctly for a student with zero recorded activity, which is the
 * state of every account immediately after registration.
 */
export const AFTER_LOGIN_PATH = "/dashboard";

/**
 * The role on an account, by email, or null when there is no such account.
 *
 * WHY THE LOGIN ACTION NEEDS THIS. `AFTER_LOGIN_PATH` above is one path for every
 * role, so an instructor or admin signing in landed on the STUDENT dashboard —
 * reported as a bug on 2026-08-01. The destination has to be chosen by role, and
 * the action cannot read the new session to find it: `signIn(..., { redirect: false })`
 * stages the cookie on the response, while `auth()` reads the cookies that arrived
 * with the request, so inside that same request the caller is still anonymous.
 *
 * The email is therefore looked up directly. Called only AFTER signIn has
 * succeeded, so this is not an authentication step and leaks nothing: whoever
 * reaches it has already proven they hold this account's password.
 *
 * Returns the raw column value rather than a narrowed union, so a role added to
 * the enum but not yet known to the navigation tables degrades to "unknown role"
 * at the call site instead of failing to compile here.
 */
export async function roleForEmail(email: string): Promise<string | null> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, normaliseEmail(email)))
    .limit(1);
  return row?.role ?? null;
}

// ---------------------------------------------------------------------------
// Registration (shared by the API route and the register page's server action)
// ---------------------------------------------------------------------------

/** Raised when the email is already taken. Surfaced verbatim to the registrant. */
export class DuplicateEmailError extends Error {
  readonly code = "email_taken";
  constructor() {
    super("An account with that email already exists.");
    this.name = "DuplicateEmailError";
  }
}

/** A user row with the password hash removed. Never return the hash anywhere. */
export type PublicUser = Omit<User, "passwordHash">;

/** Strip the hash. Used on every path that returns a user to a client. */
export function toPublicUser(row: User): PublicUser {
  // Destructured out deliberately; the underscore satisfies the lint rule that
  // otherwise flags the unused binding.
  const { passwordHash: _passwordHash, ...rest } = row;
  return rest;
}

/** Emails are compared case-insensitively; store the normalised form. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Hash the password and insert a `student`. Roles are never self-assigned:
 * self-registration always produces a student, and promotion to instructor or
 * admin is an administrative action (instructor-admin stream).
 *
 * @throws DuplicateEmailError when the email is taken.
 */
export async function createStudentAccount(input: RegisterInput): Promise<PublicUser> {
  const email = normaliseEmail(input.email);

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new DuplicateEmailError();

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  try {
    const [row] = await db
      .insert(users)
      .values({
        email,
        name: input.name.trim(),
        passwordHash,
        role: "student",
        cohortId: input.cohortId ?? null,
      })
      .returning();
    return toPublicUser(row);
  } catch (err) {
    // `users_email_idx` is unique, so two concurrent registrations for the same
    // email race past the SELECT above and one hits the constraint. Translate it
    // instead of surfacing a driver error as a 500.
    if (isUniqueViolation(err)) throw new DuplicateEmailError();
    throw err;
  }
}

/** Postgres unique-violation SQLSTATE. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

// ---------------------------------------------------------------------------
// Auth.js config
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Vercel/Neon preview URLs are not known ahead of time; Auth.js needs to trust
  // the forwarded host to build callback URLs. AUTH_SECRET still signs the JWT.
  trustHost: true,

  session: {
    // MANDATORY — see the header comment. There is no session table to adapt to.
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  pages: {
    // Our own form, not the Auth.js default page. Must stay in sync with
    // tests/e2e/fixtures.ts, which every other stream's e2e suite depends on.
    signIn: "/login",
    error: "/login",
  },

  providers: [
    Credentials({
      // Field names must be `email` / `password`: tests/e2e/fixtures.ts fills
      // input[name="email"] and input[name="password"].
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        // Never trust the shape Auth.js hands over — validate with the frozen
        // schema rather than a local re-declaration.
        const parsed = loginSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
        });
        if (!parsed.success) throw new InvalidCredentials();

        const email = normaliseEmail(parsed.data.email);
        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        // Constant-ish time on the unknown-email path (see DUMMY_HASH).
        const hash = row?.passwordHash ?? DUMMY_HASH;
        const passwordMatches = await bcrypt.compare(parsed.data.password, hash);

        if (!row || !passwordMatches) throw new InvalidCredentials();

        // Only non-secret fields leave this function. The hash never travels
        // into the JWT, the session, a log line, or a response body.
        return {
          id: String(row.id),
          email: row.email,
          name: row.name,
          role: row.role,
          cohortId: row.cohortId,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Mint `{ id, role, cohortId }` into the token at sign-in. `user` is only
     * present on the first call; afterwards the token is read back as-is.
     */
    jwt({ token, user }) {
      if (user) {
        token.id = String(user.id);
        token.role = user.role;
        token.cohortId = user.cohortId;
      }
      return token;
    },

    /**
     * Project the token onto the session. Downstream streams depend on this
     * exact shape: `session.user` carries `id`, `role` and `cohortId`.
     */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? String(token.sub ?? "");
        session.user.role = token.role;
        session.user.cohortId = token.cohortId ?? null;
      }
      return session;
    },
  },
});

/** Re-exported so callers can narrow sign-in failures without a second import. */
export { AuthError };
