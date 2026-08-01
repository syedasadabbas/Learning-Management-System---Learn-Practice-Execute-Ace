"use client";

// =============================================================================
// CSS SPECIFICITY CALCULATOR — why the rule you wrote last did not win
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THIS EXISTS
// Specificity is taught as arithmetic ("ids are 100, classes are 10") and that
// framing is actively harmful: it implies eleven classes beat one id, which is
// false. The triple is compared column by column, not summed. A tool that shows
// the three columns separately and then declares a winner teaches the real rule
// in a way a paragraph reliably fails to.
//
// WHY THE TIE-BREAK IS MODELLED
// Equal specificity is resolved by source order, later wins. Students remember
// half of that as "the last rule always wins" and then cannot explain why their
// last rule lost. `findWinner` implements both halves and the UI states which
// one applied, so the two are never confused.
//
// The arithmetic itself lives in ./specificity.ts precisely so it can be
// table-tested. This file is only the surface.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";

import { LiveRegion, VizFigure, useAnnouncer } from "./controls";
import {
  calculateSpecificity,
  findWinner,
  formatSpecificity,
  type SpecificityResult,
} from "./specificity";

export interface CSSSpecificityCalculatorProps {
  /** Selectors the calculator opens with. Blank entries are allowed. */
  initialSelectors?: readonly string[];
  /** Upper bound on rows, to keep the comparison readable. */
  maxSelectors?: number;
  className?: string;
  idPrefix?: string;
}

const DEFAULT_SELECTORS = ["h1", ".title", "#page-title", "header .title"] as const;
const DEFAULT_MAX = 8;

export function CSSSpecificityCalculator({
  initialSelectors = DEFAULT_SELECTORS,
  maxSelectors = DEFAULT_MAX,
  className,
  idPrefix = "specificity",
}: CSSSpecificityCalculatorProps) {
  const cap = Math.max(1, Math.floor(maxSelectors) || DEFAULT_MAX);
  // An empty initial list would render a table with no rows and no way to add
  // meaning; one blank row is the usable degenerate case.
  const [selectors, setSelectors] = React.useState<string[]>(() => {
    const seed = initialSelectors.slice(0, cap);
    return seed.length > 0 ? [...seed] : [""];
  });

  const { message, announce } = useAnnouncer();
  const titleId = `${idPrefix}-title`;

  const results: SpecificityResult[] = React.useMemo(
    () => selectors.map((selector) => calculateSpecificity(selector)),
    [selectors],
  );
  // A blank row is not a competitor; it would otherwise "win" ties by being last.
  const contenders = results.filter((r) => r.selector.length > 0);
  const winnerIndex = findWinner(contenders);
  const winner = winnerIndex >= 0 ? contenders[winnerIndex] : undefined;

  const update = (index: number, value: string) => {
    setSelectors((prev) => prev.map((item, i) => (i === index ? value : item)));
    const computed = calculateSpecificity(value);
    announce(
      `${value || "empty selector"} has specificity ${formatSpecificity(computed)}.`,
    );
  };

  const addRow = () => {
    setSelectors((prev) => (prev.length >= cap ? prev : [...prev, ""]));
    announce("Added a selector row.");
  };

  const removeRow = (index: number) => {
    setSelectors((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    announce("Removed a selector row.");
  };

  return (
    <VizFigure
      title="CSS specificity calculator"
      description="Type selectors and compare them column by column. Specificity is not a sum — a single id beats any number of classes."
      titleId={titleId}
      testId="specificity-calculator"
      className={className}
    >
      <LiveRegion message={message} testId="specificity-live" />

      <div className="space-y-2">
        {selectors.map((selector, index) => {
          const result = results[index];
          const isWinner = winner !== undefined && result === winner;
          const inputId = `${idPrefix}-selector-${index}`;
          return (
            <div
              key={inputId}
              data-testid="specificity-row"
              data-winner={isWinner ? "true" : "false"}
              className={cn(
                "flex flex-wrap items-end gap-2 rounded-md border p-2",
                isWinner ? "border-2 border-brand bg-surface" : "border-line bg-panel",
              )}
            >
              <div className="min-w-0 flex-1 basis-48">
                <label htmlFor={inputId} className="block text-xs font-medium text-ink">
                  Selector {index + 1}
                </label>
                <input
                  id={inputId}
                  type="text"
                  value={selector}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="e.g. nav ul li.active"
                  onChange={(event) => update(index, event.target.value)}
                  className="mt-1 h-11 w-full rounded-md border border-line bg-panel px-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />
              </div>

              {/* The triple is spelled out in words in the aria-label, because
                  "1, 2, 0" read aloud is meaningless without the column names. */}
              <p
                data-testid="specificity-value"
                aria-label={`Selector ${index + 1} specificity: ${result.ids} ids, ${result.classes} classes, ${result.types} types`}
                className="shrink-0 rounded border border-line bg-surface px-2 py-2 font-mono text-sm tabular-nums"
              >
                {formatSpecificity(result)}
              </p>

              {result.important && (
                <span
                  data-testid="specificity-important"
                  className="shrink-0 rounded border border-line px-2 py-2 text-xs font-semibold"
                >
                  !important — outranks the triple
                </span>
              )}

              {/* The winner is marked in TEXT, not by the border alone. */}
              {isWinner && (
                <span
                  data-testid="specificity-winner-flag"
                  className="shrink-0 rounded border border-brand px-2 py-2 text-xs font-semibold text-brand"
                >
                  wins
                </span>
              )}

              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeRow(index)}
                disabled={selectors.length <= 1}
                aria-label={`Remove selector ${index + 1}`}
              >
                Remove
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={addRow} disabled={selectors.length >= cap}>
          Add selector
        </Button>
        <span className="text-xs text-ink-muted">
          Columns are compared left to right: ids, then classes and attributes and pseudo-classes,
          then element types.
        </span>
      </div>

      <p
        data-testid="specificity-verdict"
        className="rounded-md border border-line bg-surface p-2 text-sm"
      >
        {winner ? (
          <>
            <span className="font-semibold">{winner.selector}</span> wins with{" "}
            <span className="font-mono tabular-nums">{formatSpecificity(winner)}</span>
            {winner.important ? " and !important" : ""}.
            {contenders.filter(
              (r) =>
                r !== winner &&
                r.important === winner.important &&
                formatSpecificity(r) === formatSpecificity(winner),
            ).length > 0
              ? " It ties with another selector, so source order decides and the later rule wins."
              : ""}
          </>
        ) : (
          "Enter a selector to see its specificity."
        )}
      </p>

      {results.some((r) => r.unparsed.length > 0) && (
        <p data-testid="specificity-unparsed" className="text-xs text-ink-muted">
          Some characters were not recognised as selector syntax and were ignored. Check for a typo.
        </p>
      )}
    </VizFigure>
  );
}

export default CSSSpecificityCalculator;
