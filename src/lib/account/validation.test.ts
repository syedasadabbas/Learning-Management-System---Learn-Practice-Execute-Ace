// =============================================================================
// ACCOUNT VALIDATION TESTS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The headline assertion is the privilege-escalation one: `role` and `email` are
// dropped by the profile schema, so a hand-built POST carrying `"role":"admin"`
// cannot reach a column. Everything else here is boundary behaviour.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  blankToNull,
  fieldErrors,
  passwordChangeSchema,
  PASSWORD_MIN_LENGTH,
  profileFormSchema,
  resetConfirmSchema,
  resetRequestSchema,
} from "./validation";

describe("profileFormSchema — the escalation barrier", () => {
  it("STRIPS role from a parsed profile edit", () => {
    const parsed = profileFormSchema.parse({
      name: "Demo Student",
      role: "admin",
      email: "attacker@example.test",
      isAdmin: true,
    });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("email");
    expect(parsed).not.toHaveProperty("isAdmin");
    expect(Object.keys(parsed).sort()).toEqual(["name"]);
  });

  it("accepts the five editable fields", () => {
    const parsed = profileFormSchema.parse({
      name: "Demo Student",
      avatarUrl: "https://cdn.example/a.png",
      bio: "Learning to build for the web.",
      githubProfile: "https://github.com/demo",
      linkedinProfile: "https://www.linkedin.com/in/demo",
    });
    expect(parsed.name).toBe("Demo Student");
    expect(parsed.githubProfile).toBe("https://github.com/demo");
  });

  it("accepts empty strings for the optional links (a cleared field)", () => {
    const parsed = profileFormSchema.parse({
      name: "Demo Student",
      avatarUrl: "",
      githubProfile: "",
      linkedinProfile: "",
    });
    expect(parsed.avatarUrl).toBe("");
  });

  it("rejects a non-URL link rather than storing a broken href", () => {
    expect(
      profileFormSchema.safeParse({ name: "Demo Student", githubProfile: "github.com/demo" })
        .success,
    ).toBe(false);
    expect(
      profileFormSchema.safeParse({ name: "Demo Student", avatarUrl: "not a url" }).success,
    ).toBe(false);
  });

  it("rejects a name shorter than 2 characters or longer than 255", () => {
    expect(profileFormSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(profileFormSchema.safeParse({ name: "A".repeat(256) }).success).toBe(false);
  });

  it("trims the name, so whitespace alone is not a valid name", () => {
    expect(profileFormSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(profileFormSchema.parse({ name: "  Demo  " }).name).toBe("Demo");
  });

  it("rejects a bio over 2000 characters (the frozen column bound)", () => {
    expect(
      profileFormSchema.safeParse({ name: "Demo", bio: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("blankToNull", () => {
  it("turns an empty or whitespace field into null, not an empty string", () => {
    // An empty string in `github_profile` renders as an empty link; null renders
    // as nothing at all.
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull(null)).toBeNull();
  });

  it("trims a real value", () => {
    expect(blankToNull("  https://x.test  ")).toBe("https://x.test");
  });
});

describe("passwordChangeSchema", () => {
  const base = {
    currentPassword: "Passw0rd!demo",
    newPassword: "N3wPassw0rd!",
    confirmPassword: "N3wPassw0rd!",
  };

  it("accepts a well-formed change", () => {
    expect(passwordChangeSchema.safeParse(base).success).toBe(true);
  });

  it("requires the current password to be present", () => {
    const result = passwordChangeSchema.safeParse({ ...base, currentPassword: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a mismatched confirmation", () => {
    const result = passwordChangeSchema.safeParse({ ...base, confirmPassword: "other" });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!).confirmPassword).toMatch(/do not match/i);
  });

  it("rejects a new password shorter than the registration minimum", () => {
    // A reset/change path that accepted a weaker password than registration would
    // be a way to downgrade an account's password policy.
    const short = "x".repeat(PASSWORD_MIN_LENGTH - 1);
    const result = passwordChangeSchema.safeParse({
      ...base,
      newPassword: short,
      confirmPassword: short,
    });
    expect(result.success).toBe(false);
  });

  it("rejects reusing the current password", () => {
    const result = passwordChangeSchema.safeParse({
      currentPassword: base.currentPassword,
      newPassword: base.currentPassword,
      confirmPassword: base.currentPassword,
    });
    expect(result.success).toBe(false);
  });
});

describe("resetRequestSchema", () => {
  it("accepts and trims a valid address", () => {
    expect(resetRequestSchema.parse({ email: "  a@b.test " }).email).toBe("a@b.test");
  });

  it("rejects a non-address", () => {
    expect(resetRequestSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(resetRequestSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("takes nothing but an email — there is no other field to correlate on", () => {
    const parsed = resetRequestSchema.parse({ email: "a@b.test", userId: 1 });
    expect(Object.keys(parsed)).toEqual(["email"]);
  });
});

describe("resetConfirmSchema", () => {
  const token = "d".repeat(64);

  it("accepts a matching pair", () => {
    expect(
      resetConfirmSchema.safeParse({
        token,
        newPassword: "N3wPassw0rd!",
        confirmPassword: "N3wPassw0rd!",
      }).success,
    ).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(
      resetConfirmSchema.safeParse({
        token,
        newPassword: "N3wPassw0rd!",
        confirmPassword: "N3wPassw0rd?",
      }).success,
    ).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(
      resetConfirmSchema.safeParse({
        token: "",
        newPassword: "N3wPassw0rd!",
        confirmPassword: "N3wPassw0rd!",
      }).success,
    ).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("keeps the FIRST message per field", () => {
    const result = profileFormSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    const errors = fieldErrors(result.error!);
    expect(Object.keys(errors)).toEqual(["name"]);
    expect(typeof errors.name).toBe("string");
  });
});
