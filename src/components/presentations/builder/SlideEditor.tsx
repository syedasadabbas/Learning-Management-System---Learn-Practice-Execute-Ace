"use client";

// =============================================================================
// <SlideEditor /> — one slide: type, content, notes, and a live preview.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// CHANGING A SLIDE'S TYPE IS A DESTRUCTIVE OPERATION AND IS TREATED AS ONE.
// The variants share only `id`, `slideNumber`, `speakerNotes`,
// `backgroundColor` and `transition`; a title slide's `subtitle` has nowhere to
// go in a code slide. So the type control carries a confirmation and the base
// fields are carried across explicitly — silently dropping an author's text
// because they clicked the wrong option in a select is not recoverable, since
// there is no undo in this editor.
//
// THE PREVIEW VALIDATES CONTINUOUSLY BUT DOES NOT BLOCK. `parseSlide` runs on
// every change; a slide that fails renders its errors and the LAST GOOD preview
// is kept. That behaviour is what `ParseResult` was designed for — its doc says
// "the editor's live preview wants to keep showing the last good render while
// the author is mid-keystroke". A preview that blanks out while you type a URL
// is worse than no preview.
//
// The save button in the parent is what refuses an invalid deck. This component
// reports validity upward and does not disable anything itself.
// =============================================================================

import * as React from "react";

import { RevealPresentation } from "@/components/presentations/RevealPresentation";
import { Badge, Card, cn } from "@/components/ui";
import {
  SLIDE_TYPES,
  parseSlide,
  type Slide,
  type SlideDeck,
  type SlideType,
} from "@/lib/presentations/types";

import { blankSlide } from "./slide-ops";
import { SlideContentEditor } from "./SlideContentEditor";
import { SpeakerNotes } from "./SpeakerNotes";

const TYPE_LABEL: Record<SlideType, string> = {
  title: "Title",
  content: "Content",
  code: "Code",
  image: "Image",
  "two-column": "Two columns",
  quote: "Quote",
};

export interface SlideEditorProps {
  deck: SlideDeck;
  slide: Slide;
  /** 1-based, for the heading. Comes from the deck position, not the slide field. */
  position: number;
  onChange: (slide: Slide) => void;
  /** From the deck payload's `speakerNotesIncluded`. */
  notesEditable: boolean;
  /** Reports whether the slide currently validates, so the parent can gate save. */
  onValidityChange?: (valid: boolean) => void;
  className?: string;
}

export function SlideEditor({
  deck,
  slide,
  position,
  onChange,
  notesEditable,
  onValidityChange,
  className,
}: SlideEditorProps) {
  const typeId = React.useId();
  const parsed = React.useMemo(() => parseSlide(slide), [slide]);

  // The last slide that parsed, so the preview survives a mid-keystroke invalid
  // state. Seeded from the first parse; never cleared.
  const lastGood = React.useRef<Slide | null>(parsed.ok ? parsed.value : null);
  if (parsed.ok) lastGood.current = parsed.value;

  React.useEffect(() => {
    onValidityChange?.(parsed.ok);
  }, [onValidityChange, parsed.ok]);

  function changeType(next: SlideType): void {
    if (next === slide.type) return;
    // `confirm` rather than a bespoke dialog: a modal needs a focus trap, an
    // Escape handler and focus restoration to be accessible, and the native one
    // has all three plus screen-reader support. It is the right primitive for a
    // yes/no with no custom content, and there is no dialog primitive in the
    // house design system to compose instead.
    const proceed =
      typeof window === "undefined" ||
      window.confirm(
        `Change this slide from ${TYPE_LABEL[slide.type]} to ${TYPE_LABEL[next]}? Fields that do not exist on the new type will be lost.`,
      );
    if (!proceed) return;

    const fresh = blankSlide(next, slide.id);
    onChange({
      ...fresh,
      slideNumber: slide.slideNumber,
      // Carried across explicitly — these five are the only fields every
      // variant shares, and losing an author's speaker notes to a type change
      // would be gratuitous.
      speakerNotes: slide.speakerNotes,
      backgroundColor: slide.backgroundColor,
      transition: slide.transition,
    });
  }

  const previewDeck: SlideDeck | null =
    lastGood.current === null
      ? null
      : { ...deck, slides: [{ ...lastGood.current, slideNumber: 1 }] };

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="slide-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{`Slide ${position}`}</h2>
        <Badge tone={parsed.ok ? "success" : "warning"} size="sm">
          {parsed.ok ? "Valid" : "Not ready to save"}
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={typeId} className="text-sm font-medium text-ink">
          Slide type
        </label>
        <select
          id={typeId}
          className="min-h-11 w-full rounded-md border border-line bg-panel p-2 text-sm text-ink"
          value={slide.type}
          onChange={(event) => changeType(event.target.value as SlideType)}
        >
          {SLIDE_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </div>

      <SlideContentEditor slide={slide} onChange={onChange} />

      <SpeakerNotes
        editable={notesEditable}
        value={slide.speakerNotes ?? ""}
        onChange={(notes) => onChange({ ...slide, speakerNotes: notes })}
      />

      {!parsed.ok && (
        <div
          role="alert"
          className="rounded-md border border-dashed border-line bg-panel p-3 text-sm"
          data-testid="slide-errors"
        >
          <p className="font-semibold text-ink">This slide cannot be saved yet</p>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {parsed.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <Card title="Preview" padded data-testid="slide-preview">
        {previewDeck ? (
          <RevealPresentation deck={previewDeck} readOnly hideChrome title={`Slide ${position}`} />
        ) : (
          <p className="text-sm text-ink-muted">
            Fill in the required fields above and the preview will appear here.
          </p>
        )}
      </Card>
    </div>
  );
}
