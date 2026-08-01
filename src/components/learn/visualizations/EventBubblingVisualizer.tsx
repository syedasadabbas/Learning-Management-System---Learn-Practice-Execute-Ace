"use client";

// =============================================================================
// EVENT BUBBLING VISUALIZER — capture down, target, bubble up
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THE PROPAGATION IS REAL AND NOT SIMULATED
// It would be easier to hard-code the sequence "document, section, card,
// button, card, section, document" and animate a highlight along it. It would
// also be a lie the moment a student asks "what if I stop it half way". The
// handlers here are genuine React capture and bubble handlers on genuinely
// nested elements, and the log is what actually fired. `stopPropagation` is a
// real call, so the log genuinely goes short — which is the only convincing
// demonstration of what that method does.
//
// KEYBOARD. The innermost target is a real <button>, so Enter and Space fire a
// real click that propagates exactly as a pointer click does. No key handler is
// needed and none is written: the outer layers are not interactive controls and
// must not be focus stops, or Tab would land the user on three non-controls
// before reaching the thing they can press.
//
// REDUCED MOTION. The log is complete in both modes. Motion only decides
// whether the entries are revealed one at a time or all at once — a user who
// asked for less motion still gets the whole sequence, immediately.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import { usePrefersReducedMotion } from "@/lib/exercises/reduced-motion";

import { LiveRegion, VizFigure, useAnnouncer } from "./controls";

export type PropagationPhase = "capture" | "target" | "bubble";

export interface PropagationEntry {
  layer: string;
  phase: PropagationPhase;
}

export interface EventBubblingVisualizerProps {
  /** Outermost first. The last entry is the clickable target. */
  layers?: readonly string[];
  className?: string;
  idPrefix?: string;
}

const DEFAULT_LAYERS = ["grandparent", "parent", "child"] as const;

/** One log entry per this many milliseconds while the sequence replays. */
const REVEAL_INTERVAL_MS = 420;

