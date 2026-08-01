"use client";

// =============================================================================
// CHECK STEP — the inline question.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// THE ANSWER KEY IS NOT IN THIS COMPONENT'S PROPS. `PublicCheck` carries option
// TEXT only; `correct` was dropped at the read boundary in query.ts. Grading is a
// round trip to POST /api/learn/steps/:stepId/complete, which returns whether the
// pick was right, which option was, and why.
//
// That is a deliberate choice with a real cost — a check needs the network, so it
// does not work offline the way the labs do. It is worth it because the
// alternative sets a precedent: once one payload ships an answer key "because it
// is only a self-check", the barrier `src/lib/quizzes/payload.ts` maintains stops
// being a rule and becomes a preference. The labs are the offline-capable part of
// this stream; a one-line question is not what a student loses in a tunnel.
//
// A WRONG ANSWER STILL COMPLETES THE STEP. These tracks carry no marks. The
// explanation is the teaching, and gating the next step on a correct self-check
// only teaches students to click until it opens.
//
// ACCESSIBILITY. Native radios in a `fieldset`/`legend`, so arrow-key selection,
// grouping and the question text all come from the platform. The result is
// announced in a live region and stated in words ("Correct" / "Not quite"), never
// by colour alone.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import type { CheckOutcome, PublicCheck } from "@/lib/learn";

export interface CheckStepProps {
  check: PublicCheck;
  /** Distinguishes several checks on one page; used for input names and ids. */
  checkId: string;
  /**
   * Submits the answer. Returns the graded outcome, or null when the request
   * failed — the caller owns the network, this component only renders.
   */
  onAnswer: (answerIndex: number) => Promise<CheckOutcome | null>;
  /** Outcome from a previous attempt in this session, if the parent kept one. */
  initialOutcome?: CheckOutcome | null;
  className?: string;
}

export function CheckStep({
  check,
  checkId,
  onAnswer,
  initialOutcome = null,
  className,
}: CheckStepProps) {
  const [picked, setPicked] = React.useState<number | null>(null);
  const [outcome, setOutcome] = React.useState<CheckOutcome | null>(initialOutcome);
  const [submitting, setSubmitting] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const answered = outcome !== null;

  const submit = React.useCallback(async () => {
    if (picked === null || submitting) return;
    setSubmitting(true);
    setFailed(false);
    const result = await onAnswer(picked);
    setSubmitting(false);
    if (result) setOutcome(result);
    else setFailed(true);
  }, [onAnswer, picked, submitting]);

  return (
    <div className={cn("space-y-3", className)} data-testid="learn-check-step">
      <fieldset
        className="space-y-2 rounded-lg border border-line bg-surface p-4"
        disabled={answered || submitting}
      >
        <legend className="px-1 text-sm font-semibold text-ink">{check.prompt}</legend>

        {check.options.map((option, index) => {
          const inputId = `${checkId}-option-${index}`;
          const isKey = answered && outcome?.correctIndex === index;
          const isPickedWrong = answered && picked === index && !outcome?.correct;
          return (
            <div key={inputId} className="flex items-start gap-2">
              <input
                type="radio"
                id={inputId}
                name={checkId}
                value={index}
                checked={picked === index}
                onChange={() => setPicked(index)}
                className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
              />
              <label htmlFor={inputId} className="text-sm text-ink">
                {option.text}
                {/* Post-answer markers are WORDS. A green tick alone would be
                    colour-only state, and this is the one place a student most
                    needs to be sure which option was which. */}
                {isKey && (
                  <span className="ml-2 text-xs font-semibold text-ink-muted">
                    — correct answer
                  </span>
                )}
                {isPickedWrong && (
                  <span className="ml-2 text-xs font-semibold text-ink-muted">
                    — your answer
                  </span>
                )}
              </label>
            </div>
          );
        })}
      </fieldset>

      {!answered && (
        <Button
          size="sm"
          data-testid="learn-check-submit"
          loading={submitting}
          disabled={picked === null || submitting}
          onClick={submit}
        >
          {submitting ? "Checking…" : "Check answer"}
        </Button>
      )}

      {/* One live region for both the result and the failure, so a screen reader
          hears whichever happened without either being silent. */}
      <div aria-live="polite" data-testid="learn-check-result">
        {answered && outcome && (
          <div
            className={cn(
              "rounded-md border p-3 text-sm",
              outcome.correct
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-amber-300 bg-amber-50 text-amber-900",
            )}
          >
            <p className="font-semibold">{outcome.correct ? "Correct." : "Not quite."}</p>
            {outcome.explanation && <p className="mt-1">{outcome.explanation}</p>}
            <p className="mt-1 text-xs">
              This check is not marked — it is here so you find out now rather than later.
            </p>
          </div>
        )}
        {failed && (
          <p className="text-sm text-ink-muted">
            Could not reach the server to check that answer. Your earlier steps are saved;
            try again in a moment.
          </p>
        )}
      </div>
    </div>
  );
}

export default CheckStep;
