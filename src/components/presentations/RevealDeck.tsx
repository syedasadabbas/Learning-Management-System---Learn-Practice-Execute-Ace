"use client";

// =============================================================================
// THE REVEAL INSTANCE OWNER
// -----------------------------------------------------------------------------
// This module statically imports reveal.js and is therefore NOT SSR-safe. It
// must only be reached through `RevealPresentation`, which loads it with
// `next/dynamic({ ssr: false })`. Importing it directly from a server component
// will break `next build`.
//
// The hard part of wrapping Reveal is lifecycle. Reveal mutates the DOM React
// owns, attaches document-level listeners, and installs a resize observer. An
// instance that is created but never destroyed keeps all of that alive after
// React has thrown the nodes away, and the symptom is not a crash — it is the
// slide editor's live preview, which remounts on every keystroke, gradually
// accumulating keyboard handlers until one arrow press advances nine decks. So
// every creation path in this file has exactly one destruction path, and the
// destruction is asserted in RevealDeck.test.tsx.
// =============================================================================

import RevealCtor from "reveal.js";
import { useCallback, useEffect, useRef, useState } from "react";

// Reveal's STRUCTURAL stylesheet only — layout, the slide stack, transitions.
// Its themes are deliberately not imported; appearance comes from our own CSS
// custom properties (src/lib/presentations/theme.ts) so decks look like this
// LMS. See that module for the full reasoning.
import "reveal.js/dist/reveal.css";

import { cn } from "@/components/ui/cn";
import { presentationThemeStyle } from "@/lib/presentations/theme";
import {
  isSlideChangedEvent,
  type RevealApi,
  type RevealFactory,
} from "@/lib/presentations/reveal-api";
import {
  slideLabel,
  type Slide,
  type SlideDeck,
} from "@/lib/presentations/types";

import { SlideContent } from "./SlideContent";

/**
 * Default factory. Separate from the component so tests — and any future
 * presenter-window variant — can substitute one without touching this file.
 */
export const defaultRevealFactory: RevealFactory = (element, options) =>
  new RevealCtor(element, options ?? {});

export interface RevealDeckProps {
  deck: SlideDeck;

  /**
   * Controlled index (0-based). When provided, the deck follows the prop and
   * `onSlideChange` is the only way the parent learns about user navigation —
   * the classic controlled-input contract. When omitted the deck owns its own
   * position and starts at `defaultIndex`.
   */
  currentIndex?: number;
  defaultIndex?: number;

  onSlideChange?: (index: number, slide: Slide | undefined) => void;

  /**
   * Preview mode for the editor's thumbnail pane.
   *
   * In this mode NO Reveal instance is created at all. That is a deliberate
   * design decision rather than a shortcut: a thumbnail pane renders one
   * component per slide, so initializing Reveal per thumbnail would mean twenty
   * instances all binding document-level keyboard handlers and all claiming to
   * be "the" presentation. A static render of a single slide is what a
   * thumbnail actually needs, and it is inert by construction — there is no
   * key handler to accidentally leave enabled.
   */
  readOnly?: boolean;

  /** Reveal's own arrow controls and progress bar. Off in preview. */
  showControls?: boolean;

  className?: string;

  /** Test/embed seam; see `defaultRevealFactory`. */
  createReveal?: RevealFactory;
}

/**
 * Does the viewer want motion suppressed?
 *
 * Read at init AND used to force `transition: "none"`, because Reveal's slide
 * transitions are JS-driven CSS classes that a `prefers-reduced-motion` media
 * query in our stylesheet cannot reach.
 */
