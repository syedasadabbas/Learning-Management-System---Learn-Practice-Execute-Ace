"use client";

// =============================================================================
// CODE RUNNER — editor + Run button + output. Owner: code-execution stream.
// -----------------------------------------------------------------------------
// A plain <textarea>, deliberately. Sandpack (already a dependency) is a bundler
// and a CodeMirror editor, and mounting it took the lecture page from 116 kB to
// 377 kB. Interactive-exercises owns the rich HTML/CSS/JS editor; this component
// exists for the "run a snippet and read stdout" case, where a textarea with a
// monospace font costs nothing and works with a screen reader out of the box.
//
// THE RUNTIME IS LOADED ON DEMAND, NOT ON MOUNT.
// `runCode` reaches every runtime through `await import(...)` (see
// src/lib/execution/index.ts), and for Python/SQL the multi-megabyte WebAssembly
// is fetched by the worker from a CDN on first Run. Mounting this component
// therefore downloads nothing beyond this file. Do not "warm up" the runtime in
// an effect — that is the same regression the lecture page already paid for once.
//
// NEVER-THROW, AT THE UI TOO. `runCode` returns failures as values, so there is
// no try/catch here and no error boundary to trip. A `finally`-less `setRunning`
// pair would be a bug if runCode could reject; it cannot.
// =============================================================================

import * as React from "react";

import { Button, Card, cn } from "@/components/ui";
import { LANGUAGE_SPECS, resolveLanguageSpec, runCode, type RunResult } from "@/lib/execution";

import { RunOutput } from "./RunOutput";

export interface CodeRunnerProps {
  /** Untrusted by contract: resolved through the allow-list before any run. */
  language: string;
  /** Starter program. The student edits from here. */
  initialSource?: string;
  /**
   * Fed to the program's stdin. For SQL this is the setup script (schema and
   * fixture rows) — SQLite has no stdin. See sqljs-worker.ts.
   */
  stdin?: string;
  /** Program budget in ms; clamped to [500, 10 000] by the execution module. */
  timeoutMs?: number;
  /**
   * "auto" (default) prefers the in-browser runtime, so practice runs never
   * touch the shared free Piston instance. Pass "server" where the run must
   * happen somewhere the student cannot tamper with.
   */
  backend?: "auto" | "browser" | "server";
  /** Hides the editor for a read-and-predict exercise. */
  readOnly?: boolean;
  label?: string;
  /** Lets a lab or a problem page react to a run without re-running the code. */
  onResult?: (result: RunResult) => void;
  className?: string;
}

export function CodeRunner({
  language,
  initialSource = "",
  stdin,
  timeoutMs,
  backend = "auto",
  readOnly = false,
  label,
  onResult,
  className,
}: CodeRunnerProps) {
  const [source, setSource] = React.useState(initialSource);
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const spec = resolveLanguageSpec(language);
  const heading = label ?? `${spec ? spec.label : language} snippet`;

  // A run in flight when the component unmounts must not call setState. The
  // worker is terminated by the host's own timeout regardless.
  const mounted = React.useRef(true);
  React.useEffect(() => () => {
    mounted.current = false;
  }, []);

  const run = React.useCallback(async () => {
    setRunning(true);
    setResult(null);
    const outcome = await runCode({ language, source, stdin, timeoutMs }, { backend });
    if (!mounted.current) return;
    setRunning(false);
    setResult(outcome);
    onResult?.(outcome);
  }, [backend, language, onResult, source, stdin, timeoutMs]);

  if (!spec) {
    // A content bug (a lecture naming a language we cannot run) should be visible
    // and inert, not a broken Run button that always fails.
    return (
      <Card className={cn("space-y-2", className)}>
        <h3 className="text-sm font-semibold text-ink">{heading}</h3>
        <p className="text-sm text-ink-muted">
          This exercise asks for <code>{language}</code>, which this platform cannot run.
          Supported: {Object.values(LANGUAGE_SPECS).map((s) => s.label).join(", ")}.
        </p>
      </Card>
    );
  }

  const editorId = `code-runner-${spec.id}`;

  return (
    <div className={cn("space-y-3", className)} data-testid="code-runner">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={editorId} className="text-sm font-semibold text-ink">
            {heading}
          </label>
          <span className="text-xs text-ink-muted">
            {spec.label}
            {spec.browserBackend && backend !== "server"
              ? " · runs in your browser"
              : " · runs on the server"}
          </span>
        </div>

        <textarea
          id={editorId}
          data-testid="code-runner-source"
          value={source}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(event) => setSource(event.target.value)}
          rows={Math.min(24, Math.max(6, source.split("\n").length + 1))}
          className={cn(
            "w-full rounded-md border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
            readOnly && "opacity-80",
          )}
        />

        <div className="flex items-center gap-2">
          <Button
            data-testid="code-runner-run"
            onClick={run}
            loading={running}
            disabled={running || source.trim() === ""}
          >
            {running ? "Running…" : "Run"}
          </Button>
          {!readOnly ? (
            <Button
              variant="ghost"
              data-testid="code-runner-reset"
              onClick={() => {
                setSource(initialSource);
                setResult(null);
              }}
              disabled={running || source === initialSource}
            >
              Reset
            </Button>
          ) : null}
        </div>
      </Card>

      <RunOutput result={result} running={running} />
    </div>
  );
}

export default CodeRunner;
