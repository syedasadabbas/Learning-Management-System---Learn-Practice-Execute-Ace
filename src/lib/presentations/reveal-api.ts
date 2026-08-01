// =============================================================================
// THE REVEAL.JS BOUNDARY
// -----------------------------------------------------------------------------
// Reveal.js is an imperative, DOM-mutating library. Everything the React
// wrapper is allowed to know about it is declared here, narrowly, so that the
// wrapper never reaches for `any` and so the surface we depend on is a short,
// reviewable list rather than "whatever Reveal exposes".
//
// `@types/reveal.js` is good enough for the methods, but two things are not
// covered and are declared by hand below:
//   1. `Reveal.on("slidechanged", ...)` is typed as `HTMLElement["addEventListener"]`,
//      so the handler receives a bare `Event` with no knowledge of `detail`.
//   2. The constructor is a `new`-able value merged with the singleton API,
//      which is awkward to name as a factory type.
// =============================================================================

import type RevealJs from "reveal.js";

/**
 * The initialized Reveal instance.
 *
 * The package declares `export = Reveal`, where `Reveal` is a constructor
 * merged with a namespace, so the shapes are reached through the namespace
 * qualifier rather than through the default import's type (which names the
 * namespace, not a type).
 */
export type RevealApi = RevealJs.Api;

/** The subset of Reveal's options this wrapper sets. */
export type RevealOptions = RevealJs.Options | undefined;

/**
 * How the wrapper obtains an instance.
 *
 * Injectable for two reasons, only one of which is testing. The other is that
 * the presenter window and the main deck must be able to construct instances
 * against different elements with different option sets, and a hardcoded
 * `new Reveal(...)` inside the component makes that impossible without editing
 * the component.
 */
export type RevealFactory = (
  element: HTMLElement,
  options: RevealOptions,
) => RevealApi;

/**
 * The payload Reveal attaches to its `slidechanged` event.
 *
 * Declared here because the DefinitelyTyped `on` signature erases it. `indexh`
 * is the horizontal index, which for the flat decks this LMS authors is the
 * slide number minus one.
 */
export interface SlideChangedDetail {
  readonly indexh: number;
  readonly indexv: number;
  readonly currentSlide?: HTMLElement;
  readonly previousSlide?: HTMLElement;
}

/**
 * Narrow an `Event` to a Reveal slide-change event.
 *
 * A type guard rather than a cast: Reveal dispatches several events through the
 * same listener plumbing, and a cast would happily read `indexh` off one that
 * has no `detail` at all, yielding `undefined` where a number is expected and a
 * NaN slide index downstream.
 */
export function isSlideChangedEvent(
  event: Event,
): event is Event & { detail: SlideChangedDetail } {
  if (!("detail" in event)) return false;
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  return (
    typeof detail === "object" &&
    detail !== null &&
    typeof (detail as { indexh?: unknown }).indexh === "number"
  );
}

// NOTE: the concrete factory lives in RevealDeck.tsx, not here. Reveal touches
// `document` when constructed, so the module that statically imports it must be
// one that is only ever evaluated in the browser — which RevealDeck is,
// because it is only ever reached through `next/dynamic` with `ssr: false`.
// Putting the import in this module would make every server component that
// wants `isSlideChangedEvent` drag Reveal onto the server.
