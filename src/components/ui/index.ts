// =============================================================================
// UI PRIMITIVE BARREL — the contract ui-shell exposes to every other stream.
// -----------------------------------------------------------------------------
// Import from "@/components/ui" only. Do not deep-import a file and do not fork
// styles per page: a second Button implementation is how a design system dies.
// Colours come from the design tokens in src/app/globals.css, which mirror
// src/lib/config/app.config.ts -> branding.colors. No component hardcodes hex.
// Owner: ui-shell stream.
// =============================================================================

export { cn } from "./cn";

export { Button, buttonClasses } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Card } from "./Card";
export type { CardProps } from "./Card";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone, BadgeSize } from "./Badge";

export { ProgressBar, clampPercent } from "./ProgressBar";
export type { ProgressBarProps, ProgressTone, ProgressSize } from "./ProgressBar";

export { StarRating } from "./StarRating";
export type { StarRatingProps, StarSize } from "./StarRating";

export { LockBadge } from "./LockBadge";
export type { LockBadgeProps } from "./LockBadge";

export { Avatar, initialsFrom } from "./Avatar";
export type { AvatarProps, AvatarSize } from "./Avatar";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Skeleton, SkeletonBar } from "./Skeleton";
export type { SkeletonProps, SkeletonShape } from "./Skeleton";

export { Toast, ToastViewport } from "./Toast";
export type { ToastProps, ToastTone } from "./Toast";
