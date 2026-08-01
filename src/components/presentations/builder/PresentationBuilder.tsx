"use client";

// =============================================================================
// <PresentationBuilder /> — the deck editor.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE SAVE IS ONE ATOMIC PUT OF THE WHOLE DOCUMENT, NOT PER-SLIDE WRITES.
//
// Both paths exist in the API. `PUT /api/presentations/:id` accepts
// `{ deck }` — `updatePresentationSchema.deck` — and its handler "replaces the
// whole document atomically and rebuilds `presentation_slides` from it", with a
// delete-then-insert rather than an upsert. There is also
// `PUT /slides/:slideNumber` for a single slide.
//
// This editor uses the whole-document path exclusively, because the per-slide
// one addresses a slide BY ITS 1-BASED NUMBER. An editor that reorders locally
// and then saves slide-by-slide sends its writes against numbers that have just
// changed meaning, and the handler's own comment names the failure the atomic
// path was built to avoid: "a save that REMOVED slide 7 leaves an orphan row an
// upsert would never touch, and `presentation_slides_number_idx` would then
// reject the next save that reused number 7." One PUT has none of that.
//
// EVERY MUTATION GOES THROUGH ./slide-ops.ts, which renumbers. See that file.
//
// UNSAVED-WORK PROTECTION. `beforeunload` when the deck is dirty. It is the only
// guard available — this component does not own routing and cannot intercept a
// Next.js client navigation — so it is honest about its limit: it catches a tab
// close or a reload, not an in-app link. The save button is also always enabled
// when dirty, rather than autosaving, because an autosave that fires against a
// half-typed image URL writes a broken slide.
//
// RESPONSIVE. Rail beside editor above `lg`; below it, the rail collapses into
// a disclosure above the editor. The rail is the part that cannot shrink — a
// thumbnail narrower than about 160 px is a grey square.
// =============================================================================

import * as React from "react";

import { LiveRegion, useAnnouncer } from "@/components/learn/visualizations/controls";
import { Badge, Button, Card, EmptyState, cn } from "@/components/ui";
import { apiPath, apiRequest } from "@/lib/client/api";
import {
  SLIDE_TYPES,
  emptyDeck,
  parseSlideDeck,
  type Slide,
  type SlideDeck,
  type SlideType,
} from "@/lib/presentations/types";

import {
  blankSlide,
  duplicateSlide,
  insertSlideAfter,
  moveSlide,
  newSlideId,
  removeSlide,
  replaceSlide,
} from "./slide-ops";
import { SlideEditor } from "./SlideEditor";
import { SlideThumbnails } from "./SlideThumbnails";
import { ThemeSelector } from "./SpeakerNotes";

const SAVE_ROUTE = "PUT  /api/presentations/:presentationId" as const;

export interface PresentationBuilderProps {
  presentationId: number;
  title: string;
  /** The deck as stored. Fetched by the page's server component. */
  initialDeck: SlideDeck;
  /** `speakerNotesIncluded` from the deck payload — the server's own answer. */
  notesEditable: boolean;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function PresentationBuilder({
  presentationId,
  title,
  initialDeck,
  notesEditable,
  className,
  fetchImpl,
}: PresentationBuilderProps) {
  const [deck, setDeck] = React.useState<SlideDeck>(initialDeck);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const { message, announce } = useAnnouncer();

  const editorHeadingRef = React.useRef<HTMLDivElement | null>(null);

  const update = React.useCallback((next: SlideDeck) => {
    setDeck(next);
    setDirty(true);
  }, []);

  const setSlides = React.useCallback(
    (slides: Slide[]) => update({ ...deck, slides }),
    [deck, update],
  );

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      // `preventDefault` is the modern spelling; `returnValue` is what older
      // browsers actually honour. Both, because losing a deck is unrecoverable.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const clampedIndex = Math.min(activeIndex, Math.max(deck.slides.length - 1, 0));
  const activeSlide = deck.slides[clampedIndex];

  /** Move focus to the editor after a rail action, so the change is findable. */
  function focusEditor(): void {
    // requestAnimationFrame, not a bare call: the target does not exist until
    // React has committed the new slide.
    requestAnimationFrame(() => editorHeadingRef.current?.focus());
  }

  function addSlide(type: SlideType): void {
    const next = insertSlideAfter(deck.slides, clampedIndex, blankSlide(type, newSlideId()));
    setSlides(next);
    setActiveIndex(Math.min(clampedIndex + 1, next.length - 1));
    announce(`${type} slide added at position ${clampedIndex + 2}.`);
    focusEditor();
  }

  function move(from: number, to: number): void {
    setSlides(moveSlide(deck.slides, from, to));
    setActiveIndex(to);
    announce(`Slide moved to position ${to + 1} of ${deck.slides.length}.`);
  }

  function duplicate(index: number): void {
    setSlides(duplicateSlide(deck.slides, index, newSlideId()));
    setActiveIndex(index + 1);
    announce(`Slide ${index + 1} duplicated.`);
    focusEditor();
  }

  function remove(index: number): void {
    const next = removeSlide(deck.slides, index);
    setSlides(next);
    // Clamped so deleting the last slide selects the new last one rather than
    // addressing past the end.
    setActiveIndex(Math.min(index, Math.max(next.length - 1, 0)));
    announce(`Slide ${index + 1} deleted. ${next.length} slides remain.`);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);

    // Validated locally BEFORE the request. The route would answer 422, but the
    // message it returns names a zod path; this one names the slide.
    const parsed = parseSlideDeck(deck);
    if (!parsed.ok) {
      setSaving(false);
      const text = `This deck cannot be saved yet: ${parsed.errors[0]}`;
      setSaveError(text);
      announce(text);
      return;
    }

    const result = await apiRequest<unknown>(
      SAVE_ROUTE,
      apiPath(SAVE_ROUTE, { presentationId }),
      { body: { deck: parsed.value }, fetchImpl },
    );
    setSaving(false);

    if (!result.ok) {
      if (result.aborted) return;
      setSaveError(result.error);
      announce(`The deck was not saved. ${result.error}`);
      return;
    }

    setDirty(false);
    announce("Deck saved.");
  }

