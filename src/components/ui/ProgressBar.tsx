import * as React from "react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { cn } from "./cn";

export type ProgressTone = "brand" | "accent" | "success" | "danger";
export type ProgressSize = "sm" | "md" | "lg";

export interface ProgressBarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "role"> {
  /** Completion percentage. Values outside 0..100 are clamped, NaN becomes 0. */
  percent: number;
  /** Visible label above the track. Also used as the accessible name. */
  label?: string;
  /** Show the numeric percentage on the right of the label row. */
  showValue?: boolean;
  tone?: ProgressTone;
  size?: ProgressSize;
  /** Accessible name when no visible `label` is rendered. */
  ariaLabel?: string;
  /**
   * Grow the fill from zero on mount. Default on.
   *
   * Pass false where a bar is one row of a long list that the user scrolls into
   * repeatedly, or where several bars sit in a table — a dozen bars all sweeping
   * at once is a wave, not polish. It is a per-call-site judgement, which is why
   * it is a prop and not a global.
   */
  animateFill?: boolean;
}

/**
 * Clamp an arbitrary number into 0..100 and round to a whole percent.
 *
 * Callers pass computed values (score / max * 100) which can legitimately come
 * back as NaN when max is 0, or as >100 with bonus points. A progress bar
 * rendering a negative or 640% wide fill is a visual bug, and an
 * `aria-valuenow="NaN"` is an accessibility bug — so both are handled here
 * rather than at every call site.
 */
export function clampPercent(value: number): number {
  // NaN is the only value with no sensible position on the scale (it compares
  // false against every bound), so it reads as "no progress". Infinities are
  // just extreme out-of-range input and clamp like any other.
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

const TONE_CLASSES: Record<ProgressTone, string> = {
  brand: "bg-brand",
  accent: "bg-accent",
  success: "bg-emerald-600",
  danger: "bg-red-600",
};

const SIZE_CLASSES: Record<ProgressSize, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
};

export function ProgressBar({
  percent,
  label,
  showValue = true,
  tone = "brand",
  size = "md",
  ariaLabel,
  animateFill = true,
  className,
  ...rest
}: ProgressBarProps) {
  const safe = clampPercent(percent);
  const accessibleName = ariaLabel ?? label ?? "Progress";

  return (
    <div className={cn("w-full", className)} {...rest}>
      {(label || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
          {label && <span className="font-medium text-ink">{label}</span>}
          {showValue && (
            <span className="tabular-nums text-ink-muted">{safe}%</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={accessibleName}
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${safe}%`}
        data-testid="progress-bar"
        className={cn(
          "w-full overflow-hidden rounded-full bg-line",
          SIZE_CLASSES[size],
        )}
      >
        {/* Width is data-driven, so it must be an inline style; the colour is
            still a token class. 300 ms easing on a client-side value change.

            The `transition-[width]` alone was doing nothing on a real page: the
            inline width is server-rendered at its final value and no page in the
            app mutates `percent` after mount, so the bar was painted at 62% and
            never animated. MOTION_CLASS.progressFill adds the missing half — a
            single 400 ms grow from zero on mount (@keyframes ui-progress-fill in
            globals.css) — while the transition stays for the client-updated case
            that will exist as soon as a quiz result updates a bar in place.

            aria-valuenow on the parent carries the FINAL value from the first
            render, so assistive tech is never told 0% while the fill sweeps, and
            nothing here delays the label or the number becoming readable. */}
        <div
          data-testid="progress-bar-fill"
          data-animated={animateFill}
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            animateFill && MOTION_CLASS.progressFill,
            TONE_CLASSES[tone],
          )}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
