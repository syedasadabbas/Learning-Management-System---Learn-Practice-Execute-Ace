// =============================================================================
// Tests for the audit trail's privacy boundary.
// -----------------------------------------------------------------------------
// These are the tests that matter most in this stream. Everything else here is
// "does the feature work"; these are "does the feature avoid becoming the leak".
// No database, no browser — the choke point is a pure function precisely so this
// suite can be exhaustive and fast.
// =============================================================================

import { describe, it, expect } from "vitest";

import {
  CLIENT_FAMILY_MAX_CHARS,
  DETAILS_MAX_BYTES,
  DETAILS_MAX_KEYS,
  DETAIL_STRING_MAX_CHARS,
  REDACTED_MARKER,
  clientFamily,
  coarsenIp,
  errorCode,
  isForbiddenDetailKey,
  sanitiseDetails,
} from "./redact";

describe("sanitiseDetails drops anything that looks like a secret", () => {
  // One case per credential shape that a well-meaning call site might write.
  it.each([
    "password",
    "Password",
    "pass_word",
    "passwordHash",
    "password_hash",
    "pwd",
    "passwd",
    "sessionToken",
    "session",
    "accessToken",
    "refresh_token",
    "resetToken",
    "jwt",
    "cookie",
    "Authorization",
    "authHeader",
    "apiKey",
    "api_key",
    "clientSecret",
    "bearer",
    "otp",
    "pin",
    "signature",
    "credentials",
  ])("drops %s", (key) => {
    expect(isForbiddenDetailKey(key)).toBe(true);
    const result = sanitiseDetails({ [key]: "hunter2", weekId: 3 });
    expect(result).not.toHaveProperty(key);
    // The safe sibling survives, so this is a targeted drop and not a wholesale
    // rejection that happens to look like one.
    expect(result?.weekId).toBe(3);
  });

  it("records HOW MANY keys it dropped rather than dropping them silently", () => {
    // An auditor must be able to tell "nothing else was supplied" apart from
    // "something else was supplied and this table refused to keep it".
    const result = sanitiseDetails({ password: "x", token: "y", quizId: 1 });
    expect(result?.[REDACTED_MARKER]).toBe(2);
  });
});

describe("sanitiseDetails drops identity and human-written content", () => {
  it.each([
    "email",
    "userEmail",
    "recipientEmail",
    "mail",
    "studentAddress",
    "phone",
    "answer",
    "answers",
    "selectedAnswer",
    "feedback",
    "comment",
    "commentText",
    "content",
    "body",
    "requestBody",
    "message",
    "note",
    "decisionNote",
    "bio",
    "ipAddress",
    "queryString",
    "url",
    "returnUrl",
  ])("drops %s", (key) => {
    expect(isForbiddenDetailKey(key)).toBe(true);
  });

  it("keeps the identifiers and outcomes an audit row is made of", () => {
    // The positive half of the contract: over-blocking would make the feature
    // useless, so the fields a real call site needs must survive intact.
    const result = sanitiseDetails({
      weekId: 3,
      quizId: 41,
      submissionId: 441,
      scorePercent: 80,
      attemptNumber: 2,
      passed: true,
      durationMs: 1_200,
      fromRole: "student",
      toRole: "instructor",
      cutoffDays: 90,
      deletedRows: 12_004,
    });
    expect(result).toEqual({
      weekId: 3,
      quizId: 41,
      submissionId: 441,
      scorePercent: 80,
      attemptNumber: 2,
      passed: true,
      durationMs: 1_200,
      fromRole: "student",
      toRole: "instructor",
      cutoffDays: 90,
      deletedRows: 12_004,
    });
    expect(result).not.toHaveProperty(REDACTED_MARKER);
  });
});