  const rail = (
    <div className="flex flex-col gap-3">
      <ThemeSelector
        value={deck.metadata.theme}
        onChange={(theme) => update({ ...deck, metadata: { ...deck.metadata, theme } })}
      />

      <div role="group" aria-label="Add a slide" className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">Add a slide</p>
        <div className="flex flex-wrap gap-1">
          {SLIDE_TYPES.map((type) => (
            <Button key={type} variant="secondary" size="sm" onClick={() => addSlide(type)}>
              {type}
            </Button>
          ))}
        </div>
      </div>

      {deck.slides.length > 0 && (
        <SlideThumbnails
          deck={deck}
          activeIndex={clampedIndex}
          onSelect={(index) => {
            setActiveIndex(index);
            focusEditor();
          }}
          onMove={move}
          onDuplicate={duplicate}
          onDelete={remove}
        />
      )}
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="presentation-builder">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={dirty ? "warning" : "success"} size="sm">
            {dirty ? "Unsaved changes" : "Saved"}
          </Badge>
          <Button
            variant="primary"
            size="md"
            loading={saving}
            disabled={saving || !dirty}
            onClick={() => void save()}
            data-testid="save-deck"
          >
            Save deck
          </Button>
        </div>
      </header>

      {saveError && (
        <p role="alert" className="text-sm text-ink" data-testid="save-error">
          {saveError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Below lg the rail is a disclosure, so the editor is what a phone
            shows first. Above lg the same tree is always visible — one rail,
            not two, so there is no duplicated state. */}
        <div>
          <Button
            variant="secondary"
            size="sm"
            className="mb-2 w-full lg:hidden"
            aria-expanded={railOpen}
            aria-controls="builder-rail"
            onClick={() => setRailOpen((open) => !open)}
          >
            {railOpen ? "Hide the slide list" : `Slides (${deck.slides.length})`}
          </Button>
          <div id="builder-rail" className={cn(railOpen ? "block" : "hidden", "lg:block")}>
            {rail}
          </div>
        </div>

        <div ref={editorHeadingRef} tabIndex={-1}>
          {activeSlide ? (
            <SlideEditor
              deck={deck}
              slide={activeSlide}
              position={clampedIndex + 1}
              notesEditable={notesEditable}
              onChange={(slide) => setSlides(replaceSlide(deck.slides, clampedIndex, slide))}
            />
          ) : (
            <Card padded>
              <EmptyState
                title="This deck has no slides"
                description="Add one from the slide list to begin."
                action={
                  <Button variant="primary" size="md" onClick={() => addSlide("title")}>
                    Add a title slide
                  </Button>
                }
              />
            </Card>
          )}
        </div>
      </div>

      <LiveRegion message={message} testId="builder-live-region" />
    </div>
  );
}

/** A brand-new empty deck, for a page creating a presentation from scratch. */
export function newDeck(): SlideDeck {
  return emptyDeck();
}
