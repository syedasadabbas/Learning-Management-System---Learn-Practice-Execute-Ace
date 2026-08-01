// =============================================================================
// VERIFICATION CODE TESTS — the unguessability of the one public identifier.
// -----------------------------------------------------------------------------
// The code IS the access control for the public verify surface, so these tests
// are about the properties that make that safe: enough entropy, no derivation
// from the holder, and a shape check that a crawler cannot walk past.
//
// Note what is NOT tested here, deliberately: that `randomBytes` is a CSPRNG.
// That is Node's guarantee, and a test asserting statistical randomness over 16
// bytes would be a flaky test that proves nothing.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  VERIFICATION_CODE_LENGTH,
  generateVerificationCode,
  isVerificationCodeShape,
  normaliseVerificationCode,
  verificationPath,
} from "./verification";

describe("generateVerificationCode", () => {
  it("is 32 lowercase hex characters, i.e. 128 bits", () => {
    const code = generateVerificationCode();
    expect(code).toHaveLength(32);
    expect(VERIFICATION_CODE_LENGTH).toBe(32);
    expect(code).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not repeat across a large batch", () => {
    // Not a randomness test — a cheap guard against a refactor that accidentally
    // hoists the buffer or the code out of the function and hands every
    // certificate the same identifier. That defect would make every credential
    // resolve to one student's.
    const codes = new Set(Array.from({ length: 2000 }, generateVerificationCode));
    expect(codes.size).toBe(2000);
  });
});

describe("isVerificationCodeShape", () => {
  it("accepts a freshly generated code", () => {
    expect(isVerificationCodeShape(generateVerificationCode())).toBe(true);
  });

  it("rejects the enumeration attempts this check exists to stop cheaply", () => {
    // /verify/1, /verify/2, ... must not reach the database at all.
    for (const bad of ["1", "42", "", "abc"]) {
      expect(isVerificationCodeShape(bad)).toBe(false);
    }
  });

  it("is anchored, so a valid code with anything appended is not a match", () => {
    const code = generateVerificationCode();
    expect(isVerificationCodeShape(`${code}x`)).toBe(false);
    expect(isVerificationCodeShape(`x${code}`)).toBe(false);
    // A trailing newline is what an unanchored regex would have let through.
    expect(isVerificationCodeShape(`${code}\n`)).toBe(false);
  });

  it("rejects non-hex characters of the right length", () => {
    expect(isVerificationCodeShape("g".repeat(32))).toBe(false);
    expect(isVerificationCodeShape("A".repeat(32))).toBe(false); // normalise first
  });

  it("rejects non-strings without throwing", () => {
    for (const bad of [null, undefined, 12, {}, []]) {
      expect(isVerificationCodeShape(bad)).toBe(false);
    }
  });
});

describe("normaliseVerificationCode", () => {
  it("lowercases and trims, because mail clients upper-case auto-linked URLs", () => {
    const code = generateVerificationCode();
    expect(normaliseVerificationCode(` ${code.toUpperCase()} \n`)).toBe(code);
  });

  it("does NOT repair a near-miss", () => {
    // Stripping separators or substituting look-alike characters would mean a typo
    // can resolve to somebody else's credential. A code either matches or it does
    // not.
    const spaced = "aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111";
    expect(isVerificationCodeShape(normaliseVerificationCode(spaced))).toBe(false);
  });
});

describe("verificationPath", () => {
  it("is origin-relative", () => {
    // An absolute URL baked in at render or seed time is the defect CHANGELOG.log
    // records at 2026-07-31 15:40: it broke on every origin except the one it was
    // written on.
    const code = generateVerificationCode();
    expect(verificationPath(code)).toBe(`/verify/${code}`);
    expect(verificationPath(code).startsWith("http")).toBe(false);
  });

  it("does not sit under the protected /certificates prefix", () => {
    // The public page is at /verify precisely so no ALWAYS_ALLOWED exemption has
    // to punch a hole in a protected prefix in src/middleware.ts. If this ever
    // changes, that exemption becomes mandatory and this test is the reminder.
    expect(verificationPath("x").startsWith("/certificates")).toBe(false);
  });
});
