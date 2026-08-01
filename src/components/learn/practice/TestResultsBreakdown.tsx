"use client";

// =============================================================================
// <TestResultsBreakdown /> — per-test pass/fail after a self-check run.
// Spec: TECHNICAL_SPECIFICATION.md §3.2.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHERE THE RESULTS COME FROM, because it is not where the spec assumed.
//
// `POST /api/practice-problems/:id/attempt` does NOT execute code. Its header
// says so at length: there is no attempts ledger to write a result into,
// `POST /api/execute` already owns execution, and these problems default to
// `execution_mode = 'browser'`. The endpoint is a handshake that returns the
// test cases so the student's own tab can run them. This component renders
// whatever ran — it is a pure display component and takes results as props,
// which is also what makes it testable without a runner.
//
// PASS AND FAIL ARE NOT COLOUR. Each row carries a text status ("Passed" /
// "Failed") and a glyph, and the glyph is `aria-hidden` so the status is read
// once rather than as "check mark Passed". WCAG 1.4.1: a red/green row tint
// alone is invisible to the ~8% of male students with a red-green deficiency,
// which in a cohort of forty is not a hypothetical.
//
// THE ENCOURAGEMENT MESSAGE IS NOT A LIVE REGION. The spec asks for one. It is
// rendered as ordinary text inside the summary because the whole panel appears
// at once after a run; the announcement belongs to whatever triggered the run
// (PracticeProblemCard announces it), and two live regions racing to describe
// the same event is how a screen reader ends up reading neither.
// =============================================================================

import * as React from "react";

import { Badge, Card, ProgressBar, cn } from "@/components/ui";

export interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  explanation?: string;
}

export interface TestResultsBreakdownProps {
  results: readonly TestResult[];
  totalTests: number;
  passedTests: number;
  className?: string;
}

/**
 * Encouragement, keyed on the ratio.
 *
 * Exported so the wording is assertable rather than a string literal buried in
 * JSX, and so a future localisation pass has one place to look.
 */
export function encouragementFor(passed: number, total: number): string {
  if (total === 0) return "There are no tests attached to this problem yet.";
  if (passed === total) return "Every test passes. Compare your approach with the reference solution.";
  if (passed === 0) return "Nothing passes yet. Read the first failing test below — it names what is expected.";
  if (passed >= total / 2) return "More than half the way there. Work through the failures one at a time.";
  return "Some tests pass, so the shape is right. The failures below say what is missing.";
}

export function TestResultsBreakdown({
  results,
  totalTests,
  passedTests,
  className,
}: TestResultsBreakdownProps) {
  // Clamped rather than trusted: `passedTests` is a caller-supplied count and a
  // percentage above 100 renders a bar that overflows its track.
  const safeTotal = Math.max(0, totalTests);
  const safePassed = Math.min(Math.max(0, passedTests), safeTotal);
  const percent = safeTotal === 0 ? 0 : Math.round((safePassed / safeTotal) * 100);

  return (
    <section
      aria-labelledby="test-results-heading"
      className={cn("flex flex-col gap-3", className)}
      data-testid="test-results"
    >
      <h3 id="test-results-heading" className="text-base font-semibold text-ink">
        Test results
      </h3>

      <ProgressBar
        percent={percent}
        label={`${safePassed} of ${safeTotal} tests passing`}
        tone={safePassed === safeTotal && safeTotal > 0 ? "success" : "brand"}
      />

      <p className="text-sm text-ink-muted" data-testid="test-encouragement">
        {encouragementFor(safePassed, safeTotal)}
      </p>

      <ul className="flex flex-col gap-2">
        {results.map((result, index) => (
          <li key={`${result.name}-${index}`}>
            <Card
              padded
              data-testid={`test-result-${index}`}
              data-passed={result.passed}
              title={
                <span className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true">{result.passed ? "✓" : "✗"}</span>
                  <span className="font-semibold text-ink">{result.name}</span>
                </span>
              }
              action={
                <Badge tone={result.passed ? "success" : "danger"} size="sm">
                  {result.passed ? "Passed" : "Failed"}
                </Badge>
              }
              className={cn(
                // The left border is a second, non-colour-dependent cue only in
                // combination with the badge text above; on its own it is
                // decoration, which is why the badge text exists.
                // Emerald/red rather than a semantic token: `globals.css` defines
                // brand, accent, surface, ink and line only, and Badge already
                // reaches for the Tailwind palette for pass/fail. A second
                // spelling of "green" is worse than matching the primitive.
                "border-l-4",
                result.passed ? "border-l-emerald-500" : "border-l-red-500",
              )}
            >
              {!result.passed && (
                <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[7rem_1fr]">
                  <dt className="font-semibold text-ink">Expected</dt>
                  <dd className="m-0 overflow-x-auto font-mono text-ink-muted">
                    {result.expected}
                  </dd>
                  <dt className="font-semibold text-ink">Got</dt>
                  <dd className="m-0 overflow-x-auto font-mono text-ink-muted">
                    {result.actual}
                  </dd>
                  {result.explanation && (
                    <>
                      <dt className="font-semibold text-ink">Why</dt>
                      <dd className="m-0 text-ink-muted">{result.explanation}</dd>
                    </>
                  )}
                </dl>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
