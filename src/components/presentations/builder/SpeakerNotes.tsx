"use client";

// =============================================================================
// <SpeakerNotes /> and <ThemeSelector /> — the two deck-level side controls.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// SPEAKER NOTES ARE PRESENTER-ONLY AND THE SERVER ENFORCES IT.
// `GET /api/presentations/:id` strips `speakerNotes` from `slidesJson` for every
// reader who is not the deck's creator or staff, and tells the client it did so
// via `speakerNotesIncluded`. This editor therefore renders the field ONLY when
// that flag is true — not because a hidden textarea would leak anything (there
// would be nothing in it), but because an editable field that silently discards
// what you type is worse than an absent one.
//
// THEMES ARE A FREE-TEXT COLUMN WITH NO ENUMERATION, TODAY.
// `themeSchema` is `z.string().min(1).max(50)` and the theme route's header
// says why, plus what to do about it: "TODO(presentations): when that module
// exports a `PRESENTATION_THEMES` list, validate against it." The consequence
// it names is real — "a typo'd theme is stored, Reveal silently ignores it, and
// the author sees 'my theme setting does nothing' with no error anywhere".
//
// This selector is the interim mitigation and it is deliberately a <select>,
// not a text input: an author using the UI cannot produce a typo, which closes
// the reported failure for every path except a hand-written API call. The list
// below is the editor's, NOT the contract's — `src/lib/presentations/theme.ts`
// derives its colours from `appConfig.branding` and exports no theme names, and
// this stream may not add one to it. When that list lands in the contract, this
// constant should be deleted and imported instead.
// =============================================================================

import * as React from "react";

import { cn } from "@/components/ui";

/**
 * Theme keys this editor offers. See the module header for why they live here.
 *
 * `lms` is the default in `deckMetadataSchema` and is the one the theming module
 * actually implements — the others are accepted by the column and are listed so
 * a deck can be tagged for a future stylesheet without a migration.
 */
export const EDITOR_THEMES = [
  { value: "lms", label: "LMS brand (default)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "high-contrast", label: "High contrast" },
] as const;

export interface ThemeSelectorProps {
  value: string;
  onChange: (theme: string) => void;
  className?: string;
}

export function ThemeSelector({ value, onChange, className }: ThemeSelectorProps) {
  const id = React.useId();
  // An unrecognised stored value must remain selectable, or opening a deck
  // themed by an older build silently rewrites it to "lms" on the next save.
  const known = EDITOR_THEMES.some((theme) => theme.value === value);

  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid="theme-selector">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Theme
      </label>
      <select
        id={id}
        className="min-h-11 w-full rounded-md border border-line bg-panel p-2 text-sm text-ink"
        value={value}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value)}
      >
        {!known && <option value={value}>{`${value} (not a built-in theme)`}</option>}
        {EDITOR_THEMES.map((theme) => (
          <option key={theme.value} value={theme.value}>
            {theme.label}
          </option>
        ))}
      </select>
      <p id={`${id}-help`} className="text-xs text-ink-muted">
        Slide colours come from the LMS brand palette. Only the default theme has a
        stylesheet today; the others are stored for a later release.
      </p>
    </div>
  );
}

export interface SpeakerNotesProps {
  value: string;
  onChange: (notes: string) => void;
  /** `speakerNotesIncluded` from the deck payload. See the module header. */
  editable: boolean;
  className?: string;
}

export function SpeakerNotes({ value, onChange, editable, className }: SpeakerNotesProps) {
  const id = React.useId();

  if (!editable) {
    return (
      <p className={cn("text-xs text-ink-muted", className)} data-testid="speaker-notes-hidden">
        Speaker notes are only visible to the person who created this deck.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid="speaker-notes">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Speaker notes
      </label>
      <textarea
        id={id}
        rows={4}
        maxLength={10_000}
        className="min-h-11 w-full resize-y rounded-md border border-line bg-panel p-2 text-sm text-ink"
        value={value}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-help`} className="text-xs text-ink-muted">
        Shown in presenter view and never on the projected slide.
      </p>
    </div>
  );
}
