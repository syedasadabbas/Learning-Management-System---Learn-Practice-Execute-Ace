// =============================================================================
// RESET-FLOW TESTS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The property under test is NO ACCOUNT ENUMERATION: a registered and an
// unregistered address must be indistinguishable from the caller's side. The test
// asserts that by running both paths and comparing the outcomes for deep equality,
// which is stronger than asserting each one's shape separately — if a field is ever
// added to one branch, this fails.
//
// Timing is asserted against an INJECTED clock and an injected sleep, so the test
// measures the padding logic rather than the machine it runs on. A test that
// actually slept 400 ms per case would be slow and flaky on shared CI.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
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

import { createRateLimiter, RESET_EMAIL_RULE } from "./rate-limit";
import {
  completePasswordReset,
  requestPasswordReset,
  RESET_LINK_UNUSABLE_MESSAGE,
  RESET_REQUEST_ACKNOWLEDGEMENT,
  RESET_RESPONSE_FLOOR_MS,
  type ResetRequestDeps,
} from "./reset";
import type { MailMessage } from "@/lib/mail";

const KNOWN = "student@codequeenshub.test";
const UNKNOWN = "nobody@codequeenshub.test";

interface Harness {
  deps: ResetRequestDeps;
  sent: MailMessage[];
  issuedFor: number[];
  /** Total ms the code asked to sleep. Stands in for wall-clock padding. */
  sleptMs: number[];
  /** Simulated elapsed work before the padding, in ms. */
  setWorkMs(ms: number): void;
}

function harness(options: { userExists: boolean; workMs?: number }): Harness {
  const sent: MailMessage[] = [];
  const issuedFor: number[] = [];
  const sleptMs: number[] = [];
  let workMs = options.workMs ?? 0;
  const startMs = 1_700_000_000_000;
  // `nowMs` returns start on the first call (the request's start) and start+work
  // afterwards, which is what padToFloor measures.
  let calls = 0;
  const limiter = createRateLimiter();

  return {
    sent,
    issuedFor,
    sleptMs,
    setWorkMs(ms) {
      workMs = ms;
    },
    deps: {
      findUserByEmail: async (email) =>
        options.userExists && email === KNOWN
          ? { id: 5, email: KNOWN, name: "Demo Student" }
          : null,
      issueToken: async (userId) => {
        issuedFor.push(userId);
        return { rawToken: "b".repeat(64), expiresAt: new Date(startMs + 1_800_000) };
      },
      sendMail: async (message) => {
        sent.push(message);
        return { ok: true, transport: "dev" as const };
      },
      origin: () => "https://lms.example",
      limiter: () => limiter,
      nowMs: () => {
        calls += 1;
        return calls === 1 ? startMs : startMs + workMs;
      },
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
      floorMs: RESET_RESPONSE_FLOOR_MS,
      // Deterministic: the jitter is a real defence but an untestable one.
      jitterMs: () => 0,
    },
  };
}

