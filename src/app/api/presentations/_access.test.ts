// =============================================================================
// Unit tests for the presentation visibility rules.
// -----------------------------------------------------------------------------
// THE CROSS-TENANT CASE IS THE ONE THAT MATTERS: student A must not reach
// student B's unpublished deck, and student B's speaker notes must not reach
// anyone who is not B or staff. Both are asserted below.
//
// `readableFilter` and `writableFilter` return Drizzle SQL predicates, and these
// tests assert on the BRANCH they take (a predicate vs `undefined`) rather than
// on the predicate's internals — asserting on Drizzle's AST would be testing the
// ORM. The branch is the whole decision: `undefined` means "no restriction", so
// a rule that wrongly returned it would be the leak, and that is exactly what is
// checked.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { AuthUser } from "@/lib/guard";

import {
  isStaff,
  mayReadSpeakerNotes,
  readableFilter,
  slideColumnsFor,
  slideProjectionRow,
  stripSpeakerNotes,
  writableFilter,
} from "./_access";

const STUDENT_A: AuthUser = { id: 1, email: "a@x.io", name: "A", role: "student", cohortId: 1 };
const STUDENT_B: AuthUser = { id: 2, email: "b@x.io", name: "B", role: "student", cohortId: 1 };
const INSTRUCTOR: AuthUser = {
  id: 9,
  email: "i@x.io",
  name: "I",
  role: "instructor",
  cohortId: null,
};
const ADMIN: AuthUser = { id: 10, email: "ad@x.io", name: "Ad", role: "admin", cohortId: null };

describe("isStaff", () => {
  it("instructors and admins are staff; students are not", () => {
    expect(isStaff(STUDENT_A)).toBe(false);
    expect(isStaff(INSTRUCTOR)).toBe(true);
    expect(isStaff(ADMIN)).toBe(true);
  });
});

describe("readableFilter — who is restricted on reads", () => {
  it("a student IS restricted — the predicate is present", () => {
    // If this ever returned undefined, every student could list every other
    // student's unpublished coursework. That is the leak this asserts against.
    expect(readableFilter(STUDENT_A)).toBeDefined();
  });

  it("staff are NOT restricted — they may read work in progress to help with it", () => {
    expect(readableFilter(INSTRUCTOR)).toBeUndefined();
    expect(readableFilter(ADMIN)).toBeUndefined();
  });
});

describe("writableFilter — who may modify a deck", () => {
  it("a student is scoped to their own decks", () => {
    expect(writableFilter(STUDENT_A)).toBeDefined();
  });

  it("an INSTRUCTOR is also scoped — staff may read a student's deck but not rewrite it", () => {
    // The asymmetry with readableFilter is the point. An instructor editing
    // submitted work and leaving it under the student's name is
    // indistinguishable from the student having written it.
    expect(writableFilter(INSTRUCTOR)).toBeDefined();
  });

  it("an admin is not scoped", () => {
    expect(writableFilter(ADMIN)).toBeUndefined();
  });
});

describe("mayReadSpeakerNotes", () => {
  it("the creator may", () => {
    expect(mayReadSpeakerNotes(STUDENT_A, STUDENT_A.id)).toBe(true);
  });

  it("ANOTHER STUDENT MAY NOT — the audience does not get the presenter's script", () => {
    expect(mayReadSpeakerNotes(STUDENT_B, STUDENT_A.id)).toBe(false);
  });

  it("staff may, because they are marking the delivery", () => {
    expect(mayReadSpeakerNotes(INSTRUCTOR, STUDENT_A.id)).toBe(true);
    expect(mayReadSpeakerNotes(ADMIN, STUDENT_A.id)).toBe(true);
  });
});

describe("slideColumnsFor — the projection barrier", () => {
  it("the audience projection does not NAME speaker_notes", () => {
    // Not "returns them as null" — the column must be absent from the SELECT, so
    // the text never leaves Postgres.
    expect("speakerNotes" in slideColumnsFor(false)).toBe(false);
  });

  it("the presenter projection does", () => {
    expect("speakerNotes" in slideColumnsFor(true)).toBe(true);
  });

  it("the two projections agree on everything else", () => {
    const audience = Object.keys(slideColumnsFor(false)).sort();
    const presenter = Object.keys(slideColumnsFor(true))
      .filter((k) => k !== "speakerNotes")
      .sort();
    expect(presenter).toEqual(audience);
  });
});

describe("stripSpeakerNotes — the document, which a projection cannot reach into", () => {
  it("removes the field from every slide", () => {
    const doc = {
      metadata: { theme: "lms" },
      slides: [
        { id: "a", slideNumber: 1, type: "title", title: "T", speakerNotes: "secret" },
        { id: "b", slideNumber: 2, type: "content", body: "x" },
      ],
    };
    const stripped = stripSpeakerNotes(doc) as { slides: Array<Record<string, unknown>> };
    expect("speakerNotes" in stripped.slides[0]).toBe(false);
    expect(stripped.slides[0].title).toBe("T");
    expect(stripped.slides[1].body).toBe("x");
  });

  it("leaves the metadata untouched", () => {
    const doc = { metadata: { theme: "lms", width: 1280 }, slides: [] };
    expect(stripSpeakerNotes(doc)).toEqual(doc);
  });

  it("returns a malformed document unchanged rather than emptying it", () => {
    // jsonb accepts anything. A deck whose document is wrong should render as
    // "cannot be opened" downstream, not be silently blanked here.
    expect(stripSpeakerNotes(null)).toBeNull();
    expect(stripSpeakerNotes("not a deck")).toBe("not a deck");
    expect(stripSpeakerNotes({ slides: "not an array" })).toEqual({ slides: "not an array" });
  });

  it("passes through non-object entries in the slides array", () => {
    const doc = { slides: [null, 3, { id: "a", speakerNotes: "s" }] };
    const stripped = stripSpeakerNotes(doc) as { slides: unknown[] };
    expect(stripped.slides[0]).toBeNull();
    expect(stripped.slides[1]).toBe(3);
    expect("speakerNotes" in (stripped.slides[2] as object)).toBe(false);
  });
});

describe("slideProjectionRow", () => {
  it("carries the whole validated slide into content_json", () => {
    // So a new slide type in the canonical contract needs no change here.
    const slide = {
      id: "s1",
      slideNumber: 3,
      type: "code" as const,
      language: "javascript",
      code: "const x = 1;",
    };
    const row = slideProjectionRow(42, slide);
    expect(row.presentationId).toBe(42);
    expect(row.slideNumber).toBe(3);
    expect(row.type).toBe("code");
    expect(row.contentJson).toEqual(slide);
  });

  it("nulls the queryable columns a slide variant does not have", () => {
    const row = slideProjectionRow(1, {
      id: "s1",
      slideNumber: 1,
      type: "quote",
      quote: "q",
    });
    expect(row.title).toBeNull();
    expect(row.body).toBeNull();
    expect(row.speakerNotes).toBeNull();
    expect(row.backgroundColor).toBeNull();
  });

  it("preserves speaker notes into the row — the WRITE stores them; the READ withholds them", () => {
    const row = slideProjectionRow(1, {
      id: "s1",
      slideNumber: 1,
      type: "title",
      title: "T",
      speakerNotes: "script",
    });
    expect(row.speakerNotes).toBe("script");
  });
});
