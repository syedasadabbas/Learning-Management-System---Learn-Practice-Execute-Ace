// =============================================================================
// MINT RATE LIMITING for POST /api/classes/:classId/realtime-token.
// Owner: the real-time stream.
// -----------------------------------------------------------------------------
// WHY THIS IS A MODULE AND NOT FOUR LINES IN THE ROUTE. Next.js type-checks
// every `route.ts` against a closed shape: the only permitted exports are the
// HTTP methods and a fixed list of segment options. A `resetMintAllowance`
// export beside `POST` fails the build with "Property 'resetMintAllowance' is
// incompatible with index signature", which is a genuinely confusing error for
// a genuinely reasonable thing to write. The limiter therefore lives here, the
// route imports it, and its reset helper is importable by tests — the same
// arrangement src/lib/execution/rate-limit.ts has with /api/execute.
//
// WHY BOUND MINTING AT ALL, given the caller is authenticated and entitled to a
// token: `use-realtime.ts` requests a FRESH one before every connect and every
// reconnect, because the 120 s TTL makes a held token worthless. So a client
// with a reconnect bug turns one student into an unbounded stream of HMAC
// computations and one database round trip each. The window is sized well above
// a genuine reconnect storm — the hook's own ceiling is six attempts, spread by
// backoff over roughly 60 s — so a correct client never meets it.
//
// The sliding-window implementation is reused, not reimplemented, and it carries
// its author's stated weakness with it: the store is a Map in one server
// process, so on Vercel the effective ceiling is (instances × limit). That is
// acceptable here for the same reason it is there — this limiter's job is to
// stop the ordinary accident, and the socket service's own per-user connection
// cap (`too_many_sockets`) is the backstop that actually protects the room.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import {
  SlidingWindowLimiter,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "@/lib/execution/rate-limit";

/**
 * 10 mints per 30 s, 60 per 10 min.
 *
 * Different from `DEFAULT_POLICY` in the execution module on purpose: that one
 * budgets calls to a shared third-party service, this one budgets an HMAC and a
 * single indexed row read. The costs are not comparable and neither are the
 * limits.
 */
export const MINT_POLICY: RateLimitPolicy = {
  burst: { limit: 10, windowMs: 30_000 },
  sustained: { limit: 60, windowMs: 600_000 },
};

const limiter = new SlidingWindowLimiter(MINT_POLICY);

/**
 * Charge one mint against this user's budget.
 *
 * Keyed per USER rather than per user-and-class: the resource being protected is
 * this process, and a client looping over class ids costs exactly as much as one
 * looping on a single id.
 */
export function consumeMintAllowance(userId: number, now: number): RateLimitDecision {
  return limiter.consume(`user:${userId}`, now);
}

/** Drop the limiter's state. Test helper — never called in request handling. */
export function resetMintAllowance(): void {
  limiter.reset();
}
