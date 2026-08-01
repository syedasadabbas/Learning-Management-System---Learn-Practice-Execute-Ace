// =============================================================================
// Unit tests for registration validation + account creation.
// Owned by the auth stream.
// -----------------------------------------------------------------------------
// Two things are under test:
//   1. registerSchema (the FROZEN contract) accepts/rejects the right payloads —
//      asserted here rather than in the route so the rule is pinned even if the
//      route changes shape.
//   2. createStudentAccount's behaviour around those payloads: it hashes rather
//      than stores the password, forces role=student, normalises the email, and
//      rejects a duplicate.
//
// `@/db` and `next-auth` are mocked. tests/setup.ts forbids reaching the real
// database from a unit test, and mocking next-auth keeps the module-level
// NextAuth({...}) call in src/lib/auth.ts from dragging next/headers into jsdom.
// The live-database path is covered by tests/e2e/auth/auth.spec.ts.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Mocks (hoisted above the imports of the module under test)
// ---------------------------------------------------------------------------

/** Rows the fake `select` will return. Set per test. */
const selectResult: { rows: unknown[] } = { rows: [] };
/** Values captured from the fake `insert`, so the test can inspect what was written. */
let insertedValues: Record<string, unknown> | null = null;

vi.mock("@/db", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => selectResult.rows,
  };
  const insertChain = {
    values: (v: Record<string, unknown>) => {
      insertedValues = v;
      return insertChain;
    },
    returning: async () => [
      {
        id: 101,
        email: insertedValues?.email,
        name: insertedValues?.name,
        passwordHash: insertedValues?.passwordHash,
        role: insertedValues?.role,
        cohortId: insertedValues?.cohortId ?? null,
        avatarUrl: null,
        bio: null,
        githubProfile: null,
        linkedinProfile: null,
        createdAt: new Date("2026-07-29T00:00:00Z"),
        updatedAt: new Date("2026-07-29T00:00:00Z"),
      },
    ],
  };
  return {
    db: { select: () => selectChain, insert: () => insertChain },
  };
});

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

import { registerSchema } from "@/lib/contracts/validation";
import {
  BCRYPT_ROUNDS,
  createStudentAccount,
  DuplicateEmailError,
  normaliseEmail,
  toPublicUser,
} from "@/lib/auth";

beforeEach(() => {
  selectResult.rows = [];
  insertedValues = null;
});

// ---------------------------------------------------------------------------
// registerSchema — the frozen validation contract
// ---------------------------------------------------------------------------

const VALID = {
  name: "Ada Lovelace",
  email: "ada@codequeenshub.test",
  password: "Passw0rd!demo",
};

