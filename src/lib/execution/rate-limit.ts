// =============================================================================
// PER-USER RATE LIMITING for server-side runs. Owner: code-execution stream.
// Pure logic + one process-local store; unit-tested in rate-limit.test.ts.
// -----------------------------------------------------------------------------
// WHY WE LIMIT OURSELVES BEFORE PISTON DOES.
// The free public Piston instance is shared by the whole cohort and answers 429
// once its (roughly 5 requests/second) budget is exceeded. Without a limiter of
// our own, one student holding down "Run" during a grand quiz would consume that
// budget and every other student's code question would come back
// `rate_limited` — which grand-quiz correctly defers to instructor grading, so
// the visible symptom is not an error but 60 exams landing in a marking queue.
//
// TWO WINDOWS, DELIBERATELY.
// A single "N per minute" rule either allows a damaging one-second burst or
// forbids the normal edit-run-edit-run rhythm of a lab. So:
//   * a BURST window keeps one student's rapid clicking civil, and
//   * a SUSTAINED window keeps a script from grinding through the hour.
// Both must pass. Refusal returns `rate_limited`, the same reason Piston's 429
// maps to, because from the caller's perspective they are the same fact: the run
// did not happen and says nothing about the code.
//
// A PROCESS-WIDE window exists as well, keyed on the constant below, to protect
// the shared instance from the cohort in aggregate rather than from one student.
//
// KNOWN LIMIT — state it plainly rather than pretend otherwise.
// The store is a Map in one server process. On Vercel, concurrent lambdas each
// hold their own copy, so the effective ceiling is (instances × limit) and a
// user could exceed the nominal rate by spreading requests across instances.
// Fixing that properly needs shared state (a Postgres counter table, or Redis) —
// the first would need a schema change, which is frozen this wave, and the
// second is not on the free stack. This limiter's job is to stop the ordinary
// accident; Piston's own 429, handled as a first-class value, is the backstop.
// =============================================================================

/** One "at most `limit` events per `windowMs`" rule. Durations in milliseconds. */
export interface RateWindow {
  limit: number;
  windowMs: number;
}

export interface RateLimitPolicy {
  /** Rapid clicking: 6 runs per 10 s ≈ one run every 1.7 s sustained over a burst. */
  burst: RateWindow;
  /** The long game: 60 runs per 10 min is generous for a lab, cheap for Piston. */
  sustained: RateWindow;
}

export const DEFAULT_POLICY: RateLimitPolicy = {
  burst: { limit: 6, windowMs: 10_000 },
  sustained: { limit: 60, windowMs: 600_000 },
};

/**
 * The whole-process budget, protecting the shared public instance from the
 * cohort. 3 runs/second leaves headroom under Piston's ~5/second so a burst from
 * us never becomes a 429 for us.
 */
export const GLOBAL_POLICY: RateLimitPolicy = {
  burst: { limit: 3, windowMs: 1_000 },
  sustained: { limit: 300, windowMs: 60_000 },
};

/**
 * Key used for the process-wide window.
 *
 * Every per-user key is built as `user:${id}` by the route handler, so this
 * sentinel cannot be produced by any user id — a crafted id can neither spend
 * nor inspect the cohort bucket.
 */
export const GLOBAL_KEY = "__cohort__";

export type RateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Which rule refused — surfaced in the message, useful in support triage. */
      scope: "user" | "global";
      /** How long until the next run would be allowed, in milliseconds. */
      retryAfterMs: number;
      message: string;
    };

/**
 * Sliding-window counter over event timestamps.
 *
 * Timestamps rather than a fixed-window counter: a fixed window lets 2× the
 * limit through across a boundary (all of window N's budget at its end, all of
 * N+1's at its start), which is exactly the burst we are trying to prevent.
 * Memory is bounded by the widest window's limit per key.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly policy: RateLimitPolicy) {}

  /**
   * Record one event for `key` if both windows permit it.
   *
   * `now` is injected (never `Date.now()` internally) so tests can advance time
   * without sleeping — a limiter test that slept 10 s would be a limiter test
   * nobody runs.
   */
  consume(key: string, now: number): RateLimitDecision {
    const widest = Math.max(this.policy.burst.windowMs, this.policy.sustained.windowMs);
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < widest);

    for (const [name, rule] of [
      ["burst", this.policy.burst],
      ["sustained", this.policy.sustained],
    ] as const) {
      const inWindow = recent.filter((at) => now - at < rule.windowMs);
      if (inWindow.length >= rule.limit) {
        // The oldest event in the window is the one whose expiry frees a slot.
        const oldest = Math.min(...inWindow);
        const retryAfterMs = Math.max(1, rule.windowMs - (now - oldest));
        // Keep the pruned list so a refused caller does not leak memory.
        this.hits.set(key, recent);
        return {
          allowed: false,
          scope: key === GLOBAL_KEY ? "global" : "user",
          retryAfterMs,
          message:
            key === GLOBAL_KEY
              ? `The shared code-execution service is busy (cohort limit: ${rule.limit} ` +
                `runs per ${rule.windowMs} ms). Try again in ${retryAfterMs} ms.`
              : `Too many runs (${name} limit: ${rule.limit} per ${rule.windowMs} ms). ` +
                `Try again in ${retryAfterMs} ms.`,
        };
      }
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  /** Events currently counted for `key`. Tests and diagnostics only. */
  size(key: string): number {
    return this.hits.get(key)?.length ?? 0;
  }

  /** Drop all state. Used between tests; never in request handling. */
  reset(): void {
    this.hits.clear();
  }
}

/**
 * The limiters the API route uses. Module singletons because that is the only
 * process-local state available without a schema change (see header).
 */
export const userLimiter = new SlidingWindowLimiter(DEFAULT_POLICY);
export const globalLimiter = new SlidingWindowLimiter(GLOBAL_POLICY);

/**
 * Check the per-user window then the process-wide one.
 *
 * Order matters: charging the global budget for a request the user's own limit
 * would have refused lets one student consume the cohort's allowance by being
 * rejected repeatedly.
 */
export function checkRunAllowance(userKey: string, now: number): RateLimitDecision {
  const perUser = userLimiter.consume(userKey, now);
  if (!perUser.allowed) return perUser;
  return globalLimiter.consume(GLOBAL_KEY, now);
}

/** Reset both singletons. Test helper. */
export function resetRunAllowance(): void {
  userLimiter.reset();
  globalLimiter.reset();
}
