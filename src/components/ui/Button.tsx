import * as React from "react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { cn } from "./cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "ghost"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and blocks interaction. */
  loading?: boolean;
  fullWidth?: boolean;
}

// Colours come exclusively from the design tokens in globals.css, which mirror
// app.config branding.colors. No hex literal may appear in this file.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90 active:bg-brand/80",
  secondary:
    "bg-panel text-ink border border-line hover:bg-surface active:bg-line/40",
  // accent is a light yellow: pairs with ink, never with white (1.8:1).
  accent: "bg-accent text-ink hover:bg-accent/85 active:bg-accent/75",
  ghost: "bg-transparent text-brand hover:bg-brand/10 active:bg-brand/20",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

// The press response (MOTION_CLASS.press, a 98% scale while :active) is part of
// BASE_CLASSES rather than of the <button> branch below on purpose: the whole
// point of `buttonClasses` is that a navigation <a> is visually the same
// control, and a link that does not respond to a press when the button next to
// it does is exactly the kind of inconsistency a design system exists to stop.
// The rule is scoped `:active:not(:disabled)` in globals.css, so a disabled or
// loading button — which sets the disabled attribute — stays inert, and it is
// switched off entirely under prefers-reduced-motion.
const BASE_CLASSES = [
  "inline-flex items-center justify-center rounded-md font-medium",
  // NOTE: `transition-colors duration-150` used to be here. It moved INTO
  // .ui-press (globals.css), which now transitions colour AND transform in one
  // declaration at the same 150 ms — MOTION_MS.fast. Do not re-add it: an
  // unlayered `transition` in globals.css overrides a Tailwind utility, so the
  // two would fight and the colour fade would be the one that lost.
  MOTION_CLASS.press,
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

/**
 * The Button look as a class string, for the cases where the element must NOT
 * be a <button>: a navigation target has to be an <a>/<Link> for middle-click,
 * "open in new tab" and screen-reader link semantics, and nesting an <a> inside
 * a <button> is invalid HTML. Sharing the class source here keeps those links
 * from forking the styles.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], extra);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled = false,
      className,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    // `loading` must block clicks too, otherwise a double-submit slips through.
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={loading || undefined}
        data-variant={variant}
        data-size={size}
        className={cn(
          BASE_CLASSES,
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          !isDisabled && "cursor-pointer",
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {children}
      </button>
    );
  },
);