describe("requestPasswordReset — the no-enumeration property", () => {
  it("returns an IDENTICAL outcome for a known and an unknown email", async () => {
    const known = harness({ userExists: true });
    const unknown = harness({ userExists: false });

    const a = await requestPasswordReset(KNOWN, "203.0.113.5", known.deps);
    const b = await requestPasswordReset(UNKNOWN, "203.0.113.5", unknown.deps);

    // Deep equality, not shape checking: a field added to one branch fails here.
    expect(a).toEqual(b);
    expect(a).toEqual({ status: "accepted" });
  });

  it("carries no user-derived field in the accepted outcome", async () => {
    const known = harness({ userExists: true });
    const outcome = await requestPasswordReset(KNOWN, null, known.deps);
    expect(Object.keys(outcome)).toEqual(["status"]);
    expect(JSON.stringify(outcome)).not.toContain("student");
  });

  it("pads both paths to the same floor", async () => {
    const known = harness({ userExists: true, workMs: 30 });
    const unknown = harness({ userExists: false, workMs: 5 });

    await requestPasswordReset(KNOWN, null, known.deps);
    await requestPasswordReset(UNKNOWN, null, unknown.deps);

    // Each path sleeps floor - its own elapsed, so both END at the floor.
    expect(known.sleptMs).toEqual([RESET_RESPONSE_FLOOR_MS - 30]);
    expect(unknown.sleptMs).toEqual([RESET_RESPONSE_FLOOR_MS - 5]);
  });

  it("acknowledges even when the lookup throws", async () => {
    const h = harness({ userExists: true });
    const outcome = await requestPasswordReset(KNOWN, null, {
      ...h.deps,
      findUserByEmail: async () => {
        throw new Error("database unreachable");
      },
    });
    // A 500 for one address and a 200 for another is the same leak.
    expect(outcome).toEqual({ status: "accepted" });
  });

  it("acknowledges even when mail delivery fails", async () => {
    const h = harness({ userExists: true });
    const outcome = await requestPasswordReset(KNOWN, null, {
      ...h.deps,
      sendMail: async () => ({
        ok: false as const,
        transport: "smtp" as const,
        reason: "transport_unavailable" as const,
      }),
    });
    expect(outcome).toEqual({ status: "accepted" });
    // The token was still issued — the operator can recover the link from the log.
    expect(h.issuedFor).toEqual([5]);
  });

  it("normalises the email, so case differences still find the account", async () => {
    const h = harness({ userExists: true });
    await requestPasswordReset("  STUDENT@CodeQueensHub.TEST  ", null, h.deps);
    expect(h.issuedFor).toEqual([5]);
  });

  it("issues no token and sends no mail for an unknown address", async () => {
    const h = harness({ userExists: false });
    await requestPasswordReset(UNKNOWN, null, h.deps);
    expect(h.issuedFor).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("mails a link containing the raw token, to the stored address only", async () => {
    const h = harness({ userExists: true });
    await requestPasswordReset(KNOWN, null, h.deps);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe(KNOWN);
    expect(h.sent[0].text).toContain(
      `https://lms.example/reset-password?token=${"b".repeat(64)}`,
    );
    // States the window so a recipient knows the link is short-lived.
    expect(h.sent[0].text).toContain("30 minutes");
  });

  it("the acknowledgement text confirms nothing about existence", () => {
    expect(RESET_REQUEST_ACKNOWLEDGEMENT.toLowerCase()).toContain("if an account exists");
  });
});

describe("requestPasswordReset — rate limiting", () => {
  it("refuses past the per-email quota", async () => {
    const h = harness({ userExists: true });
    const results = [];
    for (let i = 0; i < RESET_EMAIL_RULE.limit + 1; i += 1) {
      results.push(await requestPasswordReset(KNOWN, null, h.deps));
    }
    expect(results.slice(0, RESET_EMAIL_RULE.limit).every((r) => r.status === "accepted")).toBe(
      true,
    );
    expect(results.at(-1)?.status).toBe("rate_limited");
  });

  it("applies the quota to an UNKNOWN address identically", async () => {
    // If the limiter were keyed on a found user, an unregistered address would be
    // unlimited — and the difference would itself be the enumeration oracle.
    const h = harness({ userExists: false });
    const results = [];
    for (let i = 0; i < RESET_EMAIL_RULE.limit + 1; i += 1) {
      results.push(await requestPasswordReset(UNKNOWN, null, h.deps));
    }
    expect(results.at(-1)?.status).toBe("rate_limited");
  });

  it("pads a refusal too", async () => {
    const h = harness({ userExists: true, workMs: 0 });
    for (let i = 0; i < RESET_EMAIL_RULE.limit + 1; i += 1) {
      await requestPasswordReset(KNOWN, null, h.deps);
    }
    expect(h.sleptMs).toHaveLength(RESET_EMAIL_RULE.limit + 1);
    expect(h.sleptMs.at(-1)).toBe(RESET_RESPONSE_FLOOR_MS);
  });

  it("issues no token once refused", async () => {
    const h = harness({ userExists: true });
    for (let i = 0; i < RESET_EMAIL_RULE.limit + 1; i += 1) {
      await requestPasswordReset(KNOWN, null, h.deps);
    }
    expect(h.issuedFor).toHaveLength(RESET_EMAIL_RULE.limit);
  });
});

describe("completePasswordReset", () => {
  const token = "c".repeat(64);

  it("hashes the new password before consuming, and never passes plaintext on", async () => {
    let seenHash = "";
    const outcome = await completePasswordReset(token, "N3wPassw0rd!", {
      consume: async (_raw, hash) => {
        seenHash = hash;
        return { ok: true as const, userId: 5, invalidatedSiblings: 1 };
      },
      hash: async () => "$2a$04$fakehashfakehashfakehashfakehashfakehashfake",
      nowMs: () => 1_700_000_000_000,
    });

    expect(outcome).toEqual({ ok: true, userId: 5 });
    expect(seenHash).not.toBe("N3wPassw0rd!");
    expect(seenHash.startsWith("$2")).toBe(true);
  });

  it.each(["malformed", "unknown", "expired", "used"] as const)(
    "propagates the %s refusal for the log while the page shows one message",
    async (reason) => {
      const outcome = await completePasswordReset(token, "N3wPassw0rd!", {
        consume: async () => ({ ok: false as const, reason }),
        hash: async () => "$2a$04$x",
        nowMs: () => 0,
      });
      expect(outcome).toEqual({ ok: false, reason });
    },
  );

  it("has a single user-facing message for every refusal cause", () => {
    expect(RESET_LINK_UNUSABLE_MESSAGE).not.toMatch(/expired|used|unknown|malformed/i);
  });
});
