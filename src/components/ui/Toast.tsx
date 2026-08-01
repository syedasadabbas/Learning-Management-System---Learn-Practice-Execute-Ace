"use client";

import * as React from "react";
import { MOTION_CLASS } from "@/lib/motion/tokens";
import { cn } from "./cn";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastProps {
  tone?: ToastTone;
  title?: string;
  /** Body text. Required — a toast with no message says nothing. */
  message: React.ReactNode;
  /**
   * Auto-dismiss delay in milliseconds. Omit (or pass 0) to keep it until the
   * user dismisses. Errors default to sticky: a message you can miss is not an
   * error report.
   */
  autoDismissMs?: number;
  onDismiss?: () => void;
  className?: string;
}

const TONE_CLASSES: Record<ToastTone, string> = {
  info: "bg-panel border-brand/40 text-ink",
  success: "bg-emerald-50 border-emerald-300 text-emerald-900",
  warning: "bg-amber-50 border-amber-300 text-amber-900",
  error: "bg-red-50 border-red-300 text-red-900",
};

const TONE_ICON: Record<ToastTone, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  error: "×",
};

export function Toast({
  tone = "info",
  title,
  message,
  autoDismissMs,
  onDismiss,
  className,
}: ToastProps) {
  // Assertive for problems the user must notice, polite otherwise — a
  // success toast must not interrupt a screen reader mid-sentence.
  const isUrgent = tone === "warning" || tone === "error";

  React.useEffect(() => {
    if (!autoDismissMs || autoDismissMs <= 0 || !onDismiss) return;
    const timer = setTimeout(onDismiss, autoDismissMs); // milliseconds
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  return (
    <div
      data-testid="toast"
      data-tone={tone}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      className={cn(
        "flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-md",
        // 250 ms fade + 8 px rise on mount (@keyframes ui-toast-in). A toast is
        // the one element in the app that appears without the user having moved
        // to it, so it is the one that most needs to read as arriving rather
        // than as having always been there.
        //
        // It does NOT gate anything: role=status/alert is announced from the DOM
        // insertion, so a screen-reader user hears the message on the same tick
        // regardless of the keyframe, and the autoDismissMs timer below starts
        // from mount too — a 6000 ms toast is visible for 6000 ms, not 5750.
        MOTION_CLASS.toastIn,
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
      >
        {TONE_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && "mt-0.5")}>{message}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className={cn(
            "-mr-1 shrink-0 cursor-pointer rounded px-1 text-lg leading-none opacity-70",
            "hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          )}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Fixed bottom-right stack for page-level toasts. */
export function ToastViewport({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="toast-viewport"
      className={cn(
        "pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2",
        "[&>*]:pointer-events-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
