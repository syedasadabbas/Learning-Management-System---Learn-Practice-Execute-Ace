"use client";

// =============================================================================
// RUN OUTPUT — presents one `RunResult`. Owner: code-execution stream.
// -----------------------------------------------------------------------------
// Purely presentational and backend-agnostic: it takes a `RunResult` and never
// asks which engine produced it, which is the property types.ts exists to give.
//
// WHY THE FOUR FAILURE REASONS GET DIFFERENT PROSE.
// A student who sees "something went wrong" for a rate-limited run will retype
// correct code looking for a bug that is not there. Each reason therefore says
// whose problem it is and what to do:
//   timeout              -> your program is looping; look at your loop
//   unsupported_language -> the platform cannot run this; nothing you can fix
//   rate_limited         -> the service is busy; your answer is NOT wrong
//   backend_unavailable  -> the service is down; your answer is NOT wrong
// The last two also say the work will be reviewed rather than marked wrong,
// because that is what the grand-quiz stream actually does with them.
//
// ACCESSIBILITY: the status line is a polite live region so a screen-reader user
// hears that the run finished; the output itself is not live, or every line of a
// streaming program would be announced.
// =============================================================================

import { Badge, Card, cn } from "@/components/ui";
import type { RunResult } from "@/lib/execution";

export interface RunOutputProps {
  /** null before the first run. */
  result: RunResult | null;
  running: boolean;
  className?: string;
}

/** Badge tone and label for a result. Non-zero exit is a warning, not an error:
 *  a failing test IS the answer, and red would read as "the platform broke". */
function summarise(result: RunResult): {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  detail: string;
} {
  if (result.ok) {
    return result.exitCode === 0
      ? {
          tone: "success",
          label: `Finished in ${result.runtimeMs} ms`,
          detail: "",
        }
      : {
          tone: "warning",
          label: `Exited with code ${result.exitCode} after ${result.runtimeMs} ms`,
          detail: "The program ran but reported an error. The details are below.",
        };
  }

  switch (result.reason) {
    case "timeout":
      return {
        tone: "warning",
        label: "Stopped — took too long",
        detail: result.message,
      };
    case "unsupported_language":
      return { tone: "neutral", label: "Cannot be run here", detail: result.message };
    case "rate_limited":
      return {
        tone: "warning",
        label: "The runner is busy",
        detail: `${result.message} Your answer has not been marked wrong.`,
      };
    case "backend_unavailable":
    default:
      return {
        tone: "danger",
        label: "The runner is unavailable",
        detail: `${result.message} Your answer has not been marked wrong — it will be reviewed.`,
      };
  }
}

export function RunOutput({ result, running, className }: RunOutputProps) {
  const summary = result ? summarise(result) : null;

  return (
    <Card className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Output</h3>
        <div data-testid="run-status" role="status" aria-live="polite" className="text-xs">
          {running ? (
            <Badge tone="brand" dot>
              Running…
            </Badge>
          ) : summary ? (
            <Badge tone={summary.tone} dot data-testid="run-summary">
              {summary.label}
            </Badge>
          ) : (
            <span className="text-ink-muted">Not run yet</span>
          )}
        </div>
      </div>

      {summary?.detail ? (
        <p data-testid="run-detail" className="text-xs text-ink-muted">
          {summary.detail}
        </p>
      ) : null}

      {result && result.truncated.stdout ? (
        <p className="text-xs text-amber-800">
          The output was longer than this panel will show and has been cut short.
        </p>
      ) : null}

      {/* Two separate panes: merging them would leave a student guessing which
          line came from an error. Empty streams are omitted entirely rather than
          rendering an empty black box. */}
      {result && result.stdout !== "" ? (
        <pre
          data-testid="run-stdout"
          className="max-h-72 overflow-auto rounded-md bg-surface p-3 text-xs leading-relaxed text-ink"
        >
          {result.stdout}
        </pre>
      ) : null}

      {result && result.stderr !== "" ? (
        <pre
          data-testid="run-stderr"
          className="max-h-72 overflow-auto rounded-md bg-red-50 p-3 text-xs leading-relaxed text-red-900"
        >
          {result.stderr}
        </pre>
      ) : null}

      {result && result.stdout === "" && result.stderr === "" && !running ? (
        <p className="text-xs text-ink-muted">The program produced no output.</p>
      ) : null}
    </Card>
  );
}