describe("sanitiseDetails cannot be handed a request body", () => {
  // This is the structural half of the defence: rule 2 in redact.ts. A body's
  // interesting contents are one level down, so refusing nested values means
  // spreading a body in yields nothing usable rather than a leak.
  it("drops nested objects", () => {
    const result = sanitiseDetails({ payload: { password: "hunter2" }, quizId: 1 });
    expect(result).toEqual({ quizId: 1, [REDACTED_MARKER]: 1 });
  });

  it("drops arrays", () => {
    const result = sanitiseDetails({ chosen: [1, 2, 3], quizId: 1 });
    expect(result).toEqual({ quizId: 1, [REDACTED_MARKER]: 1 });
  });

  it("drops functions and symbols", () => {
    const result = sanitiseDetails({ fn: () => 1, sym: Symbol("s"), quizId: 1 });
    expect(result).toEqual({ quizId: 1, [REDACTED_MARKER]: 2 });
  });

  it("drops undefined without turning it into a recorded null", () => {
    const result = sanitiseDetails({ maybe: undefined, quizId: 1 });
    expect(result).toEqual({ quizId: 1, [REDACTED_MARKER]: 1 });
  });

  it("keeps an explicit null, which is a deliberately recorded absence", () => {
    expect(sanitiseDetails({ graderId: null })).toEqual({ graderId: null });
  });

  it("drops NaN and Infinity rather than storing JSON null for them", () => {
    const result = sanitiseDetails({ a: NaN, b: Infinity, ok: 1 });
    expect(result).toEqual({ ok: 1, [REDACTED_MARKER]: 2 });
  });
});

describe("sanitiseDetails is bounded", () => {
  it("truncates a long string", () => {
    const long = "a".repeat(DETAIL_STRING_MAX_CHARS + 50);
    const value = sanitiseDetails({ slug: long })?.slug as string;
    expect(value).toHaveLength(DETAIL_STRING_MAX_CHARS + 1); // + the ellipsis
    expect(value.endsWith("…")).toBe(true);
  });

  it(`keeps at most ${DETAILS_MAX_KEYS} keys`, () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < DETAILS_MAX_KEYS + 5; i += 1) input[`k${i}`] = i;
    const result = sanitiseDetails(input)!;
    // DETAILS_MAX_KEYS real keys plus the redaction marker.
    expect(Object.keys(result)).toHaveLength(DETAILS_MAX_KEYS + 1);
    expect(result[REDACTED_MARKER]).toBe(5);
  });

  it("caps the encoded size", () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < DETAILS_MAX_KEYS; i += 1) input[`k${i}`] = "x".repeat(200);
    const result = sanitiseDetails(input)!;
    const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
    expect(bytes).toBeLessThanOrEqual(DETAILS_MAX_BYTES);
    expect(result[REDACTED_MARKER]).toBeGreaterThan(0);
  });

  it("returns null rather than an empty object", () => {
    expect(sanitiseDetails({})).toBeNull();
    expect(sanitiseDetails(null)).toBeNull();
    expect(sanitiseDetails(undefined)).toBeNull();
  });
});

describe("coarsenIp never stores a full address", () => {
  it.each([
    ["203.0.113.42", "203.0.113.0/24"],
    ["10.1.2.3", "10.1.2.0/24"],
    ["203.0.113.42:51314", "203.0.113.0/24"],
    // x-forwarded-for chain: left-most entry is the closest to the client.
    ["203.0.113.42, 70.41.3.18, 150.172.238.178", "203.0.113.0/24"],
  ])("%s -> %s", (raw, expected) => {
    expect(coarsenIp(raw)).toBe(expected);
  });

  it.each([
    ["2001:db8:1234:5678::1", "2001:db8:1234::/48"],
    ["[2001:db8:1234:5678::1]:443", "2001:db8:1234::/48"],
    ["2001:db8::1", "2001:db8:0::/48"],
    ["::1", "0:0:0::/48"],
  ])("%s -> %s", (raw, expected) => {
    expect(coarsenIp(raw)).toBe(expected);
  });

  it("returns null for anything unparseable instead of a placeholder string", () => {
    // A stored "unknown" is a value that sorts and groups and looks like a network.
    for (const junk of ["", "   ", "unknown", "not-an-ip", "999.1.1.1", "1.2.3", null, undefined]) {
      expect(coarsenIp(junk)).toBeNull();
    }
  });

  it("the last octet is always zeroed, for every possible value", () => {
    // The property, not an example: whatever the host part was, it is gone.
    for (const host of [0, 1, 42, 128, 254, 255]) {
      expect(coarsenIp(`198.51.100.${host}`)).toBe("198.51.100.0/24");
    }
  });
});