export function EventBubblingVisualizer({
  layers = DEFAULT_LAYERS,
  className,
  idPrefix = "event-bubbling",
}: EventBubblingVisualizerProps) {
  const reducedMotion = usePrefersReducedMotion();

  // Fewer than two layers cannot demonstrate propagation at all; fall back to
  // the default rather than rendering a lone box that teaches nothing.
  const usableLayers = layers.length >= 2 ? layers : DEFAULT_LAYERS;
  const targetLayer = usableLayers[usableLayers.length - 1];

  const [log, setLog] = React.useState<PropagationEntry[]>([]);
  const [revealed, setRevealed] = React.useState(0);
  const [stopAt, setStopAt] = React.useState<string>("none");

  const { message, announce } = useAnnouncer();
  const titleId = `${idPrefix}-title`;

  // Collected during a single click and committed once, because setState inside
  // each of six handlers would batch unpredictably and the ORDER is the lesson.
  const pending = React.useRef<PropagationEntry[]>([]);

  const record = (layer: string, phase: PropagationPhase) => {
    pending.current.push({ layer, phase });
  };

  const finish = () => {
    const entries = pending.current;
    pending.current = [];
    setLog(entries);
    setRevealed(reducedMotion ? entries.length : 0);
    const stopped = stopAt !== "none";
    announce(
      `${entries.length} handlers ran: ${entries
        .map((e) => `${e.layer} ${e.phase}`)
        .join(", ")}.${stopped ? ` Propagation was stopped at ${stopAt}.` : ""}`,
    );
  };

  React.useEffect(() => {
    if (reducedMotion || revealed >= log.length) return;
    const timer = window.setTimeout(
      () => setRevealed((prev) => Math.min(prev + 1, log.length)),
      REVEAL_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, revealed, log.length]);

  const handlerFor =
    (layer: string, phase: PropagationPhase) => (event: React.SyntheticEvent) => {
      record(layer, phase);
      if (stopAt === layer) {
        // The real thing. React's synthetic event delegates to the native one,
        // so this genuinely halts the remaining handlers below.
        event.stopPropagation();
        // Capture is the FIRST handler to run at any given layer, so stopping
        // here always ends the journey: descendants never see the event, and
        // the bubble phase never comes back up through this layer. That makes
        // this unconditionally the last handler, whichever layer it is.
        finish();
        return;
      }
      // The outermost bubble handler is the last one to run in a full journey.
      if (phase === "bubble" && layer === usableLayers[0]) finish();
    };

  const reset = () => {
    setLog([]);
    setRevealed(0);
    pending.current = [];
    announce("Log cleared.");
  };

  const visibleLog = log.slice(0, reducedMotion ? log.length : revealed);

  // Build the nesting from the inside out so each layer wraps the previous one.
  let tree: React.ReactNode = (
    <button
      type="button"
      data-testid="event-bubbling-target"
      onClickCapture={handlerFor(targetLayer, "capture")}
      onClick={handlerFor(targetLayer, "target")}
      className="min-h-11 rounded-md border-2 border-solid border-brand bg-panel px-3 py-2 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      Click the {targetLayer} (the target)
    </button>
  );

  for (let i = usableLayers.length - 2; i >= 0; i -= 1) {
    const layer = usableLayers[i];
    const isActive = visibleLog.some((entry) => entry.layer === layer);
    tree = (
      <div
        data-testid="event-bubbling-layer"
        data-layer={layer}
        data-active={isActive ? "true" : "false"}
        onClickCapture={handlerFor(layer, "capture")}
        onClick={handlerFor(layer, "bubble")}
        className={cn(
          "rounded-md border-2 p-3",
          // Dashed vs solid, plus the layer name printed in the corner: the
          // active state is never signalled by hue alone.
          isActive ? "border-solid border-ink bg-surface" : "border-dashed border-line bg-panel",
        )}
      >
        <p className="mb-2 text-xs font-medium text-ink-muted">
          &lt;div class=&quot;{layer}&quot;&gt;{isActive ? " — handler ran" : ""}
        </p>
        {tree}
      </div>
    );
  }

  return (
    <VizFigure
      title="Event capture and bubbling"
      description="One click runs handlers twice on every ancestor: downwards in the capture phase, then upwards in the bubble phase."
      titleId={titleId}
      testId="event-bubbling-visualizer"
      className={className}
    >
      <LiveRegion message={message} testId="event-bubbling-live" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">{tree}</div>

        <div className="min-w-0 space-y-3 self-start">
          <div>
            <label
              htmlFor={`${idPrefix}-stop-at`}
              className="block text-xs font-medium text-ink"
            >
              Call stopPropagation() at
            </label>
            <select
              id={`${idPrefix}-stop-at`}
              value={stopAt}
              onChange={(event) => {
                setStopAt(event.target.value);
                reset();
              }}
              className="mt-1 h-11 w-full rounded-md border border-line bg-panel px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <option value="none">nowhere — let it propagate</option>
              {usableLayers.map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </div>

          {/* An ordered list, so a screen reader announces the position and the
              sequence survives copy-paste into notes. */}
          <div>
            <h4 className="text-xs font-semibold text-ink">Handlers that ran</h4>
            {visibleLog.length === 0 ? (
              <p data-testid="event-bubbling-empty" className="mt-1 text-xs text-ink-muted">
                Nothing yet. Click or press the target button.
              </p>
            ) : (
              <ol
                data-testid="event-bubbling-log"
                className="mt-1 space-y-1 text-xs tabular-nums"
              >
                {visibleLog.map((entry, i) => (
                  <li
                    key={`${entry.layer}-${entry.phase}-${i}`}
                    data-phase={entry.phase}
                    className="rounded border border-line bg-surface px-2 py-1"
                  >
                    {i + 1}. {entry.layer} — {entry.phase} phase
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={reset} disabled={log.length === 0}>
              Clear log
            </Button>
            <span className="text-xs text-ink-muted" data-testid="event-bubbling-motion-note">
              {reducedMotion
                ? "Motion off — the full sequence is listed at once."
                : `Revealed one step every ${REVEAL_INTERVAL_MS} ms.`}
            </span>
          </div>
        </div>
      </div>
    </VizFigure>
  );
}

export default EventBubblingVisualizer;
