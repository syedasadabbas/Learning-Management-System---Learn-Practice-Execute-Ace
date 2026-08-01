import * as React from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "brand"
  | "accent"
  | "neutral"
  | "success"
  | "warning"
  | "danger";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Small leading dot — useful for status lists. */
  dot?: boolean;
}

// Token-only colours. `accent` keeps ink text (white on accent is 1.8:1).
const TONE_CLASSES: Record<BadgeTone, string> = {
  brand: "bg-brand/10 text-brand border-brand/30",
  accent: "bg-accent/30 text-ink border-accent",
  neutral: "bg-surface text-ink-muted border-line",
  success: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warning: "bg-amber-50 text-amber-900 border-amber-300",
  danger: "bg-red-50 text-red-800 border-red-300",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "text-[11px] px-1.5 py-0.5 gap-1",
  md: "text-xs px-2 py-0.5 gap-1.5",
};

export function Badge({
  tone = "neutral",
  size = "md",
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      data-testid="badge"
      data-tone={tone}
      className={cn(
        "inline-flex items-center rounded-full border font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-current opacity-70"
        />
      )}
      {children}
    </span>
  );
}
