"use client";

// =============================================================================
// HTTP CYCLE DIAGRAM — what actually happens between the click and the page
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THIS ONE IS A STEPPER AND NOT A LOOPING ANIMATION
// The failure mode of "animated request/response cycle" is a pretty loop that
// nobody can stop on the step they did not understand. The cycle has seven
// distinct stages and each has content worth reading, so the primary control is
// a stepper: previous, next, and a click target on every stage. Autoplay exists
// because a first pass benefits from seeing the sequence, but it is opt-in, it
// pauses, and it is absent entirely under reduced motion.
//
// REDUCED MOTION IS A DIFFERENT COMPONENT, NOT A FASTER ONE (house rule from
// src/lib/exercises/reduced-motion.ts). Every stage title and every detail is
// in the DOM in both modes; the only thing motion changes is whether the
// emphasis advances on a timer. Under `reduce` the stages render as a static
// numbered list with the selected one marked, and the play control is replaced
// by a line of text saying why.
//
// NOT COLOUR-ONLY. The active stage carries the word "current", an
// `aria-current="step"`, a heavier border and a filled marker — four cues.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import {
  STEP_TRANSITION_MS,
  usePrefersReducedMotion,
} from "@/lib/exercises/reduced-motion";

import { LiveRegion, VizFigure, useAnnouncer } from "./controls";

export interface HttpCycleStage {
  id: string;
  /** Who is doing the work at this stage. */
  actor: "Browser" | "DNS resolver" | "Server" | "Network";
  title: string;
  detail: string;
  /** A representative wire snippet, so the stage is inspectable, not just named. */
  wire: string;
}

/**
 * The default seven stages. Exported so a lecture can render a subset or
 * reorder them without this component owning curriculum decisions.
 */
export const DEFAULT_HTTP_STAGES: readonly HttpCycleStage[] = [
  {
    id: "url",
    actor: "Browser",
    title: "You enter a URL",
    detail:
      "The browser splits the URL into scheme, host and path. Nothing has left your machine yet — this is pure string parsing.",
    wire: "https://example.com/courses?week=2\n scheme = https\n host   = example.com\n path   = /courses",
  },
  {
    id: "dns",
    actor: "DNS resolver",
    title: "DNS turns the name into an address",
    detail:
      "Computers route by IP address, not by name. The resolver is asked for example.com and answers with an address. Results are cached, which is why the second visit feels faster.",
    wire: "QUERY  example.com  A\nANSWER example.com  A  93.184.216.34  (ttl 3600 s)",
  },
  {
    id: "connect",
    actor: "Network",
    title: "A connection is opened",
    detail:
      "TCP handshake, then the TLS handshake for https. This is where the padlock is earned: the server proves it owns the certificate for that host.",
    wire: "TCP  SYN -> SYN/ACK -> ACK\nTLS  ClientHello -> ServerHello + certificate -> Finished",
  },
  {
    id: "request",
    actor: "Browser",
    title: "The request is sent",
    detail:
      "A method, a path, and headers. The method says what you want done; the headers say who is asking and what formats you can accept.",
    wire: "GET /courses?week=2 HTTP/1.1\nHost: example.com\nAccept: text/html\nCookie: session=…",
  },
  {
    id: "process",
    actor: "Server",
    title: "The server does the work",
    detail:
      "Routing, authentication, database queries, rendering. Everything you write on the back end happens inside this one stage.",
    wire: "route  GET /courses\nauth   session -> user #42\nquery  SELECT * FROM weeks WHERE cohort = 7",
  },
  {
    id: "response",
    actor: "Server",
    title: "The response comes back",
    detail:
      "A status code, headers and a body. The status is the summary: 200 fine, 301 moved, 404 not here, 500 the server broke.",
    wire: "HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\nContent-Length: 18432\n\n<!doctype html>…",
  },
  {
    id: "render",
    actor: "Browser",
    title: "The browser renders it",
    detail:
      "HTML is parsed into the DOM, and every stylesheet, script and image referenced by it starts this whole cycle again.",
    wire: "parse HTML -> DOM\nfetch /styles.css, /app.js, /logo.svg  (one cycle each)",
  },
] as const;

export interface HTTPCycleDiagramProps {
  stages?: readonly HttpCycleStage[];
  /** Stage index the diagram opens on. Clamped into range. */
  initialStage?: number;
  /** Hides the autoplay control even when motion is allowed. */
  allowAutoplay?: boolean;
  className?: string;
  idPrefix?: string;
}

/** One stage per this many milliseconds during autoplay. */
const AUTOPLAY_INTERVAL_MS = 2200;

