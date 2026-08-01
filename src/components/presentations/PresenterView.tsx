"use client";

// =============================================================================
// <PresenterView /> — what the speaker sees
// -----------------------------------------------------------------------------
// Current slide, next slide, speaker notes, elapsed time.
//
// It renders slides through RevealPresentation in `readOnly` mode rather than
// initializing a second Reveal engine. Two live engines on one page fight over
// document-level keyboard handlers, and the presenter's arrow key would advance
// one of them at random. The presenter's controls drive the deck through props,
// which is also what lets a future second-window implementation drive it over
// postMessage without changing this component.
// =============================================================================

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { slideLabel, type SlideDeck } from "@/lib/presentations/types";

import { RevealPresentation } from "./RevealPresentation";

export interface PresenterViewProps {
  deck: SlideDeck;
  /** Controlled index (0-based). The presenter view never owns the position —
   *  the audience-facing deck does, and they must not diverge. */
  currentIndex: number;
  onNavigate: (index: number) => void;
  title?: string;
  className?: string;
  /** Injected in tests so elapsed-time assertions are not wall-clock races. */
  now?: () => number;
}

/**
 * Elapsed time as `H:MM:SS` (or `M:SS` under an hour).
 *
 * Seconds are shown deliberately: a presenter pacing a 45-minute class watches
 * the seconds tick on the last slide, and a minutes-only clock that jumps is
 * useless for that.
 */
export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export function PresenterView({
  deck,
  currentIndex,
  onNavigate,
  title,
  className,
  now = () => Date.now(),
}: PresenterViewProps) {
  const slides = deck.slides;
  const current = slides[currentIndex];
  const upcoming = slides[currentIndex + 1];

  // ---------------------------------------------------------------------
  // Elapsed timer
  // ---------------------------------------------------------------------
  // The start instant is captured in a ref, and elapsed time is recomputed
  // from it each tick, rather than incrementing a counter. A counter drifts,
  // and drifts badly when the tab is backgrounded and the browser throttles
  // timers — which is precisely what happens when the presenter switches to
  // the shared screen.
  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    if (startedAtRef.current === null) startedAtRef.current = now();
    const id = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) setElapsedMs(now() - startedAt);
    }, 1_000);
    return () => window.clearInterval(id);
  }, [running, now]);

  const resetTimer = (): void => {
    startedAtRef.current = now();
    setElapsedMs(0);
  };

  const atStart = currentIndex <= 0;
  const atEnd = currentIndex >= slides.length - 1;

  return (
    <div
      className={cn(
        // Stacks below lg: a presenter on a tablet gets the current slide and
        // notes in a single readable column rather than two cramped ones.
        "grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]",
        className,
      )}
      data-testid="presenter-view"
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{title ?? "Presenter view"}</h2>
        <RevealPresentation
          deck={deck}
          currentIndex={currentIndex}
          readOnly
          title={title}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => onNavigate(currentIndex - 1)}
            disabled={atStart}
            className="min-h-[44px] min-w-[44px]"
            aria-label="Previous slide"
          >
            ←
          </Button>
          <Button
            onClick={() => onNavigate(currentIndex + 1)}
            disabled={atEnd}
            className="min-h-[44px] min-w-[44px]"
            aria-label="Next slide"
          >
            →
          </Button>
          <p className="text-sm text-slate-600" data-testid="presenter-position">
            {slides.length === 0
              ? "No slides"
              : `${currentIndex + 1} / ${slides.length}`}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Elapsed
              </p>
              {/* aria-live is off: a clock announcing itself every second would
                  make the page unusable with a screen reader. The presenter can
                  read it on demand. */}
              <p
                className="font-mono text-2xl"
                data-testid="presenter-elapsed"
                aria-live="off"
              >
                {formatElapsed(elapsedMs)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRunning((value) => !value)}
                aria-pressed={running}
              >
                {running ? "Pause" : "Resume"}
              </Button>
              <Button variant="ghost" size="sm" onClick={resetTimer}>
                Reset
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Speaker notes
          </p>
          <p
            className="mt-2 whitespace-pre-line text-sm"
            data-testid="presenter-notes"
          >
            {current?.speakerNotes ?? "No notes for this slide."}
          </p>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Up next
          </p>
          <p className="mt-2 text-sm" data-testid="presenter-next">
            {upcoming === undefined
              ? "End of presentation"
              : slideLabel(upcoming)}
          </p>
        </Card>
      </div>
    </div>
  );
}
