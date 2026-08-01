// =============================================================================
// WORKER HOST — runs a generated worker script and turns it into a `RunResult`.
// Owner: code-execution stream. Browser-only (guarded); no Node code path.
// -----------------------------------------------------------------------------
// WHY A WORKER AND NOT `eval` / an iframe.
//   * `eval` on the main thread cannot be stopped. A student's `while (true) {}`
//     would freeze the tab, and during a lab that looks like the app crashing.
//     `worker.terminate()` is the only way to stop synchronous JavaScript, which
//     is why EVERY browser backend here — including Python and SQL — is hosted in
//     a worker rather than run on the main thread.
//   * A worker has no DOM, no `document.cookie` and no access to the page's
//     session, so a snippet cannot read the student's own credentials.
//
// WHY A BLOB URL AND NOT A FILE IN /public.
// The script text is built in the caller's module and turned into a worker here,
// so the bundler never emits a separate worker chunk and there is no public URL
// serving executable code. It does require `worker-src blob:` if a Content
// Security Policy is ever added to this app — flagged in the stream report.
//
// PARTIAL OUTPUT ON TIMEOUT.
// A synchronous infinite loop never yields, so a worker that only posted its
// result at the end would return nothing for exactly the case a student most
// needs to see. The generated scripts therefore post a snapshot at most every
// PARTIAL_INTERVAL_MS; this host keeps the latest one and returns it with the
// `timeout` result. Rate-limiting the snapshots is what stops a print loop from
// flooding the main thread with messages.
// =============================================================================

import { truncateStream } from "../truncate";
import type { ExecutionLanguage, RunBackend, RunResult } from "../types";

/** Minimum gap between partial-output snapshots from a worker, in ms. */
export const PARTIAL_INTERVAL_MS = 200;

/** Messages a generated worker script may post. Keep in sync with the scripts. */
export type WorkerMessage =
  | { kind: "partial"; stdout: string; stderr: string }
  | { kind: "done"; stdout: string; stderr: string; exitCode: number }
  | { kind: "fatal"; message: string };

export interface WorkerRunSpec {
  /** Full source of the worker script (built by a `*-worker.ts` module). */
  script: string;
  /** Program text and stdin, passed as data — never interpolated into `script`. */
  payload: { source: string; stdin: string };
  timeoutMs: number;
  backend: Extract<RunBackend, "worker" | "pyodide" | "sqljs">;
  language: ExecutionLanguage;
}

function build(
  spec: WorkerRunSpec,
  runtimeMs: number,
  parts: { stdout: string; stderr: string },
  exit: { ok: true; exitCode: number } | { ok: false; reason: "timeout" | "backend_unavailable"; message: string },
): RunResult {
  const stdout = truncateStream(parts.stdout);
  const stderr = truncateStream(parts.stderr);
  const common = {
    stdout: stdout.text,
    stderr: stderr.text,
    runtimeMs,
    backend: spec.backend,
    truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
  };
  return exit.ok
    ? { ...common, ok: true, exitCode: exit.exitCode, language: spec.language }
    : {
        ...common,
        ok: false,
        reason: exit.reason,
        message: exit.message,
        exitCode: null,
        language: spec.language,
      };
}

/**
 * Execute `spec` in a dedicated worker and resolve — never reject — with a
 * `RunResult`.
 *
 * The promise is settled exactly once: `settle` guards against the race where a
 * worker posts `done` in the same task as the timeout fires.
 */
export function runInWorker(spec: WorkerRunSpec): Promise<RunResult> {
  const startedAt = Date.now();

  if (typeof Worker === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(
      build(spec, 0, { stdout: "", stderr: "" }, {
        ok: false,
        reason: "backend_unavailable",
        message: "This browser cannot run code locally (Web Workers unavailable).",
      }),
    );
  }

  return new Promise<RunResult>((resolve) => {
    const blobUrl = URL.createObjectURL(new Blob([spec.script], { type: "text/javascript" }));
    let worker: Worker;
    try {
      worker = new Worker(blobUrl);
    } catch (error) {
      URL.revokeObjectURL(blobUrl);
      resolve(
        build(spec, Date.now() - startedAt, { stdout: "", stderr: "" }, {
          ok: false,
          reason: "backend_unavailable",
          message: `The local runner could not start: ${describe(error)}`,
        }),
      );
      return;
    }

    let latest = { stdout: "", stderr: "" };
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    const settle = (result: RunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle(
        build(spec, Date.now() - startedAt, latest, {
          ok: false,
          reason: "timeout",
          message:
            `The program was still running after ${spec.timeoutMs} ms and was stopped. ` +
            "Any output above is what it produced before then.",
        }),
      );
    }, spec.timeoutMs);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.kind === "partial") {
        latest = { stdout: message.stdout, stderr: message.stderr };
        return;
      }
      if (message.kind === "done") {
        settle(
          build(
            spec,
            Date.now() - startedAt,
            { stdout: message.stdout, stderr: message.stderr },
            { ok: true, exitCode: message.exitCode },
          ),
        );
        return;
      }
      // "fatal" = the runtime itself failed to load (e.g. the Pyodide CDN is
      // blocked). That is infrastructure, not the student's code, so it maps to
      // backend_unavailable — which grand-quiz defers instead of scoring zero.
      settle(
        build(spec, Date.now() - startedAt, latest, {
          ok: false,
          reason: "backend_unavailable",
          message: message.message,
        }),
      );
    };

    // A worker `error` event is a load failure or an uncaught throw outside our
    // own try/catch. Either way the run has no exit status.
    worker.onerror = (event: ErrorEvent) => {
      settle(
        build(spec, Date.now() - startedAt, latest, {
          ok: false,
          reason: "backend_unavailable",
          message: event.message || "The local runner stopped unexpectedly.",
        }),
      );
    };

    worker.postMessage(spec.payload);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
