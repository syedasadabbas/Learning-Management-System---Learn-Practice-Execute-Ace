"use client";

// =============================================================================
// EXAM COUNTDOWN — presentation only. Invariant I2's client half.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// WHAT THIS COMPONENT IS FOR, AND WHAT IT IS NOT FOR.
//
// It is for showing a student how long they have left. It is NOT a timer the
// server trusts. Everything it renders derives from the `CountdownSeed` the server
// sent, and it sends nothing back except one fact — "the countdown reached zero" —
// via `onExpire`, which the server treats as a hint and re-derives from the stored
// deadline anyway (see the submit route).
//
// THE SKEW CORRECTION, and why it exists.
//
// A naive countdown does `deadlineAtMs - Date.now()`. `Date.now()` is the DEVICE's
// clock, so a laptop 40 minutes slow renders 40 spare minutes — the student
// believes they have time, keeps working, and their answers are refused. That is
// an unrecoverable loss on a one-attempt exam, and the cause is not the student's
// fault. So the seed carries `serverNowMs`, this component measures the offset
// between it and the device clock ONCE, and every later tick applies that offset.
// The remaining error is the network round trip, which is milliseconds.
//
// The correction cannot be exploited: it only changes what is DISPLAYED. Forging
// `serverNowMs` in devtools buys extra numbers on a screen and no extra time,
// because the deadline that decides anything lives in the database.
//
// ACCESSIBILITY. The countdown is a live region that announces at coarse
// intervals, not every second: `aria-live` on a per-second ticker makes a screen
// reader unusable for the whole two hours. Warnings at 10 and 5 minutes and the
// final minute are announced; the rest is polite silence.
//
// Durations in milliseconds (house rule 5).
// =============================================================================

import * as React from "react";

import { Badge } from "@/components/ui";
import type { CountdownSeed } from "@/lib/grand-quiz";

export interface ExamCountdownProps {
  seed: CountdownSeed;
  /**
   * Called once when the countdown reaches zero. Expiry trigger 1 of 3.
   *
   * Fires AT MOST ONCE per mount, guarded by a ref rather than by state, because a
   * re-render must not be able to fire a second submit. The server would replay
   * the same result anyway (I3), but a duplicate request at the end of an exam is
   * still latency the student is watching.
   */
  onExpire?: () => void;
}

/** How often the display refreshes, in milliseconds. */
const TICK_MS = 1_000;

/** Thresholds (ms remaining) at which the time left is announced to a screen reader. */
const ANNOUNCE_AT_MS = [10 * 60_000, 5 * 60_000, 60_000];

export function ExamCountdown({ seed, onExpire }: ExamCountdownProps) {
  /**
   * device clock − server clock, in milliseconds. Measured once on mount from the
   * seed, then held: re-measuring on every render would let a clock that drifts
   * mid-exam jitter the display.
   */
  const skewMsRef = React.useRef<number>(Date.now() - seed.serverNowMs);
  const firedRef = React.useRef(false);
  const [remaining, setRemaining] = React.useState<number | null>(seed.remainingMs);

  React.useEffect(() => {
    if (seed.deadlineAtMs == null) return;
    const deadlineAtMs = seed.deadlineAtMs;
    const skewMs = skewMsRef.current;

    function tick(): void {
      // Device clock, corrected back onto the server's timeline.
      const serverNowMs = Date.now() - skewMs;
      const left = Math.max(0, deadlineAtMs - serverNowMs);
      setRemaining(left);
      if (left === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    }

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [seed.deadlineAtMs, onExpire]);

  // An already-expired seed fires immediately: the server has told us the exam is
  // over, so waiting a second to say so serves nobody.
  React.useEffect(() => {
    if (seed.expired && !firedRef.current) {
      firedRef.current = true;
      onExpire?.();
    }
  }, [seed.expired, onExpire]);

  if (remaining == null) {
    return (
      <Badge tone="neutral" data-testid="exam-countdown">
        No time limit
      </Badge>
    );
  }

  const tone = remaining <= 5 * 60_000 ? "danger" : remaining <= 10 * 60_000 ? "warning" : "brand";

  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={tone} data-testid="exam-countdown" data-remaining-ms={remaining}>
        {formatRemaining(remaining)} left
      </Badge>
      {/*
        The announcer is separate from the visible badge so the badge can update
        every second while announcements stay at the coarse thresholds above.
      */}
      <span className="sr-only" role="status" aria-live="polite" data-testid="exam-countdown-announce">
        {announcementFor(remaining)}
      </span>
    </span>
  );
}

/** `h:mm:ss`, or `mm:ss` under an hour. Zero-padded so the width does not jump. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Prose for the live region, or "" between thresholds.
 *
 * Returning "" rather than the current time is what keeps the region quiet: a
 * live region only announces when its content CHANGES, so an unchanged empty
 * string produces silence for the minutes in between.
 */
function announcementFor(remainingMs: number): string {
  if (remainingMs === 0) return "Time is up. Your exam is being submitted.";
  for (const threshold of ANNOUNCE_AT_MS) {
    // Announce inside the one-tick window as each threshold is crossed.
    if (remainingMs <= threshold && remainingMs > threshold - TICK_MS) {
      const minutes = Math.round(threshold / 60_000);
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining.`;
    }
  }
  return "";
}
