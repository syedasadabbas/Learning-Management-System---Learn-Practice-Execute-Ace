// =============================================================================
// TIMEOUT BUDGETS — shared by both backends. Owner: code-execution stream.
// All durations in milliseconds (metric units, per the house rules).
// -----------------------------------------------------------------------------
// Separated from piston.ts for a bundling reason, not a stylistic one: the
// browser backend needs `clampTimeoutMs`, and importing it from piston.ts would
// pull the Piston client (and its `process.env` read and the rate limiter) into
// every client bundle that runs a lab. This file has no imports at all.
//
// Both backends clamp with the SAME function, so a caller cannot get a 60 s run
// in the browser and a 10 s run on the server from one `timeoutMs`.
// =============================================================================

/** Default program budget when a caller does not ask for one. */
export const DEFAULT_RUN_TIMEOUT_MS = 5_000;

/** Floor. Below this, normal interpreter start-up alone would report a timeout. */
export const MIN_RUN_TIMEOUT_MS = 500;

/**
 * Ceiling. Vercel's hobby Node function budget is 10 s, so a longer program
 * timeout could not be honoured server-side: the platform would kill the handler
 * and the caller would see a 504 instead of a `timeout` VALUE — exactly the
 * throw-at-the-caller behaviour this module exists to prevent. The browser
 * backend uses the same ceiling so behaviour does not depend on the backend.
 */
export const MAX_RUN_TIMEOUT_MS = 10_000;

/**
 * Extra time allowed for the HTTP round trip on top of the program's budget.
 * The free public Piston instance queues under load; aborting at exactly the
 * program budget would report `timeout` for programs that never started.
 */
export const NETWORK_SLACK_MS = 4_000;

/**
 * Compilation budget for compiled languages (C, C++, Java, TypeScript), in ms.
 *
 * Equal to MAX_RUN_TIMEOUT_MS, and that is not a coincidence to tidy away: Piston
 * charges compilation and execution to the same request, so a compiled problem's
 * `timeLimitMs` has to cover both. That is why every row in
 * scripts/content/problems/cpp.ts and c.ts sets `timeLimitMs: 10000` rather than
 * leaving the 5 000 ms default — a C++ translation unit with <iostream> routinely
 * spends over a second in the compiler before main() runs.
 */
export const COMPILE_TIMEOUT_MS = 10_000;

/**
 * Clamp a caller's requested budget into a range the platform can honour.
 *
 * A missing, NaN or Infinite value becomes the default rather than an error:
 * this module never throws at a caller, and a malformed timeout is not a reason
 * to refuse to run a student's exam answer.
 */
export function clampTimeoutMs(requested: number | undefined | null): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  return Math.min(MAX_RUN_TIMEOUT_MS, Math.max(MIN_RUN_TIMEOUT_MS, Math.round(requested)));
}
