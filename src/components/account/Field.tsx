// =============================================================================
// LABELLED FIELD — owned by the `account` stream.
// -----------------------------------------------------------------------------
// A label bound to its control with htmlFor/id, plus an optional hint wired
// through aria-describedby. Extracted because five forms in this stream repeat the
// same three-element pattern, and an unlabelled input is an accessibility defect
// that is invisible in a screenshot.
//
// Styling matches the login page's inputs deliberately: the auth pages are a set,
// and this stream adds three of them.
// =============================================================================

import * as React from "react";

import { cn } from "@/components/ui";

const INPUT_CLASSES =
  "rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export interface FieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Also used as the input's `name` unless `name` is given explicitly. */
  id: string;
  label: string;
  hint?: string;
}

export function Field({ id, label, hint, name, className, ...rest }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name ?? id}
        aria-describedby={hintId}
        className={cn(INPUT_CLASSES, className)}
        {...rest}
      />
      {hint ? (
        <span id={hintId} className="text-xs text-ink-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export interface TextAreaFieldProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
}

export function TextAreaField({
  id,
  label,
  hint,
  name,
  className,
  ...rest
}: TextAreaFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name ?? id}
        aria-describedby={hintId}
        className={cn(INPUT_CLASSES, "min-h-24 resize-y", className)}
        {...rest}
      />
      {hint ? (
        <span id={hintId} className="text-xs text-ink-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Read-only display of a value the user may not change (email, role). */
export function ReadOnlyField({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <span
        data-testid={`readonly-${label.toLowerCase().replace(/\s+/g, "-")}`}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted"
      >
        {value}
      </span>
      {note ? <span className="text-xs text-ink-muted">{note}</span> : null}
    </div>
  );
}
