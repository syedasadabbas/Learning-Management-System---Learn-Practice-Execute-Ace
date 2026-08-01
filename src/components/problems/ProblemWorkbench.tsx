"use client";

// =============================================================================
// PROBLEM WORKBENCH — editor, Run, Submit. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// RUN AND SUBMIT ARE DIFFERENT OPERATIONS, and the labels say so:
//
//   Run    — the VISIBLE tests only, in the student's own browser via `runCode`.
//            Free, unlimited, and advisory: the execution stream's contract states
//            a browser result "can be forged", so nothing is recorded and no
//            attempt row is written. This is the practice loop.
//   Submit — ALL tests, graded on the server. The hidden tests exist only there
//            (src/lib/problems/payload.ts), so this is the only operation that can
//            produce a verdict, and the only one that records an attempt.
//
// Conflating them is how a student comes to believe passing the examples is
// passing, so the button text, the count and the result panel all distinguish them.
//
// A PLAIN <textarea>, deliberately, following src/components/execution/CodeRunner.tsx:
// mounting Sandpack took the lecture page from 116 kB to 377 kB, and a monospace
// textarea works with a screen reader out of the box. The runtimes themselves are
// still lazy — `runCode` reaches every one through `await import(...)`, and Pyodide's
// ~10 MB is fetched by the worker on first Run — so mounting this component
// downloads nothing extra. Do not "warm up" a runtime in an effect.
//
// NEVER THROWS AT THE UI. `runCode` returns failures as values, so there is no
// try/catch around it and no error boundary to trip. The one `try` below is around
// `fetch`, which genuinely can reject.
//
// NOT USED FOR HTML OR CSS. Since 2026-07-31 those go to MarkupWorkbench, which
// mounts the interactive-exercises Sandpack editor with a live preview and submits
// against structural requirements instead of stdout. ProblemView chooses between the
// two — on the SERVER, so a JavaScript problem never downloads Sandpack. The
// textarea argument above still holds for everything that executes: a monospace
// textarea is lighter and works with a screen reader out of the box, and a program
// that prints to stdout has no preview to render.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, cn } from "@/components/ui";
import { runCode, type RunResult } from "@/lib/execution";
import {
  buildRunRequest,
  canonicalise,
  comparisonModeFor,
  isExecutable,
  outputMatches,
  requiresServerRuntime,
  type StudentProblem,
  type SubmitOutcome,
} from "@/lib/problems";

import { SubmitPanel } from "./SubmitPanel";

export interface ProblemWorkbenchProps {
  problem: StudentProblem;
}

/** One visible test's local (advisory) outcome. */
interface LocalResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  message: string | null;
}

