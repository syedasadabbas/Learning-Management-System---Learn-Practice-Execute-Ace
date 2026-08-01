"use client";

// =============================================================================
// <ProgressiveHintRevealer /> — one rung of the hint ladder at a time.
// Spec: TECHNICAL_SPECIFICATION.md §3.2.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THIS COMPONENT'S PROP API DIVERGES FROM THE SPEC, DELIBERATELY, AND THIS IS
// THE REASON.
//
// The spec (line ~816) types it as `{ hints: Array<{level, text}> }` — the whole
// ladder, handed in up front, revealed by a client-side counter. That is not a
// hint system, it is a progress bar over data the student already has: hint 3 is
// in the React props from the first paint, one devtools inspection away from the
// person who is trying not to look at it. The reveal is theatre.
//
// The API stream reached the same conclusion from the other side and BUILT
// AGAINST IT. `GET /api/practice-problems/:id/hints?upTo=n` returns levels 1..n
// and nothing beyond, and the detail endpoint carries only `hintCount` and
// `maxHintLevel` — the SHAPE of the ladder, never its text. Its module header
// says: "A client-side 'reveal one more hint' over an array it already holds is
// a progress bar, not a gate."
//
// So this component takes a `problemId` and a `maxLevel`, and each rung is a
// REQUEST. The spec's `hints` prop survives as an optional escape hatch used by
// exactly two callers — the instructor preview, where withholding the content
// from its author is pointless, and this file's unit tests — and when it is
// supplied the component does not fetch at all. Which mode it is in is visible
// in the DOM as `data-source`, so a test can assert the student path is the
// metered one.
//
// WHAT THIS IS NOT: a security boundary. The endpoint's own header says a
// determined student can call it with `upTo=10`. Hints are teaching material.
// What the metering buys is that the DEFAULT path cannot leak the ladder, which
// is the property that changes behaviour for the ninety-nine students who were
// not going to open devtools.
//
// ACCESSIBILITY: a newly revealed hint is announced through the shared
// `LiveRegion` from the visualizations stream rather than a bespoke one, and
// focus moves to the new hint's heading so a keyboard user is not left at the
// bottom of the page wondering whether the button did anything.
// =============================================================================

import * as React from "react";

import { LiveRegion, useAnnouncer } from "@/components/learn/visualizations/controls";
import { Badge, Button, Card, cn } from "@/components/ui";
import { apiPathWithQuery } from "@/lib/client/api";
import { apiRequest } from "@/lib/client/api";

export interface Hint {
  level: number;
  text: string;
}

export interface ProgressiveHintRevealerProps {
  /** Required in the student path — each rung is fetched from the metered route. */
  problemId: number;
  /** `maxHintLevel` from the problem detail payload. Zero means no ladder. */
  maxLevel: number;
  /**
   * Pre-supplied ladder. INSTRUCTOR PREVIEW AND TESTS ONLY — see the header.
   * When present the component never calls the API.
   */
  hints?: readonly Hint[];
  onHintRevealed?: (level: number) => void;
  className?: string;
  fetchImpl?: typeof fetch;
}

/** The shape `GET /api/practice-problems/:id/hints` returns inside `apiOk`. */
interface HintLadderResponse {
  problemId: number;
  hints: Hint[];
  revealedUpTo: number;
  maxLevel: number;
  hasMore: boolean;
}

const HINTS_ROUTE = "GET  /api/practice-problems/:problemId/hints" as const;

