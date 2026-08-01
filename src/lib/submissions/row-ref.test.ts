// =============================================================================
// Unit tests — sheet row ref derivation and the NULL-ref trap.
// Owner: submissions stream. No database, no network.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  ROW_REF_MAX_LENGTH,
  ROW_REF_VERSION,
  assertUsableRowRef,
  deriveRowRef,
  normaliseEmail,
} from "./row-ref";

const AT = new Date("2026-09-08T14:03:21.000Z");

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Ada@Example.TEST \n")).toBe("ada@example.test");
  });

  it("returns an empty string for null/undefined rather than throwing", () => {
    expect(normaliseEmail(null)).toBe("");
    expect(normaliseEmail(undefined)).toBe("");
  });

  it("does NOT strip dots or +tags — those are distinct users.email values", () => {
    expect(normaliseEmail("a.b+week1@example.test")).toBe("a.b+week1@example.test");
  });
});

describe("deriveRowRef — stability", () => {
  it("is deterministic for the same email and timestamp", () => {
    const a = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    const b = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it("is case-insensitive on the email, so one student cannot get two refs", () => {
    const lower = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    const mixed = deriveRowRef({ email: " Ada@Example.TEST ", submittedAt: AT });
    expect(lower).toEqual(mixed);
  });

  it("ignores sub-second precision, because the CSV only renders whole seconds", () => {
    const exact = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    const jittered = deriveRowRef({
      email: "ada@example.test",
      submittedAt: new Date(AT.getTime() + 999),
    });
    expect(jittered).toEqual(exact);
  });

  it("differs for a different student at the same instant", () => {
    const ada = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    const grace = deriveRowRef({ email: "grace@example.test", submittedAt: AT });
    expect(ada).not.toEqual(grace);
  });

  it("differs for the same student resubmitting later — a resubmission is a new row", () => {
    const first = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    const second = deriveRowRef({
      email: "ada@example.test",
      submittedAt: new Date(AT.getTime() + 60_000),
    });
    expect(first).not.toEqual(second);
  });

  it("does not depend on the row's position in the sheet", () => {
    // There is no row-index argument at all. This test exists to fail loudly if
    // someone adds one: a sorted or filtered published sheet renumbers every row,
    // and a position-derived ref would re-insert the whole sheet on the next run.
    expect(deriveRowRef.length).toBe(1);
  });

  it("produces a versioned ref that fits the varchar(120) column", () => {
    const result = deriveRowRef({ email: "ada@example.test", submittedAt: AT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowRef.startsWith(`${ROW_REF_VERSION}:`)).toBe(true);
    expect(result.rowRef.length).toBeLessThanOrEqual(ROW_REF_MAX_LENGTH);
    expect(result.rowRef).toMatch(/^v1:[0-9a-f]{32}$/);
  });
});

describe("deriveRowRef — the NULL row ref case", () => {
  // WHY THIS MATTERS: submissions_row_ref_idx is a UNIQUE index on
  // (assignment_id, sheet_row_ref), and Postgres does not constrain NULLs. Two
  // rows with sheet_row_ref = NULL both insert successfully, and would keep
  // inserting on every hourly run. So a row that cannot produce a ref must be
  // refused, never defaulted.
  it("fails rather than inventing a ref when the email is missing", () => {
    expect(deriveRowRef({ email: "", submittedAt: AT })).toEqual({
      ok: false,
      reason: "missing_email",
    });
    expect(deriveRowRef({ email: null, submittedAt: AT })).toEqual({
      ok: false,
      reason: "missing_email",
    });
  });

  it("fails on an Invalid Date instead of hashing NaN", () => {
    expect(deriveRowRef({ email: "ada@example.test", submittedAt: new Date("nope") })).toEqual({
      ok: false,
      reason: "no_row_ref",
    });
  });
});

describe("assertUsableRowRef — the last line of defence before INSERT", () => {
  it("throws on null, undefined, and blank", () => {
    expect(() => assertUsableRowRef(null)).toThrow(/does not constrain NULLs/);
    expect(() => assertUsableRowRef(undefined)).toThrow(/does not constrain NULLs/);
    expect(() => assertUsableRowRef("   ")).toThrow(/does not constrain NULLs/);
  });

  it("throws rather than letting Postgres truncate an over-long ref", () => {
    expect(() => assertUsableRowRef("x".repeat(ROW_REF_MAX_LENGTH + 1))).toThrow(/characters/);
  });

  it("returns a usable ref unchanged", () => {
    const ref = `${ROW_REF_VERSION}:${"a".repeat(32)}`;
    expect(assertUsableRowRef(ref)).toBe(ref);
  });
});
