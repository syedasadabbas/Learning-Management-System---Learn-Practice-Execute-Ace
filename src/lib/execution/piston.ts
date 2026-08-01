// =============================================================================
// PISTON BACKEND — server-side execution. Owner: code-execution stream.
// Unit-tested in piston.test.ts with `fetch` injected; no test touches a network.
// -----------------------------------------------------------------------------
// Piston (github.com/engineer-man/piston) is the free, open-source, keyless
// replacement for Judge0/RapidAPI chosen in FREE_STACK.md. It sandboxes each run
// in its own container, which is why grading untrusted student code happens HERE
// and never with `eval` or `vm` inside our Node process — a Node sandbox escape
// would be an escape into the process holding the database credentials.
//
// EVERY EXIT FROM THIS FILE IS A `RunResult`. There is no `throw`, and the single
// `try` wraps the entire network interaction including `response.json()`. See
// types.ts for why: grand-quiz calls this inside an exam submission.
//
// HTTP STATUS MAPPING, and why 429 is special:
//   429            -> rate_limited        (defer to instructor, never score 0)
//   400 (bad body) -> backend_unavailable (our bug or an unknown runtime; the
//                     student's code is not implicated, so do not score it 0)
//   5xx / network  -> backend_unavailable
//   AbortSignal    -> timeout
//   200            -> success, exit code from run.code (or the compile stage)
// A non-zero exit code is NOT a failure of this function. A program that prints
// the wrong answer and exits 0, and one that throws and exits 1, are both facts
// the caller must be able to grade — so both come back `ok: true`.
// =============================================================================

import { resolveLanguageSpec } from "./languages";
import { checkRunAllowance } from "./rate-limit";
import {
  clampTimeoutMs,
  COMPILE_TIMEOUT_MS,
  NETWORK_SLACK_MS,
} from "./timeouts";
import {
  clipInput,
  MAX_SOURCE_CHARS,
  MAX_STDIN_CHARS,
  truncateStream,
} from "./truncate";
import type {
  ExecutionLanguage,
  RunFailureReason,
  RunOptions,
  RunRequest,
  RunResult,
} from "./types";

/** The free public instance. Override with PISTON_URL to point at a self-host. */
export const DEFAULT_PISTON_URL = "https://emkc.org/api/v2/piston";

/** Shape of the parts of Piston's v2 response we rely on. */
interface PistonStage {
  stdout?: string | null;
  stderr?: string | null;
  code?: number | null;
  signal?: string | null;
}
interface PistonResponse {
  run?: PistonStage;
  compile?: PistonStage;
  message?: string;
}

/** Base URL, without a trailing slash. */
export function pistonBaseUrl(override?: string): string {
  const raw = (override ?? process.env.PISTON_URL ?? DEFAULT_PISTON_URL).trim();
  return raw.replace(/\/+$/, "");
}

/**
 * Build the failure value for a reason. Centralised so no branch below can
 * forget to truncate or to report a runtime.
 */
function failure(
  reason: RunFailureReason,
  message: string,
  runtimeMs: number,
  language: ExecutionLanguage | null,
  partial: { stdout?: string; stderr?: string } = {},
): RunResult {
  const stdout = truncateStream(partial.stdout);
  const stderr = truncateStream(partial.stderr);
  return {
    ok: false,
    reason,
    message,
    stdout: stdout.text,
    stderr: stderr.text,
    exitCode: null,
    runtimeMs,
    backend: "piston",
    truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
    language,
  };
}

/**
 * Run one program on Piston. Satisfies `RunCode`.
 *
 * @param request  language is untrusted and resolved through the allow-list
 * @param options  `fetchImpl`/`now`/`pistonUrl` are injected by tests;
 *                 `userKey` enables per-user rate limiting; `skipRateLimit` is
 *                 set only by the API route, which has already limited.
 */