export function ProgressiveHintRevealer({
  problemId,
  maxLevel,
  hints: preloaded,
  onHintRevealed,
  className,
  fetchImpl,
}: ProgressiveHintRevealerProps) {
  const isPreloaded = preloaded !== undefined;

  const [revealed, setRevealed] = React.useState<Hint[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { message, announce } = useAnnouncer();
  const latestRef = React.useRef<HTMLHeadingElement | null>(null);
  // Set only by a user-initiated reveal, so the effect below does not steal
  // focus on the initial mount or on a parent re-render.
  const shouldFocus = React.useRef(false);

  React.useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    latestRef.current?.focus();
  }, [revealed.length]);

  // A different problem is a different ladder. Without this the student carries
  // problem 3's hints into problem 4.
  React.useEffect(() => {
    setRevealed([]);
    setError(null);
  }, [problemId]);

  const effectiveMax = Math.max(0, isPreloaded ? preloaded.length : maxLevel);
  const nextLevel = revealed.length + 1;
  const hasMore = revealed.length < effectiveMax;

  async function revealNext(): Promise<void> {
    if (loading || !hasMore) return;
    setError(null);

    if (isPreloaded) {
      // Sorted defensively: the preview path is fed straight from a jsonb blob
      // and jsonb preserves whatever order the author wrote, not level order.
      const ordered = [...preloaded].sort((a, b) => a.level - b.level);
      const hint = ordered[revealed.length];
      if (!hint) return;
      shouldFocus.current = true;
      setRevealed((prev) => [...prev, hint]);
      announce(`Hint ${nextLevel} of ${effectiveMax} revealed.`);
      onHintRevealed?.(hint.level);
      return;
    }

    setLoading(true);
    const result = await apiRequest<HintLadderResponse>(
      HINTS_ROUTE,
      apiPathWithQuery(HINTS_ROUTE, { problemId }, { upTo: nextLevel }),
      { fetchImpl },
    );
    setLoading(false);

    if (!result.ok) {
      if (result.aborted) return;
      setError(result.error);
      // Announced as well as rendered: the button the student pressed is still
      // there and looks unchanged, so a silent failure reads as an unresponsive
      // control.
      announce(`Hint ${nextLevel} could not be loaded. ${result.error}`);
      return;
    }

    // The RESPONSE is authoritative about how many rungs exist, not the prop:
    // `maxLevel` came from a detail payload fetched earlier and an instructor
    // may have edited the problem since.
    const ladder = [...result.data.hints].sort((a, b) => a.level - b.level);
    shouldFocus.current = true;
    setRevealed(ladder);
    const newest = ladder[ladder.length - 1];
    if (newest) {
      announce(`Hint ${ladder.length} of ${result.data.maxLevel} revealed.`);
      onHintRevealed?.(newest.level);
    }
  }

  if (effectiveMax === 0) {
    return (
      <p className={cn("text-sm text-ink-muted", className)} data-testid="hints-none">
        This problem has no hints. Work from the acceptance criteria.
      </p>
    );
  }

  return (
    <section
      aria-labelledby={`hints-${problemId}-heading`}
      className={cn("flex flex-col gap-3", className)}
      data-testid="progressive-hints"
      // The seam a test asserts on: "metered" is the student path.
      data-source={isPreloaded ? "preloaded" : "metered"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`hints-${problemId}-heading`} className="text-base font-semibold text-ink">
          Hints
        </h3>
        <Badge tone="neutral" size="sm">
          {`${revealed.length} of ${effectiveMax} revealed`}
        </Badge>
      </div>

      {revealed.length === 0 && (
        <p className="text-sm text-ink-muted">
          Try the problem first. Each hint gives away a little more than the last.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {revealed.map((hint, index) => (
          <li key={hint.level}>
            <Card padded data-testid={`hint-${hint.level}`}>
              <h4
                // Only the most recent hint is focusable, and only so the reveal
                // can move focus to it. tabIndex={-1} keeps it out of the tab
                // order afterwards.
                ref={index === revealed.length - 1 ? latestRef : undefined}
                tabIndex={index === revealed.length - 1 ? -1 : undefined}
                className="text-sm font-semibold text-ink"
              >
                {`Hint ${hint.level}`}
              </h4>
              <p className="mt-1 text-sm text-ink-muted">{hint.text}</p>
            </Card>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="text-sm text-ink" data-testid="hint-error">
          {error}
        </p>
      )}

      {hasMore ? (
        <Button
          variant="secondary"
          size="md"
          className="self-start"
          loading={loading}
          disabled={loading}
          onClick={() => void revealNext()}
          data-testid="reveal-hint"
        >
          {revealed.length === 0 ? "Show the first hint" : `Show hint ${nextLevel}`}
        </Button>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="hints-exhausted">
          That is every hint. The reference solution is a separate button, below.
        </p>
      )}

      <LiveRegion message={message} testId="hint-live-region" />
    </section>
  );
}
