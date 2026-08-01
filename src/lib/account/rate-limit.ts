// =============================================================================
// RATE LIMITER for reset requests — owned by the `account` stream.
// -----------------------------------------------------------------------------
// A fixed-window counter, in memory, keyed by a caller-supplied string.
//
// WHY IN MEMORY AND NOT A TABLE OR REDIS, stated plainly as a trade-off rather
// than silently chosen:
//   * A table would need a schema change, and the seam is frozen.
//   * Redis/Upstash is a service outside FREE_STACK.md's list.
//   * So the limit is PER SERVER INSTANCE. On Vercel, several concurrent
//     instances each allow the quota, so the effective ceiling is
//     `instances x quota`. That still turns "unbounded reset mail to one address"
//     into "a few per instance per 15 minutes", which is what the control is for:
//     stopping mailbox flooding and cheap enumeration probing. It is not a
//     defence against a distributed attacker, and should not be described as one.
//
// If a hard global limit is ever required, that is a coordinated schema change
// (a counters table) — not a per-stream decision.
//
// Windows and durations are milliseconds throughout (metric units).
// =============================================================================

export interface RateLimitRule {
  /** Maximum permitted attempts inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts still available in the current window. */
  remaining: number;
  /** When the current window ends, in epoch milliseconds. */
  resetAtMs: number;
}

/**
 * Per-email quota: 3 requests per 15 minutes.
 *
 * Sized against the legitimate worst case — a user who clicks "resend" a couple
 * of times because the first mail is slow — while keeping a mailbox-flood
 * attempt to at most three messages per quarter hour.
 */
export const RESET_EMAIL_RULE: RateLimitRule = { limit: 3, windowMs: 15 * 60 * 1_000 };

/**
 * Per-IP quota: 30 requests per 15 minutes.
 *
 * Ten times the per-email quota, on purpose. A cohort is 50-80 students and a
 * classroom or office puts all of them behind ONE address, so a tight per-IP rule
 * would lock out real students the moment a handful forgot their passwords in the
 * same session — a self-inflicted denial of service on the recovery path, which is
 * worse than the scanning it would prevent. The per-email rule is the precise
 * control; this one only caps address-scanning from a single source, and 30
 * attempts per quarter hour is far too slow to enumerate a roster with.
 */
export const RESET_IP_RULE: RateLimitRule = { limit: 30, windowMs: 15 * 60 * 1_000 };

interface WindowState {
  count: number;
  /** Epoch ms at which this window expires. */
  expiresAtMs: number;
}

/**
 * A limiter instance. Exported as a factory (not a singleton) so tests get a
 * clean one and do not have to reach into module state.
 */
export interface RateLimiter {
  check(key: string, rule: RateLimitRule, nowMs?: number): RateLimitDecision;
  /** Drops every window. Test helper. */
  reset(): void;
  /** Current tracked key count. Test/diagnostic helper. */
  size(): number;
}

/** Above this many tracked keys, expired entries are swept. Bounds memory. */
const SWEEP_THRESHOLD = 500;

export function createRateLimiter(): RateLimiter {
  const windows = new Map<string, WindowState>();

  function sweep(nowMs: number): void {
    for (const [key, state] of windows) {
      if (state.expiresAtMs <= nowMs) windows.delete(key);
    }
  }

  return {
    check(key: string, rule: RateLimitRule, nowMs: number = Date.now()): RateLimitDecision {
      // An unbounded Map in a long-lived process is a leak; sweep lazily rather
      // than on a timer, which would keep a serverless instance awake.
      if (windows.size > SWEEP_THRESHOLD) sweep(nowMs);

      const existing = windows.get(key);
      if (!existing || existing.expiresAtMs <= nowMs) {
        const state: WindowState = { count: 1, expiresAtMs: nowMs + rule.windowMs };
        windows.set(key, state);
        return {
          allowed: rule.limit >= 1,
          remaining: Math.max(0, rule.limit - 1),
          resetAtMs: state.expiresAtMs,
        };
      }

      existing.count += 1;
      // The count is incremented even when the request is refused, so hammering
      // the endpoint keeps the window occupied rather than resetting it.
      return {
        allowed: existing.count <= rule.limit,
        remaining: Math.max(0, rule.limit - existing.count),
        resetAtMs: existing.expiresAtMs,
      };
    },

    reset(): void {
      windows.clear();
    },

    size(): number {
      return windows.size;
    },
  };
}

/**
 * The process-wide limiter used by the reset endpoints.
 *
 * Held on `globalThis` for the same reason `src/db/index.ts` caches its pool:
 * Next's dev-mode module reloading would otherwise hand each recompiled copy of
 * the route a fresh, empty limiter, and the limit would never bite in development.
 */
const globalForLimiter = globalThis as unknown as { __lmsResetLimiter?: RateLimiter };

export function resetRequestLimiter(): RateLimiter {
  globalForLimiter.__lmsResetLimiter ??= createRateLimiter();
  return globalForLimiter.__lmsResetLimiter;
}

/**
 * Best-effort client address for per-IP limiting.
 *
 * `x-forwarded-for` is client-controllable in general; on Vercel the platform
 * overwrites it, so the leftmost entry is the real peer. Behind a different proxy
 * it may be spoofable, which would let an attacker evade the per-IP rule — that
 * is why the per-EMAIL rule, which no header can influence, is the primary
 * control and this one is the supplement.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
