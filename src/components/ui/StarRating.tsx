"use client";

import * as React from "react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { cn } from "./cn";

export type StarSize = "sm" | "md" | "lg";

export interface StarRatingProps {
  /** Current rating. 0 means "not rated yet". Clamped into 0..max. */
  value: number;
  /** Number of stars. The LMS grades out of 5 (see scoring.ts star rules). */
  max?: number;
  /**
   * Display-only mode: no buttons, no keyboard, clicks are inert.
   * Defaults to true when no `onChange` is supplied, so a read-only usage can
   * never accidentally look interactive.
   */
  readOnly?: boolean;
  onChange?: (value: number) => void;
  size?: StarSize;
  /** Accessible group name, e.g. "Week 2 assignment rating". */
  label?: string;
  /** Render "4 / 5" next to the stars. */
  showValue?: boolean;
  className?: string;
  /** Test hook on the wrapper so multiple ratings on one page stay separable. */
  testId?: string;
}

const SIZE_CLASSES: Record<StarSize, string> = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

function clampStars(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= max) return max;
  return Math.round(value);
}

function StarGlyph({ filled, size }: { filled: boolean; size: StarSize }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn(
        SIZE_CLASSES[size],
        // Tokens only: filled stars use the brand accent, empty stars the
        // neutral line colour with a visible outline so they read as "empty"
        // rather than "missing" for low-vision users.
        filled ? "text-accent" : "text-line",
      )}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
    >
      <path
        d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45L2.6 9.45l6.5-.95L12 2.6z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

export function StarRating({
  value,
  max = 5,
  readOnly,
  onChange,
  size = "md",
  label,
  showValue = false,
  className,
  testId = "star-rating",
}: StarRatingProps) {
  const isReadOnly = readOnly ?? !onChange;
  const current = clampStars(value, max);
  const stars = React.useMemo(
    () => Array.from({ length: max }, (_, i) => i + 1),
    [max],
  );
  const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Star the pointer/focus is currently over, 1-based; 0 for "none".
   *
   * WHY THIS EXISTS. The interaction this control is used for — an instructor
   * grading a submission — was previously blind: hovering the 4th star showed
   * nothing at all, so the only way to find out what a 4 looked like was to
   * commit a 4. The prospective fill is the animation that actually changes how
   * the control feels; the 110% hover scale that was already here only tells
   * you which star you are on, not what clicking it would mean.
   *
   * Deliberately NOT wired to aria-checked or to the group's data-value: the
   * preview is a visual affordance, and reporting a hover as a selection would
   * lie to assistive tech and to every test that reads data-value. Only
   * `commit` changes the value. The preview is exposed as `data-preview` purely
   * so it can be asserted.
   */
  const [preview, setPreview] = React.useState(0);

  const commit = React.useCallback(
    (next: number) => {
      if (isReadOnly) return;
      onChange?.(clampStars(next, max));
    },
    [isReadOnly, onChange, max],
  );

  // ---------------------------------------------------------------- read-only
  if (isReadOnly) {
    return (
      <span
        data-testid={testId}
        data-value={current}
        data-readonly="true"
        role="img"
        aria-label={`${label ? `${label}: ` : ""}${current} out of ${max} stars`}
        className={cn("inline-flex items-center gap-0.5", className)}
      >
        {stars.map((n) => (
          <span key={n} data-testid="star" data-value={n}>
            <StarGlyph filled={n <= current} size={size} />
          </span>
        ))}
        {showValue && (
          <span className="ml-1.5 text-sm tabular-nums text-ink-muted">
            {current} / {max}
          </span>
        )}
      </span>
    );
  }

  // -------------------------------------------------------------- interactive
  // ARIA radiogroup with roving tabindex: one tab stop for the whole control,
  // arrow keys move between stars, Enter/Space select (native button default).
  const focusIndex = current > 0 ? current - 1 : 0;
  // The preview wins over the committed value while it is active, so the stars
  // show what the pending click would produce — including when it is LOWER than
  // the current rating, which is the case that matters when correcting a 5 to
  // a 3 and the reason this is `preview || current` rather than a max().
  const shownValue = preview > 0 ? preview : current;

  function moveFocus(nextIndex: number) {
    const clamped = Math.min(Math.max(nextIndex, 0), max - 1);
    const target = buttonRefs.current[clamped];
    commit(clamped + 1);
    target?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      // `current` is a 1-based value; `moveFocus` takes a 0-based index, so
      // index `current` is the next star up and `current - 2` the next down.
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        moveFocus(current);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        moveFocus(current - 2);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(max - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      data-testid={testId}
      data-value={current}
      data-readonly="false"
      data-preview={preview}
      role="radiogroup"
      aria-label={label ?? `Rating out of ${max} stars`}
      onKeyDown={onKeyDown}
      // Cleared on the GROUP, not per star: leaving one star for the next fires
      // that star's enter before this one's leave in some browsers, so
      // per-button clearing flickers the preview off mid-sweep. Blur is handled
      // per button because focus does not bubble as focusout would need here.
      onPointerLeave={() => setPreview(0)}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {stars.map((n, i) => (
        <button
          key={n}
          ref={(el) => {
            buttonRefs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={n === current}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          tabIndex={i === focusIndex ? 0 : -1}
          data-testid="star"
          data-value={n}
          data-preview={n <= shownValue && n > current ? "true" : undefined}
          onClick={() => commit(n)}
          onPointerEnter={() => setPreview(n)}
          onFocus={() => setPreview(n)}
          onBlur={() => setPreview(0)}
          className={cn(
            // MOTION_CLASS.press gives the same 98% press as Button, so a star
            // and a button feel like the same product. `hover:scale-110` stays
            // and is unaffected: both are transforms on the same element, and
            // :active wins over :hover in the cascade, so the star grows on
            // hover and dips on press. Under reduced motion globals.css sets
            // transform:none for the press, and the blanket rule clamps the
            // hover scale's duration to 1 ms.
            "cursor-pointer rounded p-0.5",
            MOTION_CLASS.press,
            "hover:scale-110",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          )}
        >
          <StarGlyph filled={n <= shownValue} size={size} />
        </button>
      ))}
      {showValue && (
        <span className="ml-1.5 text-sm tabular-nums text-ink-muted">
          {current} / {max}
        </span>
      )}
    </div>
  );
}
