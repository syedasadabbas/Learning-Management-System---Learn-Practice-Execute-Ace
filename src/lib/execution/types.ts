// =============================================================================
// CODE EXECUTION — the single result/request shape every backend must satisfy.
// Owner: code-execution stream.
// -----------------------------------------------------------------------------
// Two properties drive every decision in this file, and both come from the
// grand-quiz stream calling runCode() inside a timed exam submission:
//
//   1. NEVER THROW. A rejected promise during submit costs a student marks — the
//      submit transaction would unwind and the attempt would be lost. So every
//      failure, including "the network is down" and "Piston said 429", is a
//      RETURNED VALUE with a discriminated `reason`.
//
//   2. ONE SHAPE, TWO BACKENDS. Callers must never branch on which backend ran
//      the code, because grand-quiz grades server-side via Piston while a lab
//      page runs the same snippet in a Web Worker. Both satisfy `RunCode`.
//
// The failure `reason` set is deliberately small and closed. `rate_limited` and
// `backend_unavailable` exist as separate members from a plain non-zero exit
// because grand-quiz DEFERS those items to instructor grading instead of scoring
// them zero — conflating "we could not run it" with "it printed the wrong thing"
// silently zeroes correct answers. `shouldDeferToInstructor` below is the one
// place that distinction is encoded, so no consumer has to re-derive it.
// =============================================================================

/**
 * Canonical language ids. This is the allow-list's key space: a student's
 * language string is mapped onto one of these or rejected, and only the mapped
 * value is ever sent to Piston. See languages.ts.
 */
export type ExecutionLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "c"
  | "cpp"
  | "java"
  | "sql";

/** Which engine produced a result. Informational — never branch on it. */
export type RunBackend = "piston" | "worker" | "pyodide" | "sqljs";

/**
 * Why a run produced no trustworthy exit status.
 *
 * - `timeout`              the program was still running when its budget expired
 * - `unsupported_language` the requested language is not on the allow-list
 * - `backend_unavailable`  Piston/CDN unreachable, 5xx, or an unparseable body
 * - `rate_limited`         Piston answered 429, or OUR per-user limiter refused
 */
export type RunFailureReason =
  | "timeout"
  | "unsupported_language"
  | "backend_unavailable"
  | "rate_limited";

/** What a caller asks for. `language` is untrusted input by design. */
export interface RunRequest {
  /** Raw, student- or content-supplied. Never forwarded verbatim to a backend. */
  language: string;
  source: string;
  /** Fed to the program's stdin. Empty string when the program reads nothing. */
  stdin?: string;
  /** Wall-clock budget for the program itself, in milliseconds. Clamped. */
  timeoutMs?: number;
}

/** How much of a stream survived the cap in truncate.ts. */
export interface StreamTruncation {
  stdout: boolean;
  stderr: boolean;
}

interface RunResultBase {
  /**
   * Always present, always already truncated. A timed-out infinite print loop
   * still yields the first N characters here, which is what a student needs to
   * see to understand what happened.
   */
  stdout: string;
  stderr: string;
  /** Wall-clock time this run consumed, in milliseconds. */
  runtimeMs: number;
  backend: RunBackend;
  truncated: StreamTruncation;
  /** The resolved allow-list language, or null when it never resolved. */
  language: ExecutionLanguage | null;
}

/**
 * The run completed and `exitCode` is meaningful. `ok: true` does NOT mean the
 * program succeeded — a compile error is `ok: true` with a non-zero exit code
 * and text on stderr. It means "the backend ran it and this is the truth".
 */
export interface RunSuccess extends RunResultBase {
  ok: true;
  exitCode: number;
  language: ExecutionLanguage;
}

/** The run produced no trustworthy exit status. `message` is user-safe prose. */
export interface RunFailure extends RunResultBase {
  ok: false;
  reason: RunFailureReason;
  message: string;
  exitCode: null;
}

export type RunResult = RunSuccess | RunFailure;

/**
 * The interface both backends satisfy. Note the return type: `Promise<RunResult>`
 * and never `Promise<RunResult | never>` — there is no throwing path to type.
 */
export type RunCode = (request: RunRequest, options?: RunOptions) => Promise<RunResult>;

export interface RunOptions {
  /** Injected in unit tests so no test touches the network. */
  fetchImpl?: typeof fetch;
  /**
   * Identity for per-user rate limiting. The route handler passes the session
   * user id; it is never read from the request body, which a client controls.
   */
  userKey?: string;
  /** Injected clock (ms since epoch) so limiter/timeout tests are deterministic. */
  now?: () => number;
  /** Overrides `PISTON_URL`. Tests only. */
  pistonUrl?: string;
  /** Skip the per-user limiter. Only the API route, which limits first, sets this. */
  skipRateLimit?: boolean;
  /**
   * Which backend `runCode` should choose.
   *
   * "auto" (default) prefers the browser when the language has an in-browser
   * runtime, because that path costs nothing and cannot rate-limit the cohort.
   * "server" forces Piston.
   *
   * A browser result is produced on the student's machine and is therefore
   * ADVISORY — it must never be the source of a mark. Anything that awards points
   * calls the server backend (`runOnPiston`) directly.
   */
  backend?: "auto" | "browser" | "server";
}

/**
 * Should this result be handed to an instructor rather than scored?
 *
 * TRUE only for infrastructure failures. A `timeout` is the student's own
 * program looping, and an `unsupported_language` is a content bug in the
 * question — neither is grounds for deferral, so both score normally (zero).
 * A `rate_limited` or `backend_unavailable` result says nothing about the
 * submitted code, so scoring it zero would be a fabricated grade.
 */
export function shouldDeferToInstructor(result: RunResult): boolean {
  if (result.ok) return false;
  return result.reason === "rate_limited" || result.reason === "backend_unavailable";
}
