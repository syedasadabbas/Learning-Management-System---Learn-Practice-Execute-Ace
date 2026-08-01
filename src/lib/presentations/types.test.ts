import { describe, expect, it } from "vitest";

import {
  emptyDeck,
  parseSlide,
  parseSlideDeck,
  renumberSlides,
  slideLabel,
  type Slide,
} from "./types";

const titleSlide = {
  id: "s1",
  slideNumber: 1,
  type: "title",
  title: "Week 1: HTML",
  subtitle: "Structure before style",
};

describe("parseSlide", () => {
  it("accepts every slide variant", () => {
    const variants: unknown[] = [
      titleSlide,
      {
        id: "s2",
        slideNumber: 2,
        type: "content",
        title: "Elements",
        bullets: ["Tags", "Attributes"],
      },
      {
        id: "s3",
        slideNumber: 3,
        type: "code",
        language: "html",
        code: "<p>hi</p>",
      },
      {
        id: "s4",
        slideNumber: 4,
        type: "image",
        src: "https://example.com/a.png",
        alt: "A diagram",
      },
      {
        id: "s5",
        slideNumber: 5,
        type: "two-column",
        left: { heading: "Do" },
        right: { heading: "Do not" },
      },
      { id: "s6", slideNumber: 6, type: "quote", quote: "Ship it" },
    ];

    for (const variant of variants) {
      expect(parseSlide(variant).ok).toBe(true);
    }
  });

  it("rejects an unknown slide type", () => {
    const result = parseSlide({ id: "x", slideNumber: 1, type: "carousel" });
    expect(result.ok).toBe(false);
  });

  it("rejects a code slide with no language", () => {
    const result = parseSlide({
      id: "x",
      slideNumber: 1,
      type: "code",
      code: "console.error('x')",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("language");
    }
  });

  it("rejects an image slide with no alt text", () => {
    // The accessibility guarantee is only real if the schema enforces it.
    const result = parseSlide({
      id: "x",
      slideNumber: 1,
      type: "image",
      src: "https://example.com/a.png",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts an empty alt for decorative imagery", () => {
    const result = parseSlide({
      id: "x",
      slideNumber: 1,
      type: "image",
      src: "https://example.com/a.png",
      alt: "",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a javascript: image URL", () => {
    const result = parseSlide({
      id: "x",
      slideNumber: 1,
      type: "image",
      src: "javascript:alert(1)",
      alt: "nope",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-hex background colour", () => {
    const result = parseSlide({
      ...titleSlide,
      backgroundColor: "url(https://evil.example/x)",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a slide number below 1", () => {
    expect(parseSlide({ ...titleSlide, slideNumber: 0 }).ok).toBe(false);
  });

  it("rejects null and primitives outright", () => {
    for (const input of [null, undefined, 42, "slide", []]) {
      expect(parseSlide(input).ok).toBe(false);
    }
  });

  it("reports the failing field path", () => {
    const result = parseSlide({ ...titleSlide, title: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^title:/);
  });
});

describe("parseSlideDeck", () => {
  it("accepts an empty deck and defaults its metadata", () => {
    const result = parseSlideDeck({ slides: [], metadata: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.transition).toBe("slide");
      expect(result.value.metadata.width).toBe(1_280);
    }
  });

  it("rejects a deck whose slides are not an array", () => {
    expect(parseSlideDeck({ slides: {}, metadata: {} }).ok).toBe(false);
  });

  it("rejects a deck containing one malformed slide", () => {
    const result = parseSlideDeck({
      slides: [titleSlide, { id: "s2", slideNumber: 2, type: "code" }],
      metadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("slides.1");
  });
});

describe("emptyDeck", () => {
  it("round-trips through the schema", () => {
    expect(parseSlideDeck(emptyDeck()).ok).toBe(true);
    expect(emptyDeck().slides).toHaveLength(0);
  });
});

describe("renumberSlides", () => {
  it("makes slideNumber match array order after a reorder", () => {
    const parsed = parseSlide({ ...titleSlide, slideNumber: 9 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const slides: Slide[] = [parsed.value, { ...parsed.value, id: "s2" }];

    expect(renumberSlides(slides).map((slide) => slide.slideNumber)).toEqual([
      1, 2,
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(renumberSlides([])).toEqual([]);
  });
});

describe("slideLabel", () => {
  it("falls back to the slide number when a content slide has no title", () => {
    const parsed = parseSlide({ id: "s", slideNumber: 7, type: "content" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(slideLabel(parsed.value)).toBe("Slide 7");
  });

  it("never announces an empty string for a decorative image", () => {
    const parsed = parseSlide({
      id: "s",
      slideNumber: 1,
      type: "image",
      src: "https://example.com/a.png",
      alt: "",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(slideLabel(parsed.value)).toBe("Image");
  });
});
