"use client";

// =============================================================================
// <RevealPresentation /> — the public presentation viewer
// -----------------------------------------------------------------------------
// This component is the ONLY supported entry point to the Reveal renderer. It
// exists as a separate module from RevealDeck for one reason: RevealDeck
// statically imports reveal.js, which reads `document` at construction time and
// throws during server rendering. `next/dynamic({ ssr: false })` here is what
// keeps `next build` green — remove it and the prerender pass for any page that
// mounts a presentation fails with "document is not defined".
//
// Everything around the deck — navigation buttons, the slide counter,
// fullscreen — lives here rather than in RevealDeck, so that the engine module
// stays as small as the thing that has to be dynamically loaded.
// =============================================================================

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import type { Slide, SlideDeck } from "@/lib/presentations/types";
import type { RevealFactory } from "@/lib/presentations/reveal-api";

const RevealDeck = dynamic(
  () => import("./RevealDeck").then((module) => module.RevealDeck),
  {
    ssr: false,
    // A fixed-aspect placeholder rather than a spinner: the deck is a 16:9
    // block in a page layout, and swapping a short spinner for a tall deck
    // shifts everything below it (Cumulative Layout Shift).
    loading: () => (
      <div
        className="aspect-video w-full animate-pulse rounded-lg bg-slate-200"
        aria-label="Loading presentation"
        role="status"
      />
    ),
  },
);

export interface RevealPresentationProps {
  deck: SlideDeck;

  /** Deck title, used for the accessible region label and the fullscreen announcement. */
  title?: string;

  /** Controlled index (0-based). Omit for an uncontrolled deck. */
  currentIndex?: number;
  initialSlideIndex?: number;

  onSlideChange?: (index: number, slide: Slide | undefined) => void;

  /** Preview mode — see RevealDeck's `readOnly`. Renders one static slide. */
  readOnly?: boolean;

  /** Hide the chrome (buttons, counter, fullscreen) without disabling the engine. */
  hideChrome?: boolean;

  className?: string;

  /** Test/embed seam, forwarded to RevealDeck. */
  createReveal?: RevealFactory;
}

export function RevealPresentation({
  deck,
  title,
  currentIndex,
  initialSlideIndex = 0,
  onSlideChange,
  readOnly = false,
  hideChrome = false,
  className,
  createReveal,
}: RevealPresentationProps) {
  const slideCount = deck.slides.length;
  const isControlled = currentIndex !== undefined;

  // Clamped so a stale index from a deleted slide cannot address past the end.
  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, 0), Math.max(slideCount - 1, 0)),
    [slideCount],
  );

  const [internalIndex, setInternalIndex] = useState(() =>
    clamp(initialSlideIndex),
  );
  const activeIndex = clamp(isControlled ? currentIndex : internalIndex);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const goto = useCallback(
    (next: number) => {
      const target = clamp(next);
      if (target === activeIndex) return;
      // A controlled deck must not move itself; the parent decides. Reporting
      // the intent and doing nothing is the correct behaviour, and matches how
      // a controlled <input> behaves when it ignores a keystroke.
      if (!isControlled) setInternalIndex(target);
      onSlideChange?.(target, deck.slides[target]);
    },
    [activeIndex, clamp, deck.slides, isControlled, onSlideChange],
  );

  const next = useCallback(() => goto(activeIndex + 1), [activeIndex, goto]);
  const previous = useCallback(
    () => goto(activeIndex - 1),
    [activeIndex, goto],
  );

  /**
   * Slide change reported BY the engine (keyboard, swipe, Reveal's own arrows).
   * Distinct from `goto`, which is our chrome driving the engine, so that a
   * controlled parent still learns about user navigation it did not initiate.
   */
  const handleEngineChange = useCallback(
    (index: number, slide: Slide | undefined) => {
      if (!isControlled) setInternalIndex(clamp(index));
      onSlideChange?.(index, slide);
    },
    [clamp, isControlled, onSlideChange],
  );

  // ---------------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------------
  // Tracked through the `fullscreenchange` event rather than a local boolean
  // set on click, because the user can leave fullscreen with Escape or the
  // browser's own chrome and our button would then be lying about the state.
  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = wrapperRef.current;
    if (element === null) return;
    if (document.fullscreenElement === element) {
      // `void` on both branches: the Fullscreen API rejects when the gesture is
      // not user-initiated, and an unhandled rejection in a click handler is
      // noise, not a fault the viewer can act on.
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (typeof element.requestFullscreen === "function") {
      void element.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const chrome = useMemo(
    () => !readOnly && !hideChrome && slideCount > 0,
    [hideChrome, readOnly, slideCount],
  );

  return (
    <section
      ref={wrapperRef}
      aria-roledescription="presentation"
      aria-label={title ?? "Presentation"}
      className={cn("flex w-full flex-col gap-3", className)}
      data-fullscreen={isFullscreen ? "true" : "false"}
    >
      <RevealDeck
        deck={deck}
        currentIndex={activeIndex}
        defaultIndex={clamp(initialSlideIndex)}
        onSlideChange={handleEngineChange}
        readOnly={readOnly}
        showControls={!hideChrome && !readOnly}
        createReveal={createReveal}
      />

      {chrome && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {/* min-h/min-w 44 px is the WCAG 2.1 AA target size, and is the
                reason these are not `size="sm"` — a 32 px arrow button is
                unusable on a phone held one-handed. */}
            <Button
              variant="secondary"
              onClick={previous}
              disabled={activeIndex === 0}
              className="min-h-[44px] min-w-[44px]"
              aria-label="Previous slide"
            >
              ←
            </Button>
            <Button
              variant="secondary"
              onClick={next}
              disabled={activeIndex >= slideCount - 1}
              className="min-h-[44px] min-w-[44px]"
              aria-label="Next slide"
            >
              →
            </Button>
          </div>

          <p className="text-sm text-slate-600" data-testid="slide-counter">
            {`${activeIndex + 1} / ${slideCount}`}
          </p>

          <Button
            variant="secondary"
            onClick={toggleFullscreen}
            className="min-h-[44px]"
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </Button>
        </div>
      )}
    </section>
  );
}
