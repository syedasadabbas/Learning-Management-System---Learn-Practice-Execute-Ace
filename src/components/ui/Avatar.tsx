import * as React from "react";
import { cn } from "./cn";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** Full name. Drives the initials fallback and the accessible name. */
  name: string;
  /** Optional image URL. Falls back to initials when absent. */
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-sm",
  lg: "size-12 text-base",
};

/**
 * First letter of the first and last name parts, upper-cased.
 * Falls back to "?" for an empty/whitespace name so the circle is never blank.
 */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  return (
    <span
      data-testid="avatar"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-brand/15 font-semibold text-brand select-none",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {src ? (
        // Plain <img>: avatars come from arbitrary external URLs, which
        // next/image would require whitelisting per host in next.config.ts —
        // a file this stream does not own.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden="true" data-testid="avatar-initials">
          {initialsFrom(name)}
        </span>
      )}
      {!src && <span className="sr-only">{name}</span>}
    </span>
  );
}
