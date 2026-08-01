// =============================================================================
// THE SLIDE CONTRACT
// -----------------------------------------------------------------------------
// This module is the single source of truth for the shape of a slide. The
// database stores slides as JSON (`presentations.slides_json`, and the
// per-row `presentation_slides.content_json`), the API hands that JSON to the
// browser, and the Reveal.js renderer walks it. All three must agree, and a
// TypeScript interface alone cannot make them agree — an interface is erased at
// runtime, so a malformed row would sail through `as Slide` and blow up deep
// inside the renderer with a stack trace that names neither the row nor the
// field.
//
// So every shape below exists twice: as a zod schema (the runtime authority)
// and as a type inferred FROM that schema (never hand-written in parallel,
// because two hand-maintained definitions drift). JSON entering the app from
// the database or the network is PARSED, never cast.
//
// CANONICAL — the API and database streams build to this. Where the technical
// spec was ambiguous (it types a slide only as `{ type: string; title: string;
// body: string; content_json?: object }`) this module makes the decision: the
// loose `type`/`body` pair is replaced by a discriminated union, so that a code
// slide is statically known to carry `language` and an image slide is
// statically known to carry `alt`.
// =============================================================================

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Slide identity.
 *
 * A string, not a database integer. Slides are created, reordered and deleted
 * entirely in the browser before a deck is ever saved, so the editor needs to
 * mint stable keys with no server round-trip. A numeric primary key can still
 * be stringified into this field on the way out of the database.
 */
export const slideIdSchema = z.string().min(1).max(64);

/**
 * A CSS colour accepted for slide backgrounds.
 *
 * Restricted to hex because this value is interpolated into a style attribute
 * and, in the HTML export, into a stylesheet. Allowing arbitrary CSS there
 * would let a saved deck smuggle `url(...)` or `expression(...)` into another
 * user's page. Hex is expressive enough for the editor's colour picker.
 */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "expected a hex colour");

/**
 * Media and link URLs.
 *
 * `http`/`https` only. A `javascript:` or `data:` URL in an image `src` is a
 * stored-XSS vector once the HTML export inlines it into a standalone file
 * that someone opens from disk with no CSP protecting them.
 */
export const externalUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "only http(s) URLs are allowed",
  );

/**
 * Reveal transition names.
 *
 * Enumerated rather than passed through as a string: Reveal silently ignores
 * an unknown transition, which surfaces as "my transition setting does
 * nothing" with no error anywhere.
 */
export const slideTransitionSchema = z.enum([
  "none",
  "fade",
  "slide",
  "convex",
  "concave",
  "zoom",
]);

export type SlideTransition = z.infer<typeof slideTransitionSchema>;

/**
 * One side of a two-column slide.
 *
 * Every field optional so a column can legitimately be empty — a
 * heading-plus-blank layout is a real design choice, not a validation error.
 */
export const slideColumnSchema = z.object({
  heading: z.string().max(200).optional(),
  body: z.string().max(5_000).optional(),
  bullets: z.array(z.string().max(500)).max(20).optional(),
});

export type SlideColumn = z.infer<typeof slideColumnSchema>;

// ---------------------------------------------------------------------------
// Fields shared by every slide variant
// ---------------------------------------------------------------------------
//
// Spread into each member of the union rather than composed with `.extend()`
// on a base object, because zod's `discriminatedUnion` requires each member to
// be a plain ZodObject whose discriminant is a literal, and chained `.extend()`
// on a shared base is the usual way people accidentally lose that.

const baseSlideFields = {
  id: slideIdSchema,

  /**
   * 1-based position in the deck.
   *
   * 1-based because it is what the API route `/slides/[slideNumber]` uses and
   * what a presenter reads off the screen ("slide 4 of 12"). Array indices in
   * this codebase stay 0-based; the conversion happens at the boundary and is
   * named `slideNumber` vs `index` so the two are never confused.
   */
  slideNumber: z.number().int().min(1),

  /**
   * Presenter-only text. Rendered in PresenterView and in Reveal's notes
   * plugin surface; never shown on the projected slide.
   */
  speakerNotes: z.string().max(10_000).optional(),

  backgroundColor: hexColorSchema.optional(),

  /**
   * Per-slide override of the deck transition. Absent means "inherit".
   */
  transition: slideTransitionSchema.optional(),
} as const;

// ---------------------------------------------------------------------------
// The variants
// ---------------------------------------------------------------------------

export const titleSlideSchema = z.object({
  ...baseSlideFields,
  type: z.literal("title"),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional(),
});

export const contentSlideSchema = z.object({
  ...baseSlideFields,
  type: z.literal("content"),
  title: z.string().max(200).optional(),
  body: z.string().max(10_000).optional(),
  bullets: z.array(z.string().max(500)).max(20).optional(),
});

export const codeSlideSchema = z.object({
  ...baseSlideFields,
  type: z.literal("code"),
  title: z.string().max(200).optional(),
  /** Highlight.js language token, e.g. "javascript". Free-form: the set of
   *  languages is Reveal's plugin's business, not this contract's. */
  language: z.string().min(1).max(40),
  code: z.string().max(20_000),
  caption: z.string().max(500).optional(),
});

export const imageSlideSchema = z.object({
  ...baseSlideFields,
  type: z.literal("image"),
  title: z.string().max(200).optional(),
  src: externalUrlSchema,
  /**
   * REQUIRED, unlike every other optional field here. An image slide with no
   * alternative text is inaccessible to a screen reader, and WCAG 2.1 AA is a
   * hard requirement for this LMS. Making it optional in the schema means the
   * editor can save a deck that fails the audit; making it required means the
   * failure happens at authoring time where it can be fixed. Decorative
   * imagery is served by the empty string, which is the correct ARIA signal.
   */
  alt: z.string().max(500),
  caption: z.string().max(500).optional(),
});