describe("registerSchema", () => {
  it("accepts a well-formed registration", () => {
    expect(registerSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an optional numeric cohortId", () => {
    expect(registerSchema.safeParse({ ...VALID, cohortId: 1 }).success).toBe(true);
  });

  it("rejects a password shorter than 8 characters (the documented rule)", () => {
    const result = registerSchema.safeParse({ ...VALID, password: "Passw0r" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["password"]);
    }
  });

  it("accepts a password of exactly 8 characters (boundary)", () => {
    expect(registerSchema.safeParse({ ...VALID, password: "Passw0rd" }).success).toBe(true);
  });

  it("rejects a password longer than 128 characters", () => {
    expect(registerSchema.safeParse({ ...VALID, password: "a".repeat(129) }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    for (const email of ["not-an-email", "ada@", "@codequeenshub.test", ""]) {
      expect(registerSchema.safeParse({ ...VALID, email }).success).toBe(false);
    }
  });

  it("rejects a name shorter than 2 characters", () => {
    expect(registerSchema.safeParse({ ...VALID, name: "A" }).success).toBe(false);
  });

  it("rejects a missing field rather than defaulting it", () => {
    expect(registerSchema.safeParse({ email: VALID.email, password: VALID.password }).success)
      .toBe(false);
  });

  it("ignores an attempt to self-assign a role — the field is not in the schema", () => {
    const result = registerSchema.safeParse({ ...VALID, role: "admin" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("role" in result.data).toBe(false);
    }
  });

  it("rejects a non-positive cohortId", () => {
    expect(registerSchema.safeParse({ ...VALID, cohortId: 0 }).success).toBe(false);
    expect(registerSchema.safeParse({ ...VALID, cohortId: -3 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normaliseEmail
// ---------------------------------------------------------------------------

describe("normaliseEmail", () => {
  it("lowercases and trims so ' Ada@X ' and 'ada@x' are one account", () => {
    expect(normaliseEmail("  Ada@CodeQueensHub.TEST  ")).toBe("ada@codequeenshub.test");
  });
});

// ---------------------------------------------------------------------------
// createStudentAccount
// ---------------------------------------------------------------------------

describe("createStudentAccount", () => {
  it("stores a bcrypt hash, never the plaintext password", async () => {
    await createStudentAccount(VALID);

    const hash = insertedValues?.passwordHash as string;
    expect(hash).toBeTypeOf("string");
    expect(hash).not.toBe(VALID.password);
    expect(hash).not.toContain(VALID.password);
    // bcrypt hashes are 60 characters and begin with the cost-tagged prefix.
    expect(hash).toHaveLength(60);
    expect(await bcrypt.compare(VALID.password, hash)).toBe(true);
  });

  it(`uses ${BCRYPT_ROUNDS} rounds, matching scripts/seed.ts`, async () => {
    await createStudentAccount(VALID);
    const hash = insertedValues?.passwordHash as string;
    // bcrypt embeds the cost in the hash: $2a$10$...
    expect(hash.split("$")[2]).toBe(String(BCRYPT_ROUNDS).padStart(2, "0"));
    expect(BCRYPT_ROUNDS).toBe(10);
  });

  it("always creates a student — the role cannot be chosen by the registrant", async () => {
    await createStudentAccount({ ...VALID, ...({ role: "admin" } as object) });
    expect(insertedValues?.role).toBe("student");
  });

  it("normalises the email before insert", async () => {
    await createStudentAccount({ ...VALID, email: "  ADA@CodeQueensHub.test " });
    expect(insertedValues?.email).toBe("ada@codequeenshub.test");
  });

  it("trims the name", async () => {
    await createStudentAccount({ ...VALID, name: "  Ada Lovelace  " });
    expect(insertedValues?.name).toBe("Ada Lovelace");
  });

  it("stores a null cohortId when none is supplied (staff assign cohorts)", async () => {
    await createStudentAccount(VALID);
    expect(insertedValues?.cohortId).toBeNull();
  });

  it("never returns the password hash", async () => {
    const user = await createStudentAccount(VALID);
    expect(Object.keys(user)).not.toContain("passwordHash");
    expect(JSON.stringify(user)).not.toContain("$2");
  });

  it("rejects a duplicate email with a clear, actionable error", async () => {
    selectResult.rows = [{ id: 7, email: VALID.email }];
    await expect(createStudentAccount(VALID)).rejects.toBeInstanceOf(DuplicateEmailError);
    await expect(createStudentAccount(VALID)).rejects.toThrow(/already exists/i);
    // Nothing was written.
    expect(insertedValues).toBeNull();
  });

  it("treats a differently-cased duplicate as a duplicate", async () => {
    selectResult.rows = [{ id: 7, email: VALID.email }];
    await expect(
      createStudentAccount({ ...VALID, email: VALID.email.toUpperCase() }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });
});

describe("toPublicUser", () => {
  it("drops passwordHash and keeps everything else", () => {
    const row = {
      id: 1,
      email: "a@b.test",
      passwordHash: "$2a$10$secret",
      name: "A",
      role: "student" as const,
      cohortId: 1,
      avatarUrl: null,
      bio: null,
      githubProfile: null,
      linkedinProfile: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const publicUser = toPublicUser(row);
    expect(publicUser).not.toHaveProperty("passwordHash");
    expect(publicUser.email).toBe("a@b.test");
    expect(publicUser.role).toBe("student");
  });
});
