// =============================================================================
// SERVER-GRADING AVAILABILITY — the C++ degradation signal.
// Owner: coding-problems stream. Server-only.
// -----------------------------------------------------------------------------
// docs/ADDON_STREAMS.md: "C++ runs via Piston or, if unavailable, is presented with
// reference solution and no execution." Honouring that needs an ANSWER TO A
// QUESTION THE PAGE CANNOT OTHERWISE ASK — is the server-side runner reachable? —
// before it decides what to render.
//
// WHY NOT ASK THE CLIENT. The obvious alternative is to let the browser report
// `backend_unavailable` after a failed submit and reveal the reference solution on
// that report. That would make an answer key obtainable by claiming an outage, so it
// is not an option: the reference solution for an unsolved executable problem is
// withheld by payload.ts precisely because it is an answer key.
//
// WHY A PROBE IS AFFORDABLE. Piston's `/runtimes` is a cheap GET, and the result is
// cached in module scope for PROBE_TTL_MS, so a cohort browsing the C++ track costs
// at most one request every ten minutes per server process — not one per page view.
// A failure is cached too, and for a SHORTER period, so a recovered instance is
// noticed quickly while a dead one is not re-probed on every render.
//
// NEVER THROWS, and a probe failure means "unavailable", not "error". The whole
// point is to render something useful when the runner is down; an exception here
// would take the page down with it.
//
// The presence of `PISTON_URL` is deliberately NOT used as the signal. It defaults
// to the free public instance (src/lib/execution/piston.ts), so it is always set and
// says nothing about reachability.
// =============================================================================

/** How long a positive result is trusted. Ten minutes, in ms (house rule 5). */
export const PROBE_TTL_MS = 600_000;
/** How long a negative result is trusted. Shorter, so recovery is noticed. */
export const PROBE_FAILURE_TTL_MS = 60_000;
/** Budget for the probe itself. A slow runner is an unavailable runner here. */
export const PROBE_TIMEOUT_MS = 3_000;

interface Probe {
  reachable: boolean;
  at: number;
}

let cached: Probe | null = null;

/** Test seam: drop the cache between cases. */
export function resetGradingAvailability(): void {
  cached = null;
}

export interface AvailabilityOptions {
  /** Injected in unit tests so no test touches the network. */
  fetchImpl?: typeof fetch;
  /** Injected clock (ms since epoch) so TTL tests are deterministic. */
  now?: () => number;
  baseUrl?: string;
}

/**
 * Is the server-side runner reachable? Cached; never throws.
 *
 * Only callers that need to CHOOSE WHAT TO RENDER should ask. Grading itself does
 * not: `gradeAndRecordAttempt` finds out by trying, and a probe that said "yes"
 * moments before a 429 would be worse than useless there.
 */
export async function isServerGradingAvailable(
  options: AvailabilityOptions = {},
): Promise<boolean> {
  const now = options.now ? options.now() : Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (cached) {
    const ttl = cached.reachable ? PROBE_TTL_MS : PROBE_FAILURE_TTL_MS;
    if (now - cached.at < ttl) return cached.reachable;
  }

  // No fetch at all (an unusual runtime) is "unavailable", not a crash.
  if (typeof fetchImpl !== "function") {
    cached = { reachable: false, at: now };
    return false;
  }

  const base = (options.baseUrl ?? process.env.PISTON_URL ?? "https://emkc.org/api/v2/piston")
    .trim()
    .replace(/\/+$/, "");

  let reachable = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/runtimes`, {
      method: "GET",
      signal: controller.signal,
    });
    // 429 counts as REACHABLE: the instance is up and grading will work once the
    // window clears, so degrading to reference-only would be the wrong call.
    reachable = response.ok || response.status === 429;
  } catch {
    reachable = false;
  } finally {
    clearTimeout(timer);
  }

  cached = { reachable, at: now };
  return reachable;
}
