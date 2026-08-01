// =============================================================================
// BROWSER BACKEND — `runInBrowser`, satisfying the same `RunCode` interface as
// the Piston backend. Owner: code-execution stream.
// -----------------------------------------------------------------------------
// LAZINESS IS THE POINT OF THIS FILE.
// Every runtime is reached through `await import(...)` inside the branch that
// needs it, so importing this module costs a few hundred bytes and a page that
// never runs Python never downloads the Python path. Pyodide's ~10 MB is fetched
// by the worker from a CDN on first use, so it is not in ANY of our chunks — see
// pyodide-worker.ts for the trade-off that buys and what it costs.
//
// A static `import { buildPyodideWorkerScript } from "./pyodide-worker"` here
// would still be small (the file is a string builder), but the dynamic form keeps
// the "runtime code is only loaded on demand" rule mechanical rather than a thing
// each future contributor has to reason about.
//
// Truncation, timeout clamping and the never-throw contract are inherited from
// worker-host.ts and clampTimeoutMs, so the two backends cannot drift on them.
// =============================================================================

import { resolveLanguageSpec } from "../languages";
import { clampTimeoutMs } from "../timeouts";
import { clipInput, MAX_SOURCE_CHARS, MAX_STDIN_CHARS } from "../truncate";
import type { RunOptions, RunRequest, RunResult } from "../types";
import { runInWorker } from "./worker-host";

/** Languages with an in-browser backend, for a UI that offers "run locally". */
export const BROWSER_RUNNABLE = ["javascript", "python", "sql"] as const;

/**
 * Run a program entirely in the student's browser. Never throws.
 *
 * `options.fetchImpl` / `userKey` are accepted and ignored: there is no server
 * call and no shared budget to protect, which is exactly why labs use this path.
 * Accepting them keeps the signature identical to `runOnPiston` so a caller can
 * hold either one in a `RunCode`-typed variable.
 */
export async function runInBrowser(
  request: RunRequest,
  _options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = clampTimeoutMs(request.timeoutMs);
  const spec = resolveLanguageSpec(request.language);

  if (!spec || !spec.browserBackend) {
    return {
      ok: false,
      reason: "unsupported_language",
      message: spec
        ? `${spec.label} cannot run in the browser — it needs the server runner.`
        : `"${String(request.language).slice(0, 40)}" is not a language this platform can run.`,
      stdout: "",
      stderr: "",
      exitCode: null,
      runtimeMs: 0,
      // "worker" is the honest label for the backend that would have run it; no
      // consumer branches on this field (see types.ts).
      backend: "worker",
      truncated: { stdout: false, stderr: false },
      language: spec?.id ?? null,
    };
  }

  const source = clipInput(request.source, MAX_SOURCE_CHARS);
  if (source.clipped) {
    return {
      ok: false,
      reason: "unsupported_language",
      message: `The program is longer than ${MAX_SOURCE_CHARS} characters and was not run.`,
      stdout: "",
      stderr: "",
      exitCode: null,
      runtimeMs: 0,
      backend: spec.browserBackend,
      truncated: { stdout: false, stderr: false },
      language: spec.id,
    };
  }
  const payload = {
    source: source.text,
    stdin: clipInput(request.stdin ?? "", MAX_STDIN_CHARS).text,
  };

  const script = await loadScript(spec.browserBackend);
  return runInWorker({
    script,
    payload,
    timeoutMs,
    backend: spec.browserBackend,
    language: spec.id,
  });
}

/** Load only the script builder the requested backend needs. */
async function loadScript(backend: "worker" | "pyodide" | "sqljs"): Promise<string> {
  if (backend === "pyodide") {
    const mod = await import("./pyodide-worker");
    return mod.buildPyodideWorkerScript();
  }
  if (backend === "sqljs") {
    const mod = await import("./sqljs-worker");
    return mod.buildSqlJsWorkerScript();
  }
  const mod = await import("./js-worker");
  return mod.buildJsWorkerScript();
}

export { runInWorker } from "./worker-host";
export type { WorkerMessage, WorkerRunSpec } from "./worker-host";