export async function runOnPiston(
  request: RunRequest,
  options: RunOptions = {},
): Promise<RunResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const doFetch = options.fetchImpl ?? fetch;

  // 1. Allow-list first. Refusing an unknown language before spending a network
  //    round trip also guarantees nothing unlisted can reach the instance.
  const spec = resolveLanguageSpec(request.language);
  if (!spec) {
    return failure(
      "unsupported_language",
      `"${String(request.language).slice(0, 40)}" is not a language this platform can run.`,
      now() - startedAt,
      null,
    );
  }

  // 2. Refuse an oversized program rather than run a clipped one — half a file
  //    produces a syntax error the student cannot account for.
  const source = clipInput(request.source, MAX_SOURCE_CHARS);
  if (source.clipped) {
    return failure(
      "unsupported_language",
      `The program is longer than ${MAX_SOURCE_CHARS} characters and was not run.`,
      now() - startedAt,
      spec.id,
    );
  }
  const stdin = clipInput(request.stdin ?? "", MAX_STDIN_CHARS).text;

  // 3. Our own limiter, before Piston's. `userKey` absent means a server-internal
  //    caller (grand-quiz grading its own batch) which is already serialised;
  //    charging it to a shared bucket would let one exam starve another.
  if (!options.skipRateLimit && options.userKey) {
    const allowance = checkRunAllowance(options.userKey, startedAt);
    if (!allowance.allowed) {
      return failure("rate_limited", allowance.message, now() - startedAt, spec.id);
    }
  }

  const runTimeoutMs = clampTimeoutMs(request.timeoutMs);
  const url = `${pistonBaseUrl(options.pistonUrl)}/execute`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(runTimeoutMs + NETWORK_SLACK_MS),
      body: JSON.stringify({
        language: spec.pistonLanguage,
        version: spec.pistonVersion,
        files: [{ name: spec.filename, content: source.text }],
        stdin,
        // Piston's own budgets, in ms. Set even though we also abort the fetch:
        // if only the fetch aborted, the container would keep burning the shared
        // instance's CPU after we stopped waiting for it.
        run_timeout: runTimeoutMs,
        compile_timeout: COMPILE_TIMEOUT_MS,
      }),
    });
  } catch (error) {
    const elapsed = now() - startedAt;
    // AbortSignal.timeout rejects with a TimeoutError DOMException. Everything
    // else here is DNS/TLS/connection-refused, i.e. the backend is not there.
    const isTimeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return isTimeout
      ? failure(
          "timeout",
          `The program did not finish within ${runTimeoutMs} ms.`,
          elapsed,
          spec.id,
        )
      : failure(
          "backend_unavailable",
          `The code execution service could not be reached after ${elapsed} ms.`,
          elapsed,
          spec.id,
        );
  }

  // 4. 429 is its own reason, distinguishable from a wrong answer. grand-quiz
  //    defers these to instructor grading; scoring them 0 would zero correct
  //    answers whenever the shared instance was merely busy.
  if (response.status === 429) {
    return failure(
      "rate_limited",
      "The shared code execution service is rate-limiting requests. This run was not " +
        "scored — it will be reviewed rather than marked wrong.",
      now() - startedAt,
      spec.id,
    );
  }

  if (!response.ok) {
    return failure(
      "backend_unavailable",
      `The code execution service returned HTTP ${response.status}.`,
      now() - startedAt,
      spec.id,
    );
  }

  let body: PistonResponse;
  try {
    body = (await response.json()) as PistonResponse;
  } catch {
    return failure(
      "backend_unavailable",
      "The code execution service returned a response that could not be read.",
      now() - startedAt,
      spec.id,
    );
  }

  const runtimeMs = now() - startedAt;
  const run = body.run;
  if (!run) {
    // A 200 with no run stage means the request was accepted but nothing ran —
    // treat as infrastructure, not as a student error.
    return failure(
      "backend_unavailable",
      body.message
        ? `The code execution service reported: ${body.message}`
        : "The code execution service returned no run result.",
      runtimeMs,
      spec.id,
    );
  }

  // 5. A compile failure is a real, gradeable outcome: report the compiler's
  //    stderr with its exit code rather than an infrastructure failure, or the
  //    student never sees why their C++ did not build.
  const compile = body.compile;
  if (compile && typeof compile.code === "number" && compile.code !== 0) {
    const stdout = truncateStream(compile.stdout ?? "");
    const stderr = truncateStream(compile.stderr ?? "");
    return {
      ok: true,
      exitCode: compile.code,
      stdout: stdout.text,
      stderr: stderr.text,
      runtimeMs,
      backend: "piston",
      truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
      language: spec.id,
    };
  }

  // 6. Piston kills an over-budget program with a signal and reports a null exit
  //    code. That is the server-side face of a timeout, and it must map to the
  //    same reason as our own abort so a caller has one case to handle.
  const killed = run.signal === "SIGKILL" || run.signal === "SIGTERM";
  if (killed && (run.code === null || run.code === undefined)) {
    return failure(
      "timeout",
      `The program did not finish within ${runTimeoutMs} ms and was stopped.`,
      runtimeMs,
      spec.id,
      { stdout: run.stdout ?? "", stderr: run.stderr ?? "" },
    );
  }

  const stdout = truncateStream(run.stdout ?? "");
  const stderr = truncateStream(run.stderr ?? "");
  return {
    ok: true,
    // A signalled process with no numeric code that was NOT SIGKILL/SIGTERM
    // (e.g. SIGSEGV) still has a meaningful outcome; report the conventional
    // non-zero rather than inventing a failure reason for it.
    exitCode: typeof run.code === "number" ? run.code : 1,
    stdout: stdout.text,
    stderr: stderr.text,
    runtimeMs,
    backend: "piston",
    truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
    language: spec.id,
  };
}
