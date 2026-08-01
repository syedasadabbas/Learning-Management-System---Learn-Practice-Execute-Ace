"use client";

// =============================================================================
// <SlideContentEditor /> — the per-type fields of one slide.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// ONE COMPONENT WITH A SWITCH, NOT SIX EXPORTED EDITORS. The union has six
// members and the discriminant is `type`; a switch over it is exhaustively
// checked by TypeScript, so adding a seventh slide variant to
// `src/lib/presentations/types.ts` makes THIS FILE fail to compile until it is
// handled. Six separate components with a lookup table gives a runtime
// `undefined` instead, in the editor, after the variant shipped.
//
// EVERY FIELD IS A CONTROLLED INPUT WITH A REAL <label>. No placeholder-as-label
// anywhere: a placeholder disappears on the first keystroke, is not announced as
// a name by several screen readers, and fails at the exact moment an author is
// mid-edit and wants to know what field they are in (WCAG 3.3.2).
//
// THE `alt` FIELD ON AN IMAGE SLIDE IS THE ONLY ONE WITH PERSISTENT HELP TEXT,
// because it is the only one whose emptiness is BOTH valid and usually wrong.
// The schema requires the field and permits `""` — the correct ARIA signal for
// decorative imagery — so validation cannot distinguish "deliberately
// decorative" from "author forgot". The help text is the only place that
// distinction can be made, so it is always visible rather than a tooltip.
//
// Bullets are edited as one textarea, one bullet per line. A list of N inputs
// with add/remove/reorder buttons is what the interaction wants to be, and it
// is also five more keyboard traps and a focus-management problem per slide; a
// textarea is operable by every input device on day one and is what authors
// paste into anyway.
// =============================================================================

import * as React from "react";

import { cn } from "@/components/ui";
import type { Slide, SlideColumn } from "@/lib/presentations/types";

export interface SlideContentEditorProps {
  slide: Slide;
  onChange: (slide: Slide) => void;
  className?: string;
}

const FIELD =
  "min-h-11 w-full rounded-md border border-line bg-panel p-2 text-sm text-ink";

/** One bullet per line, blanks dropped. Round-trips with `bulletsToText`. */
export function textToBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function bulletsToText(bullets: readonly string[] | undefined): string {
  return (bullets ?? []).join("\n");
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-xs text-ink-muted">
          {help}
        </p>
      )}
    </div>
  );
}

