import * as React from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  /** Decorative glyph or illustration. Rendered aria-hidden. */
  icon?: React.ReactNode;
  /** Primary call to action — usually a <Button> or a link. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line",
        "bg-panel px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <div aria-hidden="true" className="mb-1 text-ink-muted opacity-70">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && (
        <p className="max-w-prose text-sm text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
