"use client";

// =============================================================================
// <ClassStatusBadge /> and <RealtimeStatusLine /> — the two status indicators.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// A "LIVE" INDICATOR IS THE EASIEST PLACE IN THIS WAVE TO FAIL WCAG 1.4.1, and
// the reason is that the conventional design IS a red dot. A red dot carries
// the entire meaning, is 3 mm across, and is invisible to a screen reader. Both
// components below therefore render the word — "Live", "Scheduled", "Ended" —
// and treat the dot as decoration (`aria-hidden` via the primitive's `dot`).
//
// THE PULSE RESPECTS `prefers-reduced-motion`. A permanently animating element
// in the corner of a page a student sits on for ninety minutes is a vestibular
// trigger and an attention sink. `motion-safe:` is the Tailwind variant that
// compiles to the media query; the dot keeps its colour and simply stops moving,
// which is the same trade the Skeleton primitive documents.
// =============================================================================

import * as React from "react";

import { Badge, cn } from "@/components/ui";
import type { RealtimeMode } from "@/lib/live-classes/use-realtime";

import type { ClassStatus } from "./types";

const STATUS_LABEL: Record<ClassStatus, string> = {
  scheduled: "Scheduled",
  active: "Live now",
  ended: "Ended",
  cancelled: "Cancelled",
};

const STATUS_TONE = {
  scheduled: "brand",
  active: "danger",
  ended: "neutral",
  cancelled: "warning",
} as const;

export interface ClassStatusBadgeProps {
  status: ClassStatus;
  className?: string;
}

export function ClassStatusBadge({ status, className }: ClassStatusBadgeProps) {
  const label = STATUS_LABEL[status] ?? status;
  return (
    <Badge
      tone={STATUS_TONE[status] ?? "neutral"}
      size="sm"
      dot
      className={cn(status === "active" && "motion-safe:animate-pulse", className)}
      data-testid="class-status-badge"
      data-status={status}
    >
      {label}
    </Badge>
  );
}

const MODE_TEXT: Record<RealtimeMode, string> = {
  unavailable: "Live updates are off. This page refreshes on a timer.",
  connecting: "Connecting to live updates…",
  live: "Live updates on.",
  reconnecting: "Reconnecting to live updates…",
  failed: "Live updates unavailable. This page refreshes on a timer.",
};

const MODE_TONE: Record<RealtimeMode, "neutral" | "success" | "warning"> = {
  unavailable: "neutral",
  connecting: "neutral",
  live: "success",
  reconnecting: "warning",
  failed: "warning",
};

export interface RealtimeStatusLineProps {
  mode: RealtimeMode;
  detail?: string | null;
  className?: string;
}

/**
 * Tells the student whether what they are reading is live.
 *
 * WHY THIS IS NOT HIDDEN WHEN EVERYTHING IS FINE. A chat that has silently
 * stopped updating looks exactly like a chat in which nobody is talking. In a
 * class of forty that ambiguity is the difference between "nobody answered me"
 * and "my question never arrived", so the state is always stated.
 *
 * `aria-live="polite"` rather than a `role="status"` wrapper elsewhere: the
 * transitions here are infrequent and the student should hear "reconnecting"
 * without being interrupted mid-sentence.
 */
export function RealtimeStatusLine({ mode, detail, className }: RealtimeStatusLineProps) {
  return (
    <p
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-2 text-xs text-ink-muted", className)}
      data-testid="realtime-status"
      data-mode={mode}
    >
      <Badge tone={MODE_TONE[mode]} size="sm" dot>
        {MODE_TEXT[mode]}
      </Badge>
      {detail && mode !== "live" && <span>{detail}</span>}
    </p>
  );
}
