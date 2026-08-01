import * as React from "react";
import { Badge, type BadgeSize } from "./Badge";
import { cn } from "./cn";

export interface LockBadgeProps {
  /** True renders the locked state. Mirrors the `week_lock` enum in schema.ts. */
  locked: boolean;
  /**
   * Why it is locked (e.g. "Pass the Week 1 quiz to unlock"). Surfaced as the
   * title and folded into the accessible name — a padlock with no reason is a
   * dead end for the student.
   */
  reason?: string;
  size?: BadgeSize;
  /** Override the visible text; the accessible name still includes `reason`. */
  label?: string;
  className?: string;
}

function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      {locked ? (
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      ) : (
        <path d="M8 11V8a4 4 0 0 1 7.5-2" />
      )}
    </svg>
  );
}

export function LockBadge({
  locked,
  reason,
  size = "md",
  label,
  className,
}: LockBadgeProps) {
  const text = label ?? (locked ? "Locked" : "Unlocked");
  const accessibleName = reason ? `${text}. ${reason}` : text;

  return (
    <Badge
      tone={locked ? "neutral" : "success"}
      size={size}
      title={reason}
      aria-label={accessibleName}
      data-testid="lock-badge"
      data-locked={locked}
      className={cn(className)}
    >
      <LockGlyph locked={locked} />
      <span>{text}</span>
    </Badge>
  );
}