function prefersReducedMotion(): boolean {
  // `matchMedia` is absent in some test environments and in older embedded
  // webviews; treating absence as "no preference" matches the CSS default.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function RevealDeck({
  deck,
  currentIndex,
  defaultIndex = 0,
  onSlideChange,
  readOnly = false,
  showControls = true,
  className,
  createReveal = defaultRevealFactory,
}: RevealDeckProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const revealRef = useRef<RevealApi | null>(null);

  const isControlled = currentIndex !== undefined;
  const [uncontrolledIndex, setUncontrolledIndex] = useState(defaultIndex);
  const activeIndex = isControlled ? currentIndex : uncontrolledIndex;

  // The callback is read from a ref inside Reveal's listener so that changing
  // the handler does not tear down and rebuild the Reveal instance. Rebuilding
  // on every render of the parent is the other classic way this wrapper leaks.
  const onSlideChangeRef = useRef(onSlideChange);
  useEffect(() => {
    onSlideChangeRef.current = onSlideChange;
  }, [onSlideChange]);

  // Same treatment, same reason, and this one is sharper: a caller who writes
  // `createReveal={() => makeThing()}` inline passes a new function identity on
  // every render. If the mount effect depended on it, every parent render would
  // destroy and rebuild the engine — losing the viewer's position mid-talk. The
  // factory is only ever consulted once, at mount, so a ref is the honest shape.
  const createRevealRef = useRef(createReveal);
  useEffect(() => {
    createRevealRef.current = createReveal;
  }, [createReveal]);

  const slides = deck.slides;
  const slideCount = slides.length;

  const commitIndex = useCallback(
    (next: number) => {
      if (!isControlled) setUncontrolledIndex(next);
      onSlideChangeRef.current?.(next, slides[next]);
    },
    [isControlled, slides],
  );

  // -------------------------------------------------------------------------
  // Mount / unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (readOnly) return;
    const element = containerRef.current;
    if (element === null) return;

    const reduceMotion = prefersReducedMotion();
    const instance = createRevealRef.current(element, {
      // `embedded` keeps Reveal inside its container instead of seizing the
      // whole viewport — mandatory, since this renders inside app chrome.
      embedded: true,
      // Reveal's hash routing would fight Next's router for the URL.
      hash: false,
      respondToHashChanges: false,
      keyboard: true,
      touch: true,
      controls: showControls,
      progress: showControls,
      // Reveal's own slide-number chrome is off; we render an accessible
      // counter instead, because Reveal's is a decorative div a screen reader
      // reads as a bare number with no context.
      slideNumber: false,
      transition: reduceMotion ? "none" : deck.metadata.transition,
      backgroundTransition: reduceMotion ? "none" : "fade",
      width: deck.metadata.width,
      height: deck.metadata.height,
      disableLayout: false,
    });

    revealRef.current = instance;

    let disposed = false;

    const handleSlideChanged = (event: Event): void => {
      if (!isSlideChangedEvent(event)) return;
      commitIndex(event.detail.indexh);
    };

    void instance.initialize().then(() => {
      // The component can unmount while initialize() is still in flight —
      // React 18 StrictMode does exactly this on every mount in development.
      // Without this guard the cleanup below destroys nothing (the ref was
      // still null when it ran) and this instance survives forever.
      if (disposed) {
        instance.destroy();
        return;
      }
      instance.on("slidechanged", handleSlideChanged);
      if (defaultIndex > 0) instance.slide(defaultIndex, 0, 0);
    });

    return () => {
      disposed = true;
      instance.off("slidechanged", handleSlideChanged);
      instance.destroy();
      revealRef.current = null;
    };
    // Intentionally NOT depending on `deck.slides`: a slide edit must not
    // rebuild the engine (that would lose the viewer's position mid-talk). New
    // slides are picked up by the sync() effect below. The dependencies here
    // are exactly the things Reveal cannot change without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    readOnly,
    showControls,
    deck.metadata.transition,
    deck.metadata.width,
    deck.metadata.height,
  ]);

  // -------------------------------------------------------------------------
  // Slide set changed
  // -------------------------------------------------------------------------
  // Reveal caches the slide list at initialize(); adding or removing a
  // <section> underneath it leaves the controls and progress bar describing a
  // deck that no longer exists. sync() is the supported way to re-read the DOM.
  useEffect(() => {
    revealRef.current?.sync();
  }, [slideCount, slides]);

  // -------------------------------------------------------------------------
  // Controlled navigation
  // -------------------------------------------------------------------------
  useEffect(() => {
    const instance = revealRef.current;
    if (instance === null || !instance.isReady()) return;
    if (instance.getIndices().h === activeIndex) return;
    instance.slide(activeIndex, 0, 0);
  }, [activeIndex]);

  // -------------------------------------------------------------------------
  // Focus management on slide change
  // -------------------------------------------------------------------------
  // Without this, a keyboard or screen-reader user who advances the deck stays
  // focused on whatever they last clicked (often the "next" button), and the
  // virtual cursor never moves to the new content. Moving focus to the section
  // itself puts the reader at the top of the new slide, which is where a
  // sighted user's eye goes.
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  useEffect(() => {
    if (readOnly) return;
    sectionRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, readOnly]);

  const themeStyle = presentationThemeStyle();

  // -------------------------------------------------------------------------
  // Preview: one static slide, no engine
  // -------------------------------------------------------------------------
  if (readOnly) {
    const slide = slides[activeIndex];
    return (
      <div
        data-testid="reveal-preview"
        data-readonly="true"
        style={themeStyle}
        className={cn(
          "aspect-video w-full overflow-hidden rounded-lg bg-[var(--rp-bg)] p-3",
          className,
        )}
      >
        {slide === undefined ? (
          <p className="text-sm text-[var(--rp-muted)]">No slides yet</p>
        ) : (
          <SlideContent slide={slide} compact />
        )}
      </div>
    );
  }

  const currentSlide = slides[activeIndex];

  return (
    <div style={themeStyle} className={cn("w-full", className)}>
      {/*
        The live region is a sibling of the deck, not inside it: Reveal hides
        non-current slides with `aria-hidden`, and an announcement placed inside
        the stack would be hidden along with them exactly when it fires.
      */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="slide-announcer">
        {slideCount === 0
          ? "This presentation has no slides."
          : `Slide ${activeIndex + 1} of ${slideCount}: ${
              currentSlide === undefined ? "" : slideLabel(currentSlide)
            }`}
      </p>

      <div
        ref={containerRef}
        data-testid="reveal-root"
        className="reveal aspect-video w-full rounded-lg bg-[var(--rp-bg)] text-[var(--rp-fg)]"
      >
        <div className="slides">
          {slides.map((slide, index) => (
            <section
              key={slide.id}
              ref={(node) => {
                sectionRefs.current[index] = node;
              }}
              // -1 so the section is programmatically focusable for the
              // announcement above without inserting every slide into the tab
              // order, which would make tabbing through a 40-slide deck a chore.
              tabIndex={-1}
              aria-roledescription="slide"
              aria-label={`Slide ${index + 1} of ${slideCount}`}
              data-slide-type={slide.type}
              data-background-color={slide.backgroundColor}
              data-transition={slide.transition}
            >
              <SlideContent slide={slide} />
              {slide.speakerNotes !== undefined && (
                // Reveal's notes plugin reads `<aside class="notes">`. It is
                // never shown on the projected slide; PresenterView reads the
                // same field straight off the model.
                <aside className="notes">{slide.speakerNotes}</aside>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
