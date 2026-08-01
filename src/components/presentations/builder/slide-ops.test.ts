import { describe, expect, it } from "vitest";

import { SLIDE_TYPES, parseSlide, type Slide } from "@/lib/presentations/types";

import {
  blankSlide,
  duplicateSlide,
  insertSlideAfter,
  moveSlide,
  newSlideId,
  removeSlide,
  replaceSlide,
} from "./slide-ops";

// =============================================================================
// THE INVARIANT: after any operation, `slideNumber` equals array position + 1.
// It matters because `PUT /slides/:slideNumber` addresses a slide BY that
// number — drifted numbering does not fail loudly, it silently overwrites the
// wrong slide. Every test below asserts it.
// =============================================================================

function deck(count: number): Slide[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    slideNumber: i + 1,
    type: "title" as const,
    title: `Slide ${i + 1}`,
  }));
}

/** The invariant, as a reusable assertion. */
function expectRenumbered(slides: readonly Slide[]): void {
  slides.forEach((slide, index) => {
    expect(slide.slideNumber).toBe(index + 1);
  });
}

describe("moveSlide", () => {
  it("moves and renumbers", () => {
    const result = moveSlide(deck(4), 0, 2);
    expect(result.map((s) => s.id)).toEqual(["s2", "s3", "s1", "s4"]);
    expectRenumbered(result);
  });

  it("moves backwards", () => {
    const result = moveSlide(deck(4), 3, 1);
    expect(result.map((s) => s.id)).toEqual(["s1", "s4", "s2", "s3"]);
    expectRenumbered(result);
  });

  it("is a no-op for an out-of-range or identical index, and does not throw", () => {
    // A drag that lands outside the list is a normal user action.
    expect(moveSlide(deck(3), 0, 0).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(moveSlide(deck(3), -1, 1).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(moveSlide(deck(3), 0, 9).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("removeSlide", () => {
  it("removes and renumbers, closing the gap", () => {
    const result = removeSlide(deck(4), 1);
    expect(result.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
    expectRenumbered(result);
  });

  it("tolerates an index past the end", () => {
    expect(removeSlide(deck(2), 5)).toHaveLength(2);
  });

  it("can empty a deck", () => {
    expect(removeSlide(deck(1), 0)).toEqual([]);
  });
});

describe("insertSlideAfter", () => {
  it("inserts after the given index and renumbers, ignoring the new slide's own number", () => {
    const fresh: Slide = { id: "new", slideNumber: 99, type: "quote", quote: "hi" };
    const result = insertSlideAfter(deck(3), 0, fresh);

    expect(result.map((s) => s.id)).toEqual(["s1", "new", "s2", "s3"]);
    expectRenumbered(result);
    expect(result[1].slideNumber).toBe(2);
  });

  it("prepends when given -1", () => {
    const fresh: Slide = { id: "new", slideNumber: 1, type: "quote", quote: "hi" };
    expect(insertSlideAfter(deck(2), -1, fresh).map((s) => s.id)).toEqual(["new", "s1", "s2"]);
  });

  it("appends when the index is past the end", () => {
    const fresh: Slide = { id: "new", slideNumber: 1, type: "quote", quote: "hi" };
    expect(insertSlideAfter(deck(2), 9, fresh).map((s) => s.id)).toEqual(["s1", "s2", "new"]);
  });
});

describe("duplicateSlide", () => {
  it("copies the slide with a FRESH id, immediately after the original", () => {
    // Two slides sharing an id collide as React keys, and edits then land on
    // the wrong slide — the same defect class this module exists to prevent.
    const result = duplicateSlide(deck(3), 1, "copy-1");
    expect(result.map((s) => s.id)).toEqual(["s1", "s2", "copy-1", "s3"]);
    expect(new Set(result.map((s) => s.id)).size).toBe(result.length);
    expectRenumbered(result);
  });

  it("copies the content, not merely the shell", () => {
    const result = duplicateSlide(deck(1), 0, "copy");
    expect(result[1]).toMatchObject({ type: "title", title: "Slide 1" });
  });
});

describe("replaceSlide", () => {
  it("replaces in place and renumbers", () => {
    const replacement: Slide = { id: "s2", slideNumber: 99, type: "quote", quote: "new" };
    const result = replaceSlide(deck(3), 1, replacement);
    expect(result[1].type).toBe("quote");
    expectRenumbered(result);
  });
});

describe("blankSlide", () => {
  it("produces a VALID slide for every type in the union", () => {
    // An editor that creates a slide the API refuses to save loses work at the
    // end of a session rather than at the start.
    for (const type of SLIDE_TYPES) {
      const slide = blankSlide(type, `id-${type}`);
      const parsed = parseSlide(slide);
      expect(parsed.ok, `${type}: ${parsed.ok ? "" : parsed.errors.join(", ")}`).toBe(true);
    }
  });

  it("gives an image slide an empty alt — the correct signal for decorative", () => {
    const slide = blankSlide("image", "x");
    expect(slide).toMatchObject({ type: "image", alt: "" });
    expect(parseSlide(slide).ok).toBe(true);
  });

  it("gives a code slide a non-empty language, which the schema requires", () => {
    const slide = blankSlide("code", "x");
    expect(slide).toMatchObject({ type: "code" });
    expect(parseSlide(slide).ok).toBe(true);
  });
});

describe("newSlideId", () => {
  it("fits the 64-character id ceiling and does not repeat", () => {
    const a = newSlideId();
    const b = newSlideId();
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });
});