export function ProblemWorkbench({ problem }: ProblemWorkbenchProps) {
  const [source, setSource] = React.useState(problem.starterCode);
  const [running, setRunning] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [localResults, setLocalResults] = React.useState<LocalResult[] | null>(null);
  const [outcome, setOutcome] = React.useState<SubmitOutcome | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [revealedHints, setRevealedHints] = React.useState(0);

  const mounted = React.useRef(true);
  React.useEffect(() => () => {
    mounted.current = false;
  }, []);

  const mode = comparisonModeFor(problem.language);

  // -------------------------------------------------------------------------
  // THE RUN/SUBMIT GATE. Item 3 of the product owner's list.
  //
  // A problem that needs the server runner, with the server runner down, is
  // presented exactly like a reference-only problem: no Run, no Submit, and the
  // worked answer instead. That much was already right. What was WRONG was the
  // test for "needs the server runner": it read `problem.execution !== "piston"`,
  // i.e. it trusted the seeded intent instead of asking whether the language has
  // anywhere else to run.
  //
  // For C and C++ those differ. `browserBackend` is null for both
  // (src/lib/execution/languages.ts), so `runCode(..., { backend: "auto" })` sends
  // their Run to Piston regardless of what `execution` says — meaning a row marked
  // `browser` skipped the availability probe server-side, rendered a Run button,
  // and returned `backend_unavailable` on every click during an outage. That is the
  // very thing the HTML/CSS gate exists to prevent, arrived at from the other
  // direction. `requiresServerRuntime` is now the single answer, used here, by
  // `loadProblem`'s probe decision and by `mayRevealSolution`.
  //
  // Latent, not live: no seeded row declares that combination today, and
  // validate.ts now refuses to create one. Kept anyway, because a row can reach the
  // database from the admin console without passing the seed validator.
  // -------------------------------------------------------------------------
  const needsServer = requiresServerRuntime(problem.language, problem.execution);
  const runnable =
    isExecutable(problem.execution) && (!needsServer || problem.serverGradingAvailable);

  const run = React.useCallback(async () => {
    setRunning(true);
    setLocalResults(null);
    setOutcome(null);
    setSubmitError(null);

    const results: LocalResult[] = [];
    for (const test of problem.visibleTests) {
      const request = buildRunRequest({
        language: problem.language,
        code: source,
        input: test.input,
        mode,
        target: "browser",
      });
      const result: RunResult = await runCode(
        { ...request, timeoutMs: problem.timeLimitMs },
        // "auto" prefers the in-browser runtime and falls back to the server only
        // for a language that has none (C++). That keeps practice off the shared
        // free Piston instance, which is what makes a whole cohort free.
        { backend: "auto" },
      );

      const passed =
        result.ok &&
        result.exitCode === 0 &&
        outputMatches(result.stdout, test.expectedOutput, mode);

      results.push({
        name: test.name,
        passed,
        expected: canonicalise(test.expectedOutput, mode),
        actual: canonicalise(result.stdout, mode),
        message: result.ok
          ? result.stderr.trim() || null
          : `${result.message} (${result.reason})`,
      });
    }

    if (!mounted.current) return;
    setLocalResults(results);
    setRunning(false);
  }, [mode, problem.language, problem.timeLimitMs, problem.visibleTests, source]);

  const submit = React.useCallback(async () => {
    setSubmitting(true);
    setOutcome(null);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/problems/${encodeURIComponent(problem.slug)}/attempt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only the code. The server re-runs every test itself — see the route's
        // header for why a client-reported pass count is not accepted.
        body: JSON.stringify({ code: source }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !(body as { ok?: boolean }).ok) {
        const error = (body as { error?: string }).error;
        setSubmitError(error ?? `The grader answered ${response.status}.`);
      } else {
        setOutcome((body as { data: SubmitOutcome }).data);
      }
    } catch {
      setSubmitError("Could not reach the grader. Your work is still in the editor.");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [problem.slug, source]);

  const editorId = `problem-editor-${problem.slug}`;

  return (
    <div className="space-y-4" data-testid="problem-workbench">
      {/* ---- Hints, revealed one at a time ---------------------------------- */}
      {problem.hints.length > 0 ? (
        <Card
          title="Hints"
          subtitle={`${revealedHints} of ${problem.hints.length} shown`}
          data-testid="problem-hints"
        >
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
            {problem.hints.slice(0, revealedHints).map((hint, index) => (
              <li key={index} data-testid="problem-hint">
                {hint}
              </li>
            ))}
          </ol>
          {revealedHints < problem.hints.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              data-testid="problem-hint-reveal"
              onClick={() => setRevealedHints((n) => n + 1)}
            >
              {revealedHints === 0 ? "Show a hint" : "Show another hint"}
            </Button>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">That is every hint for this problem.</p>
          )}
        </Card>
      ) : null}

      {/* ---- Worked examples ------------------------------------------------ */}
      {problem.visibleTests.length > 0 ? (
        <Card title="Examples" data-testid="problem-examples">
          <ul className="space-y-3">
            {problem.visibleTests.map((test) => (
              <li key={test.id} className="text-sm" data-testid="problem-example">
                <p className="font-medium text-ink">{test.name}</p>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      {mode === "sql" ? "Setup" : "Input"}
                    </p>
                    <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-ink">
                      {test.input ?? ""}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">Expected</p>
                    <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-ink">
                      {test.expectedOutput ?? ""}
                    </pre>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---- Editor --------------------------------------------------------- */}
      {runnable ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={editorId} className="text-sm font-semibold text-ink">
              Your solution
            </label>
            <span className="text-xs text-ink-muted" data-testid="problem-run-location">
              {problem.language}
              {/* Keyed off `needsServer`, not off `execution`. The old form claimed
                  "runs in your browser" for any non-piston row, which is false for a
                  language with no in-browser toolchain — the student would be told
                  their C++ Run is local while it is in fact a Piston call on the
                  shared free instance. */}
              {needsServer ? " · runs on the server" : " · runs in your browser"}
            </span>
          </div>

          <textarea
            id={editorId}
            data-testid="problem-editor"
            value={source}
            spellCheck={false}
            onChange={(event) => setSource(event.target.value)}
            rows={Math.min(28, Math.max(10, source.split("\n").length + 2))}
            className={cn(
              "w-full rounded-md border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
            )}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              data-testid="problem-run"
              onClick={run}
              loading={running}
              disabled={running || submitting || source.trim() === "" || problem.visibleTests.length === 0}
            >
              {running
                ? "Running…"
                : `Run ${problem.visibleTests.length} example${problem.visibleTests.length === 1 ? "" : "s"}`}
            </Button>
            <Button
              data-testid="problem-submit"
              onClick={submit}
              loading={submitting}
              disabled={running || submitting || source.trim() === ""}
            >
              {submitting
                ? "Grading…"
                : `Submit for all ${problem.visibleTests.length + problem.hiddenTestCount} tests`}
            </Button>
            <Button
              variant="ghost"
              data-testid="problem-reset"
              onClick={() => {
                setSource(problem.starterCode);
                setLocalResults(null);
                setOutcome(null);
                setSubmitError(null);
              }}
              disabled={running || submitting || source === problem.starterCode}
            >
              Reset
            </Button>
          </div>

          <p className="text-xs text-ink-muted">
            Run checks the {problem.visibleTests.length} example
            {problem.visibleTests.length === 1 ? "" : "s"} above in your browser and records
            nothing. Submit runs {problem.hiddenTestCount} further hidden test
            {problem.hiddenTestCount === 1 ? "" : "s"} on the server, and only a submit can
            mark the problem solved.
          </p>
        </Card>
      ) : (
        <Card
          title="No automatic checking for this problem"
          data-testid="problem-reference-only"
          action={<Badge tone="neutral">Reference solution</Badge>}
        >
          <p className="text-sm text-ink-muted">
            {problem.execution === "none"
              ? `This problem asks for a judgement rather than something a checker can mark right or wrong, so it is presented with a worked answer to compare against. Write your version first, then read the reference.`
              : "The server-side runner is unreachable, so this problem cannot be graded right now. The worked answer is below; the Run and Submit buttons will come back when the runner does."}
          </p>
        </Card>
      )}

      {/* ---- Local (advisory) results --------------------------------------- */}
      {localResults ? (
        <Card
          title="Example results"
          subtitle="Checked in your browser. Nothing recorded — submit to be marked."
          data-testid="problem-run-results"
          action={
            <Badge tone={localResults.every((r) => r.passed) ? "success" : "warning"}>
              {localResults.filter((r) => r.passed).length} of {localResults.length} passed
            </Badge>
          }
        >
          <ul className="space-y-3">
            {localResults.map((result) => (
              <li key={result.name} className="text-sm" data-testid="problem-run-result">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <Badge tone={result.passed ? "success" : "danger"} size="sm">
                    {result.passed ? "pass" : "fail"}
                  </Badge>
                  {result.name}
                </p>
                {!result.passed ? (
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Expected</p>
                      <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-ink">
                        {result.expected}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">You printed</p>
                      <pre className="overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-ink">
                        {result.actual}
                      </pre>
                    </div>
                  </div>
                ) : null}
                {result.message ? (
                  <pre className="mt-1 overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-xs text-red-700">
                    {result.message}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---- Submit outcome -------------------------------------------------- */}
      {submitError ? (
        <Card data-testid="problem-submit-error">
          <p className="text-sm text-red-700" role="alert">
            {submitError}
          </p>
        </Card>
      ) : null}

      {outcome ? <SubmitPanel outcome={outcome} /> : null}
    </div>
  );
}

export default ProblemWorkbench;
