// =============================================================================
// TOKEN PRIMITIVE TESTS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The security properties that must not silently regress: only a hash is ever
// storable, the hash fits the frozen varchar(64), tokens are unguessable, and the
// 30-minute expiry boundary is exclusive. All pure — no database, no clock.
// =============================================================================

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  generateResetToken,
  hashesEqual,
  hashToken,
  looksLikeResetToken,
  PASSWORD_RESET_TTL_MS,
  RESET_TOKEN_HEX_LENGTH,
  resetTokenExpiresAt,
  resetUrl,
  tokenState,
} from "./tokens";

describe("generateResetToken", () => {
  it("produces 64 hex characters (32 bytes of entropy)", () => {
    const token = generateResetToken();
    expect(token).toHaveLength(RESET_TOKEN_HEX_LENGTH);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats across a large sample", () => {
    // 500 draws from a 256-bit space. A collision here means the generator is not
    // a CSPRNG, which would make every reset link guessable.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateResetToken());
    expect(seen.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("is sha256 of the raw token, hex encoded", () => {
    const raw = "a".repeat(64);
    expect(hashToken(raw)).toBe(createHash("sha256").update(raw, "utf8").digest("hex"));
  });

  it("fits the frozen varchar(64) column", () => {
    expect(hashToken(generateResetToken())).toHaveLength(64);
  });

  it("is deterministic, so a lookup by hash works", () => {
    const raw = generateResetToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("does not contain the raw token", () => {
    // The stored value must not be reversible by inspection — the whole reason a
    // stolen backup yields no usable links.
    const raw = generateResetToken();
    expect(hashToken(raw)).not.toContain(raw);
    expect(hashToken(raw)).not.toBe(raw);
  });
});

describe("looksLikeResetToken", () => {
  it("accepts a generated token", () => {
    expect(looksLikeResetToken(generateResetToken())).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["too short", "abc123"],
    ["too long", "a".repeat(65)],
    ["uppercase hex", "A".repeat(64)],
    ["non-hex", "z".repeat(64)],
    ["sql-ish", "' OR 1=1 --".padEnd(64, "0")],
  ])("rejects %s", (_label, value) => {
    expect(looksLikeResetToken(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [[]]])("rejects non-string %s", (value) => {
    expect(looksLikeResetToken(value)).toBe(false);
  });
});

describe("expiry", () => {
  it("is 30 minutes expressed in milliseconds", () => {
    expect(PASSWORD_RESET_TTL_MS).toBe(1_800_000);
  });

  it("resetTokenExpiresAt adds exactly the TTL", () => {
    const issuedAtMs = 1_700_000_000_000;
    expect(resetTokenExpiresAt(issuedAtMs).getTime()).toBe(
      issuedAtMs + PASSWORD_RESET_TTL_MS,
    );
  });
});

describe("tokenState — the boundary that decides whether a link works", () => {
  const issuedAtMs = 1_700_000_000_000;
  const expiresAt = resetTokenExpiresAt(issuedAtMs);

  it("is usable one millisecond before expiry", () => {
    expect(tokenState({ expiresAt, usedAt: null }, expiresAt.getTime() - 1)).toBe("usable");
  });

  it("is expired AT the boundary instant, not one millisecond later", () => {
    // Exclusive on purpose: a strict `<` would leave a 1 ms window whose outcome
    // depends on clock resolution.
    expect(tokenState({ expiresAt, usedAt: null }, expiresAt.getTime())).toBe("expired");
  });

  it("is expired after the boundary", () => {
    expect(tokenState({ expiresAt, usedAt: null }, expiresAt.getTime() + 1)).toBe("expired");
  });

  it("reports 'used' for a redeemed token even while still inside the window", () => {
    expect(
      tokenState({ expiresAt, usedAt: new Date(issuedAtMs + 1_000) }, issuedAtMs + 2_000),
    ).toBe("used");
  });

  it("reports 'used' in preference to 'expired' for a spent, aged token", () => {
    expect(
      tokenState(
        { expiresAt, usedAt: new Date(issuedAtMs + 1_000) },
        expiresAt.getTime() + 60_000,
      ),
    ).toBe("used");
  });
});

describe("hashesEqual", () => {
  it("matches identical hashes", () => {
    const h = hashToken("x".repeat(64));
    expect(hashesEqual(h, h)).toBe(true);
  });

  it("rejects different hashes without throwing on a length mismatch", () => {
    expect(hashesEqual(hashToken("a"), hashToken("b"))).toBe(false);
    expect(hashesEqual("short", hashToken("a"))).toBe(false);
  });
});

describe("resetUrl", () => {
  it("builds an absolute link carrying the raw token", () => {
    const token = generateResetToken();
    expect(resetUrl("https://lms.example", token)).toBe(
      `https://lms.example/reset-password?token=${token}`,
    );
  });

  it("percent-encodes anything unexpected in the token position", () => {
    expect(resetUrl("https://lms.example", "a b&c")).toBe(
      "https://lms.example/reset-password?token=a%20b%26c",
    );
  });
});
