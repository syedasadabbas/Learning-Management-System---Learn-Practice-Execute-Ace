// =============================================================================
// PRIVACY TESTS — the leak canary, at the boundary the pages actually use.
// -----------------------------------------------------------------------------
// This is the unit-level half of the guarantee. The e2e half lives in
// tests/e2e/analytics/analytics.spec.ts and checks RENDERED TEXT, for the reason
// tests/e2e/leaderboard/leaderboard.spec.ts documents at length: in `next dev`
// React's flight server serialises awaited values into the RSC payload as debug
// info, so `page.content()` contains the VIEWER'S OWN address on any page whose
// layout awaits requireUser() — a fact, not a leak. Only innerText separates the
// two. Here there is no RSC stream at all, so the assertion can be absolute.
// =============================================================================

import { describe, expect, it } from "vitest";

import { containsEmailAddress, redactEmail, redactEmails } from "./privacy";

describe("redactEmail", () => {
  it("removes the address and keeps every other field", () => {
    const row = {
      studentId: 7,
      name: "Ayesha Khan",
      email: "ayesha@codequeenshub.test",
      penaltyCount: 4,
      penaltyPoints: 12,
    };
    const out = redactEmail(row);
    expect(out.email).toBe("");
    expect(out.name).toBe("Ayesha Khan");
    expect(out.studentId).toBe(7);
    expect(out.penaltyCount).toBe(4);
    expect(out.penaltyPoints).toBe(12);
  });

  it("does not mutate the input", () => {
    const row = { email: "a@b.test", name: "A" };
    redactEmail(row);
    expect(row.email).toBe("a@b.test");
  });

  it("leaves no address anywhere in the redacted payload", () => {
    const rows = [
      { studentId: 1, name: "A", email: "a@codequeenshub.test" },
      { studentId: 2, name: "B", email: "b@example.org" },
    ];
    expect(containsEmailAddress(rows)).toBe(true);
    expect(containsEmailAddress(redactEmails(rows))).toBe(false);
  });
});

describe("containsEmailAddress", () => {
  it("detects an address nested anywhere in a structure", () => {
    expect(containsEmailAddress({ a: [{ b: { c: "x@y.test" } }] })).toBe(true);
  });

  it("does not fire on a bare @ or on a name", () => {
    expect(containsEmailAddress({ handle: "@ayesha", name: "Ayesha Khan" })).toBe(false);
  });

  it("survives a value JSON cannot serialise", () => {
    // A cyclic object throws in JSON.stringify. The canary must not take the page
    // down; it reports "no address found" for something it could not read, and the
    // e2e rendered-text assertion is the backstop for that blind spot.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(containsEmailAddress(cyclic)).toBe(false);
  });
});
