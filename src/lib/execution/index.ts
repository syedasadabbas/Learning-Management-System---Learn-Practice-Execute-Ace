// =============================================================================
// CODE EXECUTION BARREL — import from "@/lib/execution" only.
// Owner: code-execution stream. Consumed by grand-quiz, coding-problems and
// interactive-learning.
// -----------------------------------------------------------------------------
// `runCode` is the one entry point a caller needs. It picks a backend; the
// RESULT SHAPE IS IDENTICAL EITHER WAY, so no caller branches on backend. That
// property is the stream's whole contract — see types.ts.
//
// WHY THE PISTON IMPORT IS DYNAMIC.
// piston.ts reads `process.env.PISTON_URL` and owns the process-local rate
// limiter. A static import would drag both into every client bundle that renders a
// lab, and would put a "call Piston directly" code path in the browser where the
// limiter and the allow-list are not enforceable. `await import("./piston")` on
// the server branch only means the browser never receives it.
//
// TRUST BOUNDARY, stated once so no consumer has to infer it:
//   * browser results are ADVISORY — they were produced on the student's machine
//     and can be forged. Fine for a lab, never a source of marks.
//   * marks come from the server backend. Grading code calls `runOnPiston`
//     directly (server-side), or POSTs to /api/execute; either way the run
//     happens where we control it.
// =============================================================================

import { runInBrowser } from "./browser";
import { runOnServer } from "./client";
import { hasBrowserBackend } from "./languages";
import type { RunOptions, RunRequest, RunResult } from "./types";

export type {
  ExecutionLanguage,
  RunBackend,
  RunCode,
  RunFailure,
  RunFailureReason,
  RunOptions,
  RunRequest,
  RunResult,
  RunSuccess,
  StreamTruncation,
} from "./types";
export { shouldDeferToInstructor } from "./types";

export {
  EXECUTION_LANGUAGES,
  LANGUAGE_SPECS,
  hasBrowserBackend,
  resolveLanguage,
  resolveLanguageSpec,
} from "./languages";
export type { LanguageSpec } from "./languages";

export {
  clampTimeoutMs,
  COMPILE_TIMEOUT_MS,
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_RUN_TIMEOUT_MS,
  MIN_RUN_TIMEOUT_MS,
  NETWORK_SLACK_MS,
} from "./timeouts";

export {
  clipInput,
  MAX_SOURCE_CHARS,
  MAX_STDIN_CHARS,
  MAX_STREAM_CHARS,
  truncateStream,
} from "./truncate";
export type { TruncatedStream } from "./truncate";

export { runInBrowser } from "./browser";
export { EXECUTE_ENDPOINT, runOnServer } from "./client";

// `runOnPiston` is deliberately NOT re-exported here. Server-side graders import
// it from "@/lib/execution/piston" directly, which keeps the Piston client and
// the rate limiter out of every client bundle that touches this barrel. It is the
// one sanctioned deep import into this module.

/**
 * Run a program, choosing a backend. Satisfies `RunCode`; never throws.
 *
 * Selection, in order:
 *   1. `options.backend === "server"` → always the server (grading, and the
 *      compiled languages the browser cannot host).
 *   2. `options.backend === "browser"` → always the browser; an unsupported
 *      language comes back as `unsupported_language` rather than silently
 *      escalating to the server, because a caller that asked for "no server" is
 *      usually a lab that must work with Piston down.
 *   3. "auto" (default): browser when the language has an in-browser runtime,
 *      server otherwise. This keeps practice runs off the shared free Piston
 *      instance entirely, which is what makes 50–80 concurrent students free.
 *
 * On the server there is no browser runtime at all, so every call resolves to
 * Piston regardless of preference.
 */
export async function runCode(
  request: RunRequest,
  options: RunOptions = {},
): Promise<RunResult> {
  const preference = options.backend ?? "auto";
  const inBrowser = typeof window !== "undefined";

  if (!inBrowser) {
    const { runOnPiston } = await import("./piston");
    return runOnPiston(request, options);
  }

  if (preference === "server") return runOnServer(request, options);
  if (preference === "browser") return runInBrowser(request, options);
  return hasBrowserBackend(request.language)
    ? runInBrowser(request, options)
    : runOnServer(request, options);
}