describe("clientFamily stores a family, never a fingerprint", () => {
  const CHROME_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const SAFARI_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const EDGE_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

  it.each([
    [CHROME_WIN, "Chrome on Windows"],
    [SAFARI_IOS, "Safari on iOS"],
    [EDGE_WIN, "Edge on Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0", "Firefox on Linux"],
    ["curl/8.4.0", "CLI client"],
  ])("recognises a family", (ua, expected) => {
    expect(clientFamily(ua)).toBe(expected);
  });

  it("records no version number for any known agent", () => {
    // The property that keeps this column from being a fingerprint.
    for (const ua of [CHROME_WIN, SAFARI_IOS, EDGE_WIN]) {
      const family = clientFamily(ua)!;
      expect(family).not.toMatch(/\d/);
      expect(family.length).toBeLessThanOrEqual(CLIENT_FAMILY_MAX_CHARS);
    }
  });

  it("flags automation, which is the most useful thing this column can say", () => {
    expect(clientFamily("HeadlessChrome/131.0.0.0")).toBe("Automation");
  });

  it("keeps no fragment of an unrecognised header", () => {
    // An arbitrary prefix of an attacker-controlled string is both a fingerprint
    // and the kind of value that later ends up rendered somewhere.
    const hostile = "<script>alert(1)</script> and-a-very-distinctive-build-id-8f3a2b";
    expect(clientFamily(hostile)).toBe("Unrecognised client");
  });

  it("returns null for a missing header rather than a placeholder family", () => {
    expect(clientFamily(null)).toBeNull();
    expect(clientFamily("")).toBeNull();
  });
});

describe("errorCode is a code, not a message", () => {
  it("normalises to a short slug", () => {
    expect(errorCode("Invalid Credentials")).toBe("invalid_credentials");
    expect(errorCode("forbidden")).toBe("forbidden");
  });

  it("bounds a message that a caller passed by mistake", () => {
    const message = `connection to user@host failed: ${"x".repeat(500)}`;
    const code = errorCode(message)!;
    expect(code.length).toBeLessThanOrEqual(64);
  });

  it("returns null for nothing", () => {
    expect(errorCode(null)).toBeNull();
    expect(errorCode("")).toBeNull();
    expect(errorCode("   ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("the filterQuery exemption", () => {
  // This key is the audit trail's own evidence and the denylist was eating it:
  // `filterQuery` tokenises to ["filter", "query"], "query" is a forbidden token,
  // so the export row recorded `{_redacted: 1, ...}` and never said WHAT was
  // exported. Full argument at ALLOWED_DETAIL_KEYS in redact.ts.
  it("KEEPS filterQuery, in both spellings", () => {
    expect(isForbiddenDetailKey("filterQuery")).toBe(false);
    expect(isForbiddenDetailKey("filter_query")).toBe(false);

    const result = sanitiseDetails({
      filterQuery: "action=activity_export&status=success",
      exportedRows: 3,
    });
    expect(result?.filterQuery).toBe("action=activity_export&status=success");
    // And no phantom redaction count, which is what made the loss invisible.
    expect(result).not.toHaveProperty("_redacted");
  });

  it("does NOT widen the hole to other query-ish keys", () => {
    // The exemption is one exact key, not a relaxation of the "query" token. If
    // someone later reaches for `requestQuery` to log a raw URL, it must still go.
    for (const key of ["query", "rawQuery", "requestQuery", "searchQuery", "sqlQuery"]) {
      expect(isForbiddenDetailKey(key), `${key} must still be dropped`).toBe(true);
    }
  });

  it("still drops the genuinely unsafe keys beside it", () => {
    const result = sanitiseDetails({
      filterQuery: "status=failure",
      password: "hunter2",
      email: "someone@example.test",
    });
    expect(result?.filterQuery).toBe("status=failure");
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("email");
    expect(result?._redacted).toBe(2);
  });
});
