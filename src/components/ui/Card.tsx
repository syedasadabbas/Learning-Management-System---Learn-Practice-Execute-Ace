import * as React from "react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { cn } from "./cn";

// `title` is omitted from the DOM attributes and re-declared as ReactNode: a
// card heading can be rich content, whereas the HTML title attribute is a
// tooltip string. Callers wanting a tooltip should pass `aria-describedby`.
export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional heading rendered in the card header. */
  title?: React.ReactNode;
  /** Secondary line under the title. */
  subtitle?: React.ReactNode;
  /** Right-aligned header slot (badges, menus). */
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** Adds a hover lift — only for cards that are themselves links/buttons. */
  interactive?: boolean;
  padded?: boolean;
}

export function Card({
  title,
  subtitle,
  action,
  footer,
  interactive = false,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = Boolean(title || subtitle || action);

  return (
    <div
      data-testid="card"
      data-interactive={interactive || undefined}
      className={cn(
        "rounded-lg border border-line bg-panel text-ink shadow-sm",
        // MOTION_CLASS.lift replaces the old `transition-shadow duration-150`
        // and adds 2 px of travel. The shadow step on its own (shadow-sm ->
        // shadow-md, both very light on a white panel over the #f4f4f6 surface)
        // was close to invisible, so week cards and lecture cards — which ARE
        // whole-card links — gave almost no hover affordance. The class also
        // owns the reduced-motion branch, which a Tailwind `hover:-translate-y`
        // utility could not: the global blanket can only make the hop fast, and
        // a 1 ms hop is still a card jumping under the pointer. See globals.css.
        interactive &&
          `${MOTION_CLASS.lift} hover:shadow-md focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand`,
        className,
      )}
      {...rest}
    >
      {hasHeader && (
        <div
          className={cn(
            "flex items-start justify-between gap-3 border-b border-line",
            padded ? "px-4 py-3" : "p-0",
          )}
        >
          <div className="min-w-0">
            {title && (
              <h3 className="truncate text-base font-semibold">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}

      <div className={cn(padded && "p-4")}>{children}</div>

      {footer && (
        <div
          className={cn(
            "border-t border-line text-sm text-ink-muted",
            padded ? "px-4 py-3" : "p-0",
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