export const twoColumnSlideSchema = z.object({
  ...baseSlideFields,
  type: z.literal("two-column"),
  title: z.string().max(200).optional(),
  left: slideColumnSchema,
  right: slideColumnSchema,
});

export const quoteSlideSchema = z.object({
  ...baseSlideFields,
  type: z.literal("quote"),
  quote: z.string().min(1).max(2_000),
  attribution: z.string().max(200).optional(),
});

/**
 * The slide union.
 *
 * `discriminatedUnion` rather than `union`: with a plain union, a code slide
 * missing `language` produces six parallel failures (one per branch) and the
 * error message is unreadable. With a discriminant, zod picks the branch by
 * `type` and reports the one real problem.
 */
export const slideSchema = z.discriminatedUnion("type", [
  titleSlideSchema,
  contentSlideSchema,
  codeSlideSchema,
  imageSlideSchema,
  twoColumnSlideSchema,
  quoteSlideSchema,
]);

export type Slide = z.infer<typeof slideSchema>;
export type SlideType = Slide["type"];

export type TitleSlide = z.infer<typeof titleSlideSchema>;
export type ContentSlide = z.infer<typeof contentSlideSchema>;
export type CodeSlide = z.infer<typeof codeSlideSchema>;
export type ImageSlide = z.infer<typeof imageSlideSchema>;
export type TwoColumnSlide = z.infer<typeof twoColumnSlideSchema>;
export type QuoteSlide = z.infer<typeof quoteSlideSchema>;

/** Every slide type, in the order the editor's "add slide" menu offers them. */
export const SLIDE_TYPES: readonly SlideType[] = [
  "title",
  "content",
  "code",
  "image",
  "two-column",
  "quote",
] as const;

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

export const deckMetadataSchema = z.object({
  theme: z.string().max(60).default("lms"),
  /** Deck-wide default; a slide's own `transition` wins. */
  transition: slideTransitionSchema.default("slide"),
  /**
   * Slide canvas size in CSS pixels. Reveal scales this to the viewport, so
   * these are layout units rather than a physical measurement — there is no
   * metric equivalent to state. 1280x720 is 16:9, which every projector and
   * every screen-share in this course is.
   */
  width: z.number().int().min(320).max(4_096).default(1_280),
  height: z.number().int().min(240).max(4_096).default(720),
});

export type DeckMetadata = z.infer<typeof deckMetadataSchema>;

/**
 * The exact shape stored in `presentations.slides_json`.
 *
 * Slides are NOT required to be non-empty: a deck begins life empty when the
 * API creates it (`slides_json: { slides: [] }`), and rejecting that here would
 * make the create route unable to persist its own output.
 */
export const slideDeckSchema = z.object({
  slides: z.array(slideSchema).max(500),
  metadata: deckMetadataSchema,
});

export type SlideDeck = z.infer<typeof slideDeckSchema>;

/** Deck-level information the viewer chrome shows around the slides. */
export const presentationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(2_000).optional(),
  deck: slideDeckSchema,
});

export type Presentation = z.infer<typeof presentationSchema>;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Result of parsing untrusted slide JSON.
 *
 * A discriminated result rather than a thrown exception, because the two call
 * sites want opposite things: a route handler wants to turn the failure into a
 * 422 with the field path, and the editor's live preview wants to keep showing
 * the last good render while the author is mid-keystroke. Neither is served by
 * an exception crossing a React render.
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly string[] };

function formatIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Parse one slide from untrusted JSON. */
export function parseSlide(input: unknown): ParseResult<Slide> {
  const result = slideSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: formatIssues(result.error) };
}

/**
 * Parse a whole deck from untrusted JSON — the function every database read
 * should go through.
 */
export function parseSlideDeck(input: unknown): ParseResult<SlideDeck> {
  const result = slideDeckSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: formatIssues(result.error) };
}

/**
 * An empty deck with defaulted metadata.
 *
 * Exists so the create route and the editor's "new presentation" button
 * produce byte-identical JSON; two hand-written empty literals drift the moment
 * a metadata field is added.
 */
export function emptyDeck(): SlideDeck {
  return slideDeckSchema.parse({ slides: [], metadata: {} });
}

/**
 * Renumber slides so `slideNumber` matches array order.
 *
 * The editor reorders by moving array entries, which leaves `slideNumber`
 * stale. Every save path should run this first — otherwise the presenter view's
 * "slide 4 of 12" disagrees with the position the author dragged it to.
 */
export function renumberSlides(slides: readonly Slide[]): Slide[] {
  return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

/**
 * Plain-text summary of a slide, for thumbnails, the outline pane and the
 * screen-reader announcement made on slide change.
 *
 * Centralised because an announcement that disagrees with the visible title is
 * worse than no announcement at all.
 */
export function slideLabel(slide: Slide): string {
  switch (slide.type) {
    case "title":
      return slide.title;
    case "quote":
      return slide.quote.slice(0, 80);
    case "code":
      return slide.title ?? `${slide.language} code`;
    case "image":
      // `alt` is required but may legitimately be "" for decorative imagery,
      // so `??` would let an empty announcement through where `||` will not.
      return slide.title ?? (slide.alt || "Image");
    case "content":
    case "two-column":
      return slide.title ?? `Slide ${slide.slideNumber}`;
  }
}
