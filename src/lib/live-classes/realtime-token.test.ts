import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  mintRealtimeToken,
  realtimeSecretFromEnv,
  REALTIME_TOKEN_MAX_CHARS,
  REALTIME_TOKEN_TTL_MS,
  roleFromDb,
  verifyRealtimeToken,
} from "./realtime-token";

const SECRET = "test-secret-at-least-32-characters-long!";
const OTHER_SECRET = "a-different-secret-of-similar-length!!!!";
const NOW = 1_770_000_000_000;

function validToken(overrides: Partial<Parameters<typeof mintRealtimeToken>[0]> = {}): string {
  return mintRealtimeToken({
    userId: 42,
    role: "student",
    classId: 7,
    secret: SECRET,
    now: NOW,
    nonce: "fixed-nonce",
    ...overrides,
  });
}

describe("mintRealtimeToken / verifyRealtimeToken round trip", () => {
  it("returns the exact claims that were minted", () => {
    const result = verifyRealtimeToken(validToken(), SECRET, NOW);

    expect(result).toEqual({
      ok: true,
      claims: {
        userId: 42,
        role: "student",
        classId: 7,
        expiresAtMs: NOW + REALTIME_TOKEN_TTL_MS,
        nonce: "fixed-nonce",
      },
    });
  });

  it("produces two distinct tokens for identical input, because the nonce is random", () => {
    const a = mintRealtimeToken({ userId: 1, role: "student", classId: 1, secret: SECRET, now: NOW });
    const b = mintRealtimeToken({ userId: 1, role: "student", classId: 1, secret: SECRET, now: NOW });
    expect(a).not.toEqual(b);
  });

  it("refuses to mint against an empty secret rather than signing with one", () => {
    // The whole security model is one shared secret. An HMAC keyed on "" is
    // forgeable by anybody reading the source, so this must be loud.
    expect(() =>
      mintRealtimeToken({ userId: 1, role: "student", classId: 1, secret: "   " }),
    ).toThrow(/REALTIME_SHARED_SECRET/);
  });
});

describe("tampering", () => {
  it("rejects a token whose role claim was rewritten to instructor", () => {
    // The attack the token exists to stop: a student promoting themselves so
    // the service accepts qa:answer and chat:pin from their socket.
    const token = validToken();
    const [encoded, signature] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(encoded as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.r = "instructor";
    const forged = `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`;

    expect(verifyRealtimeToken(forged, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a token whose signature was altered", () => {
    const token = validToken();
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyRealtimeToken(flipped, SECRET, NOW).ok).toBe(false);
  });

  it("rejects a correctly-signed token presented to a service holding another secret", () => {
    // This is the misconfiguration case as much as the attack case: the two
    // deployments drifting apart must fail closed, not half-work.
    expect(verifyRealtimeToken(validToken(), OTHER_SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a well-signed payload that is not the claim shape", () => {
    // Only reachable by whoever holds the secret, i.e. by our own bug — a
    // userId that arrived as a string is the realistic version of it.
    const encoded = Buffer.from(
      JSON.stringify({ u: "42", r: "student", c: 7, e: NOW + 1, n: "x" }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
    expect(verifyRealtimeToken(`${encoded}.${sig}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "invalid_claims",
    });
  });
});

describe("expiry", () => {
  it("accepts one millisecond before expiry", () => {
    expect(verifyRealtimeToken(validToken(), SECRET, NOW + REALTIME_TOKEN_TTL_MS - 1).ok).toBe(true);
  });

  it("rejects exactly at expiry, so the boundary is closed", () => {
    expect(verifyRealtimeToken(validToken(), SECRET, NOW + REALTIME_TOKEN_TTL_MS)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects long after expiry", () => {
    expect(verifyRealtimeToken(validToken(), SECRET, NOW + 3_600_000).ok).toBe(false);
  });
});

describe("malformed input", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 12345],
    ["an object", { token: "x" }],
    ["the empty string", ""],
    ["no separator", "abcdef"],
    ["a leading separator", ".abcdef"],
    ["a trailing separator", "abcdef."],
    ["two separators (a JWT)", "aaa.bbb.ccc"],
  ])("rejects %s as malformed", (_label, value) => {
    expect(verifyRealtimeToken(value, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an oversized token before attempting to verify it", () => {
    const huge = `${"a".repeat(REALTIME_TOKEN_MAX_CHARS)}.${"b".repeat(64)}`;
    expect(verifyRealtimeToken(huge, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects every token when the verifier has no secret", () => {
    expect(verifyRealtimeToken(validToken(), "", NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("roleFromDb", () => {
  it("passes through the three known roles", () => {
    expect(roleFromDb("student")).toBe("student");
    expect(roleFromDb("instructor")).toBe("instructor");
    expect(roleFromDb("admin")).toBe("admin");
  });

  it("returns null for an unknown role rather than defaulting to student", () => {
    // Defaulting would silently admit a role nobody wrote authorization rules for.
    expect(roleFromDb("ta")).toBeNull();
    expect(roleFromDb("")).toBeNull();
  });
});

describe("realtimeSecretFromEnv", () => {
  it("returns null when unset or blank, because that is a supported state", () => {
    expect(realtimeSecretFromEnv({})).toBeNull();
    expect(realtimeSecretFromEnv({ REALTIME_SHARED_SECRET: "   " })).toBeNull();
  });

  it("trims, because dashboard inputs collect whitespace", () => {
    expect(realtimeSecretFromEnv({ REALTIME_SHARED_SECRET: " s3cret " })).toBe("s3cret");
  });
});
