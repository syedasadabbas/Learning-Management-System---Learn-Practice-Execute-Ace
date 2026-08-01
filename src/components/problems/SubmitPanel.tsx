"use client";

// =============================================================================
// SUBMIT PANEL — the graded result, shared by both workbenches.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// Extracted from ProblemWorkbench.tsx when MarkupWorkbench arrived. It could have
// been imported from there instead, but ProblemWorkbench imports MarkupWorkbench's
// sibling module graph and that would have been a cycle. A shared leaf is the
// simpler shape, and it makes the important property structural: THERE IS EXACTLY
// ONE RENDERING OF A GRADE. A markup submit and a Piston submit produce the same
// `SubmitOutcome` (src/lib/problems/service.ts `recordGradedAttempt`), so if the
// two ever diverge it is a data difference the student can see, not a UI branch
// somebody forgot to update.
//
// A `graded: false` outcome is reported as "not graded", never as a failure. The
// execution contract separates `rate_limited` and `backend_unavailable` from a wrong
// answer precisely so this panel can say which happened — and the service records no
// attempt in that case, so the student's history is not polluted either.
//
// NOTE for markup submissions: `graded: false` for an infrastructure reason cannot
// occur, because nothing is reached over the network. The branch stays because the
// component is shared and because `not_executable` still routes through it.
// =============================================================================

import * as React from "react";

import { Badge, Card } from "@/components/ui";
import type { SubmitOutcome } from "@/lib/problems";

export interface SubmitPanelProps {
  outcome: SubmitOutcome;
  /**
   * Word for one test in this problem's language of instruction. Executed problems
   * run "tests"; a markup problem checks "requirements", and calling a requirement
   * list a test would leave a student looking for a test runner that does not
   * exist.
   */
  unit?: { one: string; many: string };
}

const DEFAULT_UNIT = { one: "test", many: "tests" } as const;

export function SubmitPanel({ outcome, unit = DEFAULT_UNIT }: SubmitPanelProps) {
  if (!outcome.graded) {
    return (
      <Card
        title="Not graded"
        data-testid="problem-submit-deferred"
        action={<Badge tone="warning">{outcome.reason.replace(/_/g, " ")}</Badge>}
      >
        <p className="text-sm text-ink" role="status">
          {outcome.message}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Nothing was recorded, so this does not count as a failed attempt.
          {outcome.reason === "rate_limited" ? " Wait a few seconds and submit again." : ""}
        </p>
      </Card>
    );
  }

  return (
    <Card
      title={outcome.passed ? `All ${unit.many} passed` : `Some ${unit.many} failed`}
      subtitle={`${outcome.passedCount} of ${outcome.totalCount} · ${outcome.runtimeMs} ms`}
      data-testid="problem-submit-result"
      action={
        <Badge tone={outcome.passed ? "success" : "danger"}>
          {outcome.passed ? "solved" : "not yet"}
        </Badge>
      }
    >
      {outcome.newlySolved ? (
        <p className="text-sm text-emerald-800" role="status" data-testid="problem-newly-solved">
          First passing run for this problem. It now counts towards the next level in this
          track.
        </p>
      ) : null}

      <ul className="mt-2 space-y-2">
        {outcome.tests.map((test) => (
          <li key={test.name} className="text-sm" data-testid="problem-submit-test">
            <p className="flex items-center gap-2 text-ink">
              <Badge tone={test.passed ? "success" : "danger"} size="sm">
                {test.passed ? "pass" : "fail"}
              </Badge>
              {test.visible ? test.name : `hidden ${unit.one}`}
            </p>
            {/* A hidden test's diff is deliberately absent: printing the expected
                output here would hand over the test the grade depends on. For a
                markup problem the "expected" side is the requirement list, which is
                every bit as much an answer key — a hidden requirement reading
                `declares .card | margin-inline: auto` IS the answer. */}
            {test.detail && !test.passed ? (
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Expected</p>
                  <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-ink">
                    {test.detail.expected}
                  </pre>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Your result</p>
                  <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-ink">
                    {test.detail.actual}
                  </pre>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {outcome.stderr ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Compiler / runtime output</p>
          <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-red-700">
            {outcome.stderr}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}

export default SubmitPanel;
