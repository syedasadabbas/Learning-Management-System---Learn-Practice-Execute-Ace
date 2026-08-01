"use client";

// =============================================================================
// <CommonMistakesDisplay /> — "people get this wrong, here is why, here is right".
// Spec: TECHNICAL_SPECIFICATION.md §3.3.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE MISTAKE AND THE CORRECTION ARE LABELLED IN TEXT, NOT PAINTED IN RED AND
// GREEN. The spec's feature list says "colour coding (wrong vs right)". Colour
// is added, but every pair carries the words "Mistake" and "Instead" as visible
// headings first, because a student who cannot distinguish the two tints
// otherwise reads two indistinguishable paragraphs and has no way to tell which
// one to copy. That is WCAG 1.4.1, and it is the failure mode with the worst
// consequence of any accessibility defect in this wave.
//
// `visual_refutation` IS RENDERED AS TEXT, NOT AS HTML. The field name and the
// spec both suggest markup. This component escapes it. `common_mistakes` is a
// jsonb blob on `interview_questions`, authored server-side but reaching the
// browser through the same JSON pipe as everything else, and there is no
// sanitiser in this project's dependency list — the forums stream solved its
// equivalent problem by rendering text, and the same answer is right here for
// the same reason. If a diagram is genuinely needed, the field to use is
// `visual_walkthrough_html`, which the question detail surface renders inside
// the same sandboxed-iframe discipline as SampleCard.
// =============================================================================

import * as React from "react";

import { Card, cn } from "@/components/ui";

export interface CommonMistake {
  mistake: string;
  why_wrong: string;
  correction: string;
  visual_refutation?: string;
}

export interface CommonMistakesDisplayProps {
  mistakes: readonly CommonMistake[];
  className?: string;
}

/**
 * Narrow the `common_mistakes` jsonb blob.
 *
 * Exported because the interview detail surface reads the blob and this is the
 * only place that knows its shape. Malformed entries are dropped, matching
 * `hintsUpTo` in src/lib/learning/projection.ts.
 */
export function readCommonMistakes(value: unknown): CommonMistake[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CommonMistake =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { mistake?: unknown }).mistake === "string" &&
      typeof (item as { why_wrong?: unknown }).why_wrong === "string" &&
      typeof (item as { correction?: unknown }).correction === "string",
  );
}

export function CommonMistakesDisplay({ mistakes, className }: CommonMistakesDisplayProps) {
  if (mistakes.length === 0) return null;

  return (
    <section
      aria-labelledby="common-mistakes-heading"
      className={cn("flex flex-col gap-3", className)}
      data-testid="common-mistakes"
    >
      <h3 id="common-mistakes-heading" className="text-base font-semibold text-ink">
        Common mistakes
      </h3>

      <ul className="flex flex-col gap-3">
        {mistakes.map((item, index) => (
          <li key={`${item.mistake}-${index}`}>
            <Card padded data-testid={`common-mistake-${index}`}>
              <div className="flex flex-col gap-3">
                <div className="rounded-md border-l-4 border-l-red-500 bg-red-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-red-800">
                    Mistake
                  </p>
                  <p className="mt-1 text-sm text-ink">{item.mistake}</p>
                  <p className="mt-2 text-sm text-ink-muted">{item.why_wrong}</p>
                </div>

                <div className="rounded-md border-l-4 border-l-emerald-500 bg-emerald-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                    Instead
                  </p>
                  <p className="mt-1 text-sm text-ink">{item.correction}</p>
                  {item.visual_refutation && (
                    // Escaped, not injected — see the module header.
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">
                      {item.visual_refutation}
                    </pre>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
