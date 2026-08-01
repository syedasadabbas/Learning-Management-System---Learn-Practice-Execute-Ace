"use client";

// =============================================================================
// <SlideThumbnails /> — the slide rail: select, reorder, duplicate, delete.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// REORDERING IS BUTTONS, NOT DRAG AND DROP, AND THAT IS THE DELIBERATE CHOICE.
//
// Drag and drop is the expected interaction and it is inaccessible by default:
// HTML5 drag events do not fire for keyboard users at all, and the WAI-ARIA
// pattern that makes a sortable list keyboard-operable is a grab/move/drop mode
// with its own live-region narration — a substantial component in its own right,
// and one that this stream would be building from scratch with no primitive to
// lean on. Explicit "move up" / "move down" buttons are operable by mouse,
// touch, keyboard and switch on day one, each is a 44 px target, and each
// announces its effect. When a sortable primitive exists in the design system,
// drag can be ADDED alongside these buttons; it must not replace them.
//
// THUMBNAILS ARE `<RevealPresentation readOnly>` — the existing viewer, in its
// documented preview mode, which renders one static slide with no engine
// chrome. A second miniature renderer would be a second place for a slide type
// to look different from how it will actually present, which is the one thing a
// thumbnail must never do.
//
// EACH THUMBNAIL IS ONE BUTTON PLUS A TOOLBAR, not a clickable div wrapping
// buttons. Nesting interactive elements produces a control a screen reader
// cannot describe and a keyboard user cannot reach the inner half of.
// =============================================================================

import * as React from "react";

import { RevealPresentation } from "@/components/presentations/RevealPresentation";
import { Button, cn } from "@/components/ui";
import { slideLabel, type Slide, type SlideDeck } from "@/lib/presentations/types";

export interface SlideThumbnailsProps {
  deck: SlideDeck;
  /** 0-based index of the slide being edited. */
  activeIndex: number;
  onSelect: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  className?: string;
}

/** A one-slide deck, so the viewer renders exactly this slide in preview mode. */
function singleSlideDeck(deck: SlideDeck, slide: Slide): SlideDeck {
  // `slideNumber: 1` because the preview deck has one slide; the real number is
  // shown in the caption beside it, from the parent's index.
  return { ...deck, slides: [{ ...slide, slideNumber: 1 }] };
}

export function SlideThumbnails({
  deck,
  activeIndex,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
  className,
}: SlideThumbnailsProps) {
  const last = deck.slides.length - 1;

  return (
    <nav
      aria-label="Slides"
      className={cn("flex flex-col gap-2", className)}
      data-testid="slide-thumbnails"
    >
      <ol className="flex flex-col gap-2">
        {deck.slides.map((slide, index) => {
          const isActive = index === activeIndex;
          const label = slideLabel(slide);
          return (
            <li key={slide.id}>
              <div
                className={cn(
                  "rounded-lg border p-2",
                  isActive ? "border-brand bg-brand/5" : "border-line",
                )}
                data-testid={`thumbnail-${index}`}
                data-active={isActive || undefined}
              >
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  // aria-current rather than aria-selected: this is a navigation
                  // list, not a tablist, and aria-selected outside a
                  // composite widget is ignored by most screen readers.
                  aria-current={isActive ? "true" : undefined}
                  className="flex w-full min-h-11 flex-col gap-1 text-left"
                >
                  <span className="text-xs font-semibold text-ink">
                    {`${index + 1}. ${label}`}
                  </span>
                  <span
                    // The rendered preview is decorative here — the text label
                    // above already names the slide, and announcing the slide's
                    // whole body inside a navigation button makes the rail
                    // unusable with a screen reader.
                    aria-hidden="true"
                    className="pointer-events-none block overflow-hidden rounded border border-line"
                  >
                    <RevealPresentation
                      deck={singleSlideDeck(deck, slide)}
                      readOnly
                      hideChrome
                      className="text-[6px]"
                    />
                  </span>
                </button>

                <div
                  role="group"
                  aria-label={`Actions for slide ${index + 1}, ${label}`}
                  className="mt-2 flex flex-wrap gap-1"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                    aria-label={`Move slide ${index + 1} up`}
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === last}
                    onClick={() => onMove(index, index + 1)}
                    aria-label={`Move slide ${index + 1} down`}
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDuplicate(index)}
                    aria-label={`Duplicate slide ${index + 1}`}
                  >
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(index)}
                    aria-label={`Delete slide ${index + 1}, ${label}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
