// =============================================================================
// SERVER-BACKED RUN, CALLED FROM THE BROWSER — POST /api/execute.
// Owner: code-execution stream. Unit-tested in client.test.ts with fetch injected.
// -----------------------------------------------------------------------------
// This is the only client-side path to Piston, and it is deliberately indirect: a
// browser must not call the shared public Piston instance itself, or the per-user
// rate limiting (and the language allow-list) would be enforced by code the
// student controls. The route does both server-side.
//
// EVERY HTTP OUTCOME BECOMES A `RunResult`, including the ones the API layer owns
// rather than the runner:
//   429              -> rate_limited        (the route's limiter, or Piston's)
//   401 / 403        -> backend_unavailable (session expired mid-lab; the run did
//                       not happen and the code is not implicated, so a grader
//                       must defer rather than mark it wrong)
//   4xx from Zod     -> unsupported_language when it is about the language,
//                       backend_unavailable otherwise — a malformed request is our
//                       bug, never the student's mistake
//   network / parse  -> backend_unavailable
// =============================================================================

import { clampTimeoutMs } from "./timeouts";
import type { ApiResult } from "@/lib/contracts/api";
import type { RunFailureReason, RunOptions, RunRequest, RunResult } from "./types";

/** The route this stream owns. Not in the frozen ROUTE_AUTH map — see the route file. */
export const EXECUTE_ENDPOINT = "/api/execute";

function clientFailure(
  reason: RunFailureReason,
  message: string,
  runtimeMs: number,
): RunResult {
  return {
    ok: false,
    reason,
    message,
    stdout: "",
    stderr: "",
    exitCode: null,
    runtimeMs,
    backend: "piston",
    truncated: { stdout: false, stderr: false },
    language: null,
  };
}

/**
 * Run a program on the server. Satisfies `RunCode`; never throws.
 *
 * The returned `RunResult` is the one the server built — including its already
 * truncated streams — so a caller cannot tell whether truncation happened here or
 * there, which is the point of having one shape.
 */
export async function runOnServer(
  request: RunRequest,
  options: RunOptions = {},
): Promise<RunResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(EXECUTE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        language: request.language,
        source: request.source,
        stdin: request.stdin ?? "",
        timeoutMs: clampTimeoutMs(request.timeoutMs),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return clientFailure(
      "backend_unavailable",
      `The code runner could not be reached: ${message}`,
      now() - startedAt,
    );
  }

  if (response.status === 429) {
    return clientFailure(
      "rate_limited",
      "Too many runs in a short time. Wait a moment and run it again.",
      now() - startedAt,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return clientFailure(
      "backend_unavailable",
      "Your session is no longer valid, so the code was not run. Sign in again.",
      now() - startedAt,
    );
  }

  let body: ApiResult<RunResult>;
  try {
    body = (await response.json()) as ApiResult<RunResult>;
  } catch {
    return clientFailure(
      "backend_unavailable",
      "The code runner returned a response that could not be read.",
      now() - startedAt,
    );
  }

  if (!body || typeof body !== "object" || !("ok" in body)) {
    return clientFailure(
      "backend_unavailable",
      "The code runner returned an unexpected response.",
      now() - startedAt,
    );
  }

  if (!body.ok) {
    // The envelope's `code` distinguishes "this language is not supported" from
    // every other rejection. Anything else is treated as infrastructure so a
    // grader defers instead of scoring a zero it cannot justify.
    const reason: RunFailureReason =
      body.code === "unsupported_language" ? "unsupported_language" : "backend_unavailable";
    return clientFailure(reason, body.error, now() - startedAt);
  }

  return body.data;
}