export function HTTPCycleDiagram({
  stages = DEFAULT_HTTP_STAGES,
  initialStage = 0,
  allowAutoplay = true,
  className,
  idPrefix = "http-cycle",
}: HTTPCycleDiagramProps) {
  const reducedMotion = usePrefersReducedMotion();

  // An empty stage list is a data problem, not a crash. Render the explanation.
  const hasStages = stages.length > 0;
  const lastIndex = Math.max(0, stages.length - 1);
  const [index, setIndex] = React.useState(() =>
    Math.min(Math.max(0, Math.floor(initialStage) || 0), lastIndex),
  );
  const [playing, setPlaying] = React.useState(false);

  const current = Math.min(index, lastIndex);
  const stage = stages[current];

  const { message, announce } = useAnnouncer();
  const titleId = `${idPrefix}-title`;

  const goTo = React.useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), lastIndex);
      setIndex(clamped);
      const target = stages[clamped];
      if (target) {
        announce(`Stage ${clamped + 1} of ${stages.length}: ${target.title}. ${target.detail}`);
      }
    },
    [announce, lastIndex, stages],
  );

  React.useEffect(() => {
    if (!playing || reducedMotion || !hasStages) return;
    const timer = window.setInterval(() => {
      // Wraps: the point of the cycle is that rendering starts the next one.
      setIndex((prev) => (prev >= lastIndex ? 0 : prev + 1));
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion, hasStages, lastIndex]);

  if (!hasStages || !stage) {
    return (
      <VizFigure
        title="HTTP request cycle"
        description="No stages were supplied for this diagram."
        titleId={titleId}
        testId="http-cycle-diagram"
        className={className}
      >
        <p className="text-sm text-ink-muted" data-testid="http-cycle-empty">
          This diagram has no stages to show. The rest of the page is unaffected.
        </p>
      </VizFigure>
    );
  }

  return (
    <VizFigure
      title="HTTP request cycle"
      description="Seven stages between typing a URL and seeing a page. Select any stage to inspect what is on the wire."
      titleId={titleId}
      testId="http-cycle-diagram"
      className={className}
    >
      <LiveRegion message={message} testId="http-cycle-live" />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => goTo(current - 1)}
          disabled={current === 0}
        >
          Previous stage
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => goTo(current + 1)}
          disabled={current === lastIndex}
        >
          Next stage
        </Button>
        {allowAutoplay && !reducedMotion ? (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={playing}
            onClick={() => setPlaying((prev) => !prev)}
          >
            {playing ? "Pause" : `Play (${AUTOPLAY_INTERVAL_MS} ms per stage)`}
          </Button>
        ) : (
          <span className="text-xs text-ink-muted" data-testid="http-cycle-motion-note">
            {reducedMotion
              ? "Motion off (system setting) — step through the stages with the buttons."
              : "Autoplay is disabled for this diagram."}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-ink-muted">
          Stage {current + 1} of {stages.length}
        </span>
      </div>

      {/* An ordered list because the order IS the lesson; a screen reader then
          gets "3 of 7" for free. Every stage is a real button: the whole
          sequence is reachable with Tab and operable with Enter/Space, with no
          bespoke roving-tabindex code that could regress. */}
      <ol data-testid="http-cycle-stages" className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s, i) => {
          const isCurrent = i === current;
          return (
            <li key={s.id}>
              <button
                type="button"
                data-testid="http-cycle-stage"
                data-stage-id={s.id}
                data-current={isCurrent ? "true" : "false"}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => {
                  setPlaying(false);
                  goTo(i);
                }}
                style={{
                  // The emphasis fade is the only animation here, and it is the
                  // house step duration rather than a number invented locally.
                  transitionDuration: `${reducedMotion ? 0 : STEP_TRANSITION_MS}ms`,
                }}
                className={cn(
                  "flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left text-xs transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  isCurrent
                    ? "border-2 border-brand bg-surface font-semibold"
                    : "border-line bg-panel hover:bg-surface",
                )}
              >
                <span className="text-ink-muted">
                  {i + 1}. {s.actor}
                </span>
                <span className="text-ink">{s.title}</span>
                {/* The word, not just the border: this is the greyscale cue. */}
                {isCurrent && <span className="text-brand">current</span>}
              </button>
            </li>
          );
        })}
      </ol>

      <div
        data-testid="http-cycle-detail"
        className="space-y-2 rounded-md border border-line bg-surface p-3"
      >
        <h4 className="text-sm font-semibold">
          {stage.actor}: {stage.title}
        </h4>
        <p className="text-sm text-ink">{stage.detail}</p>
        <pre
          tabIndex={0}
          role="region"
          aria-label={`Wire detail for ${stage.title}`}
          data-testid="http-cycle-wire"
          className="overflow-auto rounded border border-line bg-panel p-2 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <code>{stage.wire}</code>
        </pre>
      </div>
    </VizFigure>
  );
}

export default HTTPCycleDiagram;
