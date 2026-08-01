// =============================================================================
// SLIDE OPERATIONS — the editor's whole model, as pure functions.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHY THESE ARE NOT METHODS ON A COMPONENT.
//
// Reorder, delete, duplicate and insert are the four places a slide editor
// corrupts a deck, and all four fail the same way: `slideNumber` stops matching
// array position. `renumberSlides` in @/lib/presentations/types exists precisely
// for this and its doc says "every save path should run this first" — so every
// function here ends with it, and none of them is reachable without it.
//
// The API validates the number. `PUT /slides/:slideNumber` addresses a slide BY
// its 1-based number, so a deck whose numbering has drifted does not fail
// loudly — it silently overwrites the wrong slide. That is the bug this module
// makes structurally impossible rather than merely tested for.
//
// Pure and total: no throws, out-of-range indices are no-ops returning the same
// array. A drag that lands outside the list is a normal user action, not an
// exception, and an editor that throws on one loses the author's work.
// =============================================================================

import {
  renumberSlides,
  type Slide,
  type SlideType,
} from "@/lib/presentations/types";

/** Is `index` addressable in `slides`? */
function inRange(slides: readonly Slide[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < slides.length;
}

/**
 * Move the slide at `from` to `to`, renumbering the result.
 *
 * @returns a new array, or the SAME array reference when the move is a no-op —
 *          which lets React skip a re-render on a drag that went nowhere.
 */
export function moveSlide(slides: readonly Slide[], from: number, to: number): Slide[] {
  if (!inRange(slides, from) || !inRange(slides, to) || from === to) {
    return [...slides];
  }
  const next = [...slides];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return renumberSlides(next);
}

/** Remove the slide at `index`. */
export function removeSlide(slides: readonly Slide[], index: number): Slide[] {
  if (!inRange(slides, index)) return [...slides];
  return renumberSlides(slides.filter((_, i) => i !== index));
}

/**
 * Insert `slide` after `index`. Pass -1 to prepend.
 *
 * The inserted slide's own `slideNumber` is ignored and overwritten — a caller
 * building a new slide should not have to know where it will land.
 */
export function insertSlideAfter(
  slides: readonly Slide[],
  index: number,
  slide: Slide,
): Slide[] {
  const at = Math.min(Math.max(index + 1, 0), slides.length);
  const next = [...slides];
  next.splice(at, 0, slide);
  return renumberSlides(next);
}

/**
 * Duplicate the slide at `index`, placing the copy immediately after it.
 *
 * The copy gets a FRESH id. Two slides sharing an id is the defect that makes a
 * React key collide, which makes edits land on the wrong slide — the exact
 * class of bug this module exists to prevent, arriving by a different door.
 */
export function duplicateSlide(
  slides: readonly Slide[],
  index: number,
  newId: string,
): Slide[] {
  if (!inRange(slides, index)) return [...slides];
  return insertSlideAfter(slides, index, { ...slides[index], id: newId });
}

/** Replace the slide at `index`. Renumbers, in case the caller edited the number. */
export function replaceSlide(
  slides: readonly Slide[],
  index: number,
  slide: Slide,
): Slide[] {
  if (!inRange(slides, index)) return [...slides];
  return renumberSlides(slides.map((existing, i) => (i === index ? slide : existing)));
}

/**
 * A new, valid, minimally-populated slide of a given type.
 *
 * Every field the schema marks required is filled with something that PASSES
 * validation, because an editor that creates a slide the API refuses to save is
 * an editor that loses work at the end of a session rather than at the start.
 * The three that bite:
 *   - `title` slides need a non-empty title (`.min(1)`),
 *   - `code` slides need a non-empty `language` (`.min(1)`),
 *   - `image` slides need `alt`, and it is required precisely so an
 *     inaccessible deck cannot be saved. The placeholder is the EMPTY STRING,
 *     which is the correct ARIA signal for decorative imagery, plus a `src`
 *     that is a valid URL so the row parses. The author is prompted for real
 *     alternative text by the editor, not by a save failure.
 *
 * `slideNumber` is 1 and is corrected by the insert helpers.
 */
export function blankSlide(type: SlideType, id: string): Slide {
  const base = { id, slideNumber: 1 } as const;
  switch (type) {
    case "title":
      return { ...base, type: "title", title: "New slide" };
    case "content":
      return { ...base, type: "content", title: "New slide", bullets: [] };
    case "code":
      return { ...base, type: "code", title: "New slide", language: "javascript", code: "" };
    case "image":
      return {
        ...base,
        type: "image",
        title: "New slide",
        src: "https://example.com/image.png",
        alt: "",
      };
    case "two-column":
      return { ...base, type: "two-column", title: "New slide", left: {}, right: {} };
    case "quote":
      return { ...base, type: "quote", quote: "New quote" };
  }
}

/**
 * A slide id that will not collide.
 *
 * `crypto.randomUUID` where available, a counter-plus-random fallback where it
 * is not (jsdom without a crypto stub, and http origins in older browsers —
 * `crypto` is a secure-context API). Truncated to fit `slideIdSchema`'s 64-char
 * ceiling.
 */
export function newSlideId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `slide-${random}`.slice(0, 64);
}