export function SlideContentEditor({ slide, onChange, className }: SlideContentEditorProps) {
  const base = React.useId();

  /**
   * Patch the slide while preserving its discriminant.
   *
   * Typed as a partial of the CONCRETE member rather than of `Slide`, so a
   * `bullets` patch cannot be applied to a quote slide.
   */
  function patch<T extends Slide>(current: T, changes: Partial<T>): void {
    onChange({ ...current, ...changes });
  }

  function patchColumn(
    current: Extract<Slide, { type: "two-column" }>,
    side: "left" | "right",
    changes: Partial<SlideColumn>,
  ): void {
    onChange({ ...current, [side]: { ...current[side], ...changes } });
  }

  switch (slide.type) {
    case "title":
      return (
        <div className={cn("flex flex-col gap-3", className)} data-testid="editor-title">
          <Field id={`${base}-title`} label="Title">
            <input
              id={`${base}-title`}
              className={FIELD}
              maxLength={200}
              value={slide.title}
              required
              onChange={(event) => patch(slide, { title: event.target.value })}
            />
          </Field>
          <Field id={`${base}-subtitle`} label="Subtitle (optional)">
            <input
              id={`${base}-subtitle`}
              className={FIELD}
              maxLength={300}
              value={slide.subtitle ?? ""}
              onChange={(event) => patch(slide, { subtitle: event.target.value })}
            />
          </Field>
        </div>
      );

    case "content":
      return (
        <div className={cn("flex flex-col gap-3", className)} data-testid="editor-content">
          <Field id={`${base}-title`} label="Heading (optional)">
            <input
              id={`${base}-title`}
              className={FIELD}
              maxLength={200}
              value={slide.title ?? ""}
              onChange={(event) => patch(slide, { title: event.target.value })}
            />
          </Field>
          <Field id={`${base}-body`} label="Body (optional)">
            <textarea
              id={`${base}-body`}
              rows={4}
              className={cn(FIELD, "resize-y")}
              maxLength={10_000}
              value={slide.body ?? ""}
              onChange={(event) => patch(slide, { body: event.target.value })}
            />
          </Field>
          <Field
            id={`${base}-bullets`}
            label="Bullets"
            help="One per line. Blank lines are ignored. Maximum 20."
          >
            <textarea
              id={`${base}-bullets`}
              rows={5}
              className={cn(FIELD, "resize-y")}
              aria-describedby={`${base}-bullets-help`}
              value={bulletsToText(slide.bullets)}
              onChange={(event) => patch(slide, { bullets: textToBullets(event.target.value) })}
            />
          </Field>
        </div>
      );

    case "code":
      return (
        <div className={cn("flex flex-col gap-3", className)} data-testid="editor-code">
          <Field id={`${base}-title`} label="Heading (optional)">
            <input
              id={`${base}-title`}
              className={FIELD}
              maxLength={200}
              value={slide.title ?? ""}
              onChange={(event) => patch(slide, { title: event.target.value })}
            />
          </Field>
          <Field
            id={`${base}-language`}
            label="Language"
            help="A highlight.js token, for example javascript, css, html or python."
          >
            <input
              id={`${base}-language`}
              className={FIELD}
              maxLength={40}
              required
              aria-describedby={`${base}-language-help`}
              aria-invalid={slide.language.trim().length === 0 || undefined}
              value={slide.language}
              onChange={(event) => patch(slide, { language: event.target.value })}
            />
          </Field>
          <Field id={`${base}-code`} label="Code">
            <textarea
              id={`${base}-code`}
              rows={10}
              className={cn(FIELD, "resize-y font-mono")}
              maxLength={20_000}
              value={slide.code}
              // spellCheck off: a red squiggle under every identifier makes code
              // genuinely harder to read, and the browser cannot spell-check it.
              spellCheck={false}
              onChange={(event) => patch(slide, { code: event.target.value })}
            />
          </Field>
          <Field id={`${base}-caption`} label="Caption (optional)">
            <input
              id={`${base}-caption`}
              className={FIELD}
              maxLength={500}
              value={slide.caption ?? ""}
              onChange={(event) => patch(slide, { caption: event.target.value })}
            />
          </Field>
        </div>
      );

    case "image":
      return (
        <div className={cn("flex flex-col gap-3", className)} data-testid="editor-image">
          <Field id={`${base}-title`} label="Heading (optional)">
            <input
              id={`${base}-title`}
              className={FIELD}
              maxLength={200}
              value={slide.title ?? ""}
              onChange={(event) => patch(slide, { title: event.target.value })}
            />
          </Field>
          <Field id={`${base}-src`} label="Image URL" help="Must be an http or https URL.">
            <input
              id={`${base}-src`}
              type="url"
              className={FIELD}
              required
              value={slide.src}
              aria-describedby={`${base}-src-help`}
              onChange={(event) => patch(slide, { src: event.target.value })}
            />
          </Field>
          <Field
            id={`${base}-alt`}
            label="Alternative text"
            help="Describe what the image shows, for someone who cannot see it. Leave EMPTY only if the image is decorative and repeating nothing that matters."
          >
            <input
              id={`${base}-alt`}
              className={FIELD}
              maxLength={500}
              value={slide.alt}
              aria-describedby={`${base}-alt-help`}
              onChange={(event) => patch(slide, { alt: event.target.value })}
            />
          </Field>
          <Field id={`${base}-caption`} label="Caption (optional)">
            <input
              id={`${base}-caption`}
              className={FIELD}
              maxLength={500}
              value={slide.caption ?? ""}
              onChange={(event) => patch(slide, { caption: event.target.value })}
            />
          </Field>
        </div>
      );

    case "two-column":
      return (
        <div className={cn("flex flex-col gap-3", className)} data-testid="editor-two-column">
          <Field id={`${base}-title`} label="Heading (optional)">
            <input
              id={`${base}-title`}
              className={FIELD}
              maxLength={200}
              value={slide.title ?? ""}
              onChange={(event) => patch(slide, { title: event.target.value })}
            />
          </Field>
          {(["left", "right"] as const).map((side) => (
            <fieldset key={side} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-medium capitalize text-ink">
                {`${side} column`}
              </legend>
              <Field id={`${base}-${side}-heading`} label="Heading">
                <input
                  id={`${base}-${side}-heading`}
                  className={FIELD}
                  maxLength={200}
                  value={slide[side].heading ?? ""}
                  onChange={(event) => patchColumn(slide, side, { heading: event.target.value })}
                />
              </Field>
              <Field id={`${base}-${side}-body`} label="Body">
                <textarea
                  id={`${base}-${side}-body`}
                  rows={3}
                  className={cn(FIELD, "resize-y")}
                  maxLength={5_000}
                  value={slide[side].body ?? ""}
                  onChange={(event) => patchColumn(slide, side, { body: event.target.value })}
                />
              </Field>
              <Field id={`${base}-${side}-bullets`} label="Bullets, one per line">
                <textarea
                  id={`${base}-${side}-bullets`}
                  rows={3}
                  className={cn(FIELD, "resize-y")}
                  value={bulletsToText(slide[side].bullets)}
                  onChange={(event) =>
                    patchColumn(slide, side, { bullets: textToBullets(event.target.value) })
                  }
                />
              </Field>
            </fieldset>
          ))}
        </div>
      );

    case "quote":
      return (
        <div className={cn("flex flex-col gap-3", className)} data-testid="editor-quote">
          <Field id={`${base}-quote`} label="Quote">
            <textarea
              id={`${base}-quote`}
              rows={4}
              className={cn(FIELD, "resize-y")}
              maxLength={2_000}
              required
              value={slide.quote}
              onChange={(event) => patch(slide, { quote: event.target.value })}
            />
          </Field>
          <Field id={`${base}-attribution`} label="Attribution (optional)">
            <input
              id={`${base}-attribution`}
              className={FIELD}
              maxLength={200}
              value={slide.attribution ?? ""}
              onChange={(event) => patch(slide, { attribution: event.target.value })}
            />
          </Field>
        </div>
      );
  }
}
