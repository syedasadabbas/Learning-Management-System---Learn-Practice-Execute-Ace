// =============================================================================
// PASSWORD-CHANGE TESTS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The property under test: a caller who holds a valid session but NOT the current
// password cannot change the password. Real bcrypt hashes, injected store — the
// dependency seam in password.ts exists for this.
//
// bcrypt is deliberately slow (~100 ms per operation at cost 10), so the fixtures
// are hashed once for the whole file and the per-test timeout is raised.
// =============================================================================

import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it, vi } from "vitest";

// password.ts imports @/db transitively (via token-store). Mocked so no test can
// open a connection — tests/setup.ts sets a deliberately unreachable DATABASE_URL.
vi.mock("@/db", () => ({ db: {} }));

// It also reads BCRYPT_ROUNDS from @/lib/auth, whose module body calls
// NextAuth({...}). Mocked for the same reason src/lib/register.test.ts mocks it:
// that call drags next/headers into jsdom.
vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {}
  return {
    default: () => ({
      handlers: { GET: vi.fn(), POST: vi.fn() },
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    }),
    AuthError,
    CredentialsSignin,
  };
});
vi.mock("next-auth/providers/credentials", () => ({ default: (c: unknown) => c }));

import {
  changePassword,
  type ChangePasswordDeps,
  WRONG_CURRENT_PASSWORD_MESSAGE,
} from "./password";

const CURRENT = "Passw0rd!demo";
const NEXT = "N3wPassw0rd!";

let currentHash = "";

beforeAll(async () => {
  // Cost 4 rather than the production 10: this file tests the control flow around
  // bcrypt, not bcrypt's work factor, and 10 rounds x 12 cases is 1.5 s of nothing.
  currentHash = await bcrypt.hash(CURRENT, 4);
}, 30_000);

interface Recorder {
  deps: ChangePasswordDeps;
  stored: string[];
  invalidatedFor: number[];
}

function recorder(storedHash: string | null): Recorder {
  const stored: string[] = [];
  const invalidatedFor: number[] = [];
  return {
    stored,
    invalidatedFor,
    deps: {
      loadPasswordHash: async () => storedHash,
      storePasswordHash: async (_userId, hash) => {
        stored.push(hash);
      },
      invalidateResetTokens: async (userId) => {
        invalidatedFor.push(userId);
        return 2;
      },
      compare: (plain, hash) => bcrypt.compare(plain, hash),
      hash: (plain) => bcrypt.hash(plain, 4),
      nowMs: () => 1_700_000_000_000,
    },
  };
}

describe("changePassword", () => {
  it("refuses a WRONG current password and writes nothing", async () => {
    const r = recorder(currentHash);
    const outcome = await changePassword(7, "not-my-password", NEXT, r.deps);

    expect(outcome).toEqual({ ok: false, reason: "wrong_current_password" });
    // The critical assertion: no hash was written. A refusal that still wrote
    // would be an account takeover with an error message on top.
    expect(r.stored).toEqual([]);
    expect(r.invalidatedFor).toEqual([]);
  });

  it("refuses an EMPTY current password", async () => {
    const r = recorder(currentHash);
    const outcome = await changePassword(7, "", NEXT, r.deps);
    expect(outcome.ok).toBe(false);
    expect(r.stored).toEqual([]);
  });

  it("refuses when the current password is the NEW password (a guess)", async () => {
    const r = recorder(currentHash);
    const outcome = await changePassword(7, NEXT, NEXT, r.deps);
    expect(outcome).toEqual({ ok: false, reason: "wrong_current_password" });
    expect(r.stored).toEqual([]);
  });

  it("accepts the correct current password and stores a bcrypt hash of the new one", async () => {
    const r = recorder(currentHash);
    const outcome = await changePassword(7, CURRENT, NEXT, r.deps);

    expect(outcome).toEqual({ ok: true, invalidatedResetTokens: 2 });
    expect(r.stored).toHaveLength(1);
    // Stored, never plaintext.
    expect(r.stored[0]).not.toBe(NEXT);
    expect(r.stored[0]).toMatch(/^\$2[aby]\$/);
    await expect(bcrypt.compare(NEXT, r.stored[0])).resolves.toBe(true);
    await expect(bcrypt.compare(CURRENT, r.stored[0])).resolves.toBe(false);
  });

  it("invalidates the user's outstanding reset links on success", async () => {
    // A deliberate change must kill any reset mail already in a mailbox, or an
    // attacker holding an old link re-takes the account minutes later.
    const r = recorder(currentHash);
    await changePassword(42, CURRENT, NEXT, r.deps);
    expect(r.invalidatedFor).toEqual([42]);
  });

  it("reports no_such_user when the row is gone, and writes nothing", async () => {
    const r = recorder(null);
    const outcome = await changePassword(7, CURRENT, NEXT, r.deps);
    expect(outcome).toEqual({ ok: false, reason: "no_such_user" });
    expect(r.stored).toEqual([]);
  });

  it("never compares against a dummy hash on the missing-row path", async () => {
    // If the row is missing there is nothing to compare; the function must not
    // invent a hash and then report a password mismatch, because the caller
    // collapses both to the same message and would hide a deleted account.
    const compare = vi.fn(async () => true);
    const r = recorder(null);
    const outcome = await changePassword(7, CURRENT, NEXT, { ...r.deps, compare });
    expect(compare).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
  });

  it("exposes one generic refusal message", () => {
    // Must not name which half failed.
    expect(WRONG_CURRENT_PASSWORD_MESSAGE).not.toMatch(/user|account|exist/i);
  });
}, 30_000);
