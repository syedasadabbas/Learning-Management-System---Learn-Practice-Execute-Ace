// =============================================================================
// DISPATCH — the parts that are decidable without a database.
// -----------------------------------------------------------------------------
// The ledger's BRANCHES (own the key / already sent / definitely failed /
// indeterminate) are not tested here, on purpose. Every one of them is a
// statement of what `INSERT ... ON CONFLICT DO NOTHING` and a unique index do
// under concurrency, and a fake client asked to model that would only ever
// confirm the model — which is exactly the criticism the first version of this
// stream earned. They are asserted against a REAL Postgres in
// src/lib/queue/store.integration.test.ts, including the case a fake cannot
// produce at all: two workers racing for the same dedupe key.
//
// What IS decidable here is the derived Message-ID, and it carries two
// properties worth pinning: it must be identical for the same key across
// processes (or it de-duplicates nothing), and it must not carry the key's
// contents into a header that travels to the recipient.
// =============================================================================

import { describe, expect, it } from "vitest";

// `@/db` is imported by the module under test and must never be evaluated in a
// unit test — the real module opens a connection pool. Mocked with a factory, the
// same way the queue's handler test does it.
import { vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));

import { DISPATCH_ERROR_CHARS, INDETERMINATE_RESEND_LIMIT, dispatchMessageId } from "./dispatch";

const ENV = { NEXTAUTH_URL: "https://lms.example.test" };

describe("dispatchMessageId", () => {
  it("is stable for the same key, which is the only property that makes it useful", () => {
    // Two serverless invocations that both send for one key must produce the SAME
    // header, or no receiving client can suppress the copy. Derived from the key
    // by a hash rather than generated, precisely so it survives a process boundary.
    const a = dispatchMessageId("submission_graded_email:8:1785484244341", ENV);
    const b = dispatchMessageId("submission_graded_email:8:1785484244341", ENV);
    expect(a).toBe(b);
  });

  it("differs for different keys", () => {
    expect(dispatchMessageId("a", ENV)).not.toBe(dispatchMessageId("b", ENV));
  });

  it("does NOT leak the key into a header the recipient can read", () => {
    // The key contains internal identifiers — a submission id and the exact
    // millisecond a grade was written. A Message-ID travels to the student and
    // through every relay in between, so the key is hashed rather than embedded.
    const key = "submission_graded_email:8:1785484244341";
    const id = dispatchMessageId(key, ENV);
    expect(id).not.toContain("8:1785484244341");
    expect(id).not.toContain("submission_graded_email");
  });

  it("is a syntactically valid RFC 5322 msg-id: angle-bracketed, one @, no spaces", () => {
    const id = dispatchMessageId("anything at all, with spaces and <brackets>", ENV);
    expect(id.startsWith("<")).toBe(true);
    expect(id.endsWith(">")).toBe(true);
    expect(id.split("@")).toHaveLength(2);
    // A space or a stray bracket inside would make the header illegal, and an
    // illegal header is a rejected message — which would turn a de-duplication
    // aid into an outage. The hash is what guarantees this for ANY future key.
    expect(id.slice(1, -1)).toMatch(/^[A-Za-z0-9.\-_]+@[A-Za-z0-9.\-_]+$/);
  });

  it("takes its domain from configuration, never from a key or a request", () => {
    expect(dispatchMessageId("k", { NEXTAUTH_URL: "https://real.example.org" })).toContain(
      "@real.example.org>",
    );
  });

  it("still produces a legal id when the origin is unset or unparseable", () => {
    // A misconfigured NEXTAUTH_URL must not stop mail going out. `appOrigin`
    // itself falls back to http://localhost:3000, and a bare hostname is a legal
    // (if unroutable) msg-id domain.
    const id = dispatchMessageId("k", {});
    expect(id).toMatch(/^<lms-[0-9a-f]{32}@[^@>]+>$/);
  });
});

describe("the residual-risk policy is a named constant, not a magic number", () => {
  it("allows exactly one resend after an indeterminate outcome", () => {
    // Read src/lib/mail/dispatch.ts's comment on this constant before changing it:
    // 1 would trade a possible duplicate for a possible LOST notification, and
    // anything above 2 is how one flapping relay becomes five copies of one email.
    expect(INDETERMINATE_RESEND_LIMIT).toBe(2);
  });

  it("bounds what it stores of an error", () => {
    expect(DISPATCH_ERROR_CHARS).toBeGreaterThan(0);
    expect(DISPATCH_ERROR_CHARS).toBeLessThanOrEqual(1_000);
  });
});
