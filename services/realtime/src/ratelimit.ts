// =============================================================================
// TOKEN-BUCKET RATE LIMITER — per socket AND per user.
// -----------------------------------------------------------------------------
// THE BUDGET IS 5 EVENTS PER SECOND, from the brief. What the brief does not say,
// and what the two-key design exists for: A USER WITH TWO TABS MUST NOT GET TEN.
// Per-socket alone is trivially bypassed by opening another tab; per-user alone
// lets one runaway tab starve the user's other tab of its own budget in a way
// that is hard to diagnose. So BOTH are checked and BOTH must allow — the user
// bucket is the real limit, the socket bucket contains the blast radius of one
// misbehaving client.
//
// WHY TOKEN BUCKET AND NOT A FIXED WINDOW.
// A fixed 1-second window admits 10 events across a window boundary (5 at
// 0.999 s, 5 at 1.001 s) — double the intended rate at exactly the moment a
// burst happens. A token bucket refills continuously, so the worst case is the
// bucket's capacity, which is a number chosen rather than an artefact.
//
// CAPACITY IS 10, NOT 5, and that is deliberate. Chat is bursty in a way that is
// entirely legitimate: a student pasting three lines, or reacting to four
// messages while catching up. A capacity equal to the rate makes the limiter
// fire on normal human behaviour and teaches users the app is broken. Ten tokens
// is two seconds of saved-up budget — enough for a burst, far short of a flood,
// and the SUSTAINED rate is still exactly 5/s because that is the refill.
//
// LAZY REFILL: no timers. A bucket is brought up to date when it is touched.
// This matters more than it sounds — a `setInterval` per user is precisely the
// leak the disconnect path is supposed to prevent, and with lazy refill there is
// nothing to clear. Cleanup is a Map delete.
//
// NOT DISTRIBUTED. One process, one Map. If this service is ever scaled to two
// instances behind a load balancer, a user's two tabs may land on different
// instances and get 2x budget. Recorded here rather than solved: the fix is a
// shared store (Redis), the stack has none, and one instance serves a cohort of
// this size comfortably. See DEPLOYMENT_LIVE_CLASSES.md.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

/** Sustained events per second, per user and per socket. */
export const REFILL_PER_SECOND = 5;

/** Burst allowance. See the header for why it is 2x the rate rather than 1x. */
export const BUCKET_CAPACITY = 10;

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /**
   * Which bucket refused. Reported to the client so a UI can say something
   * truthful, and logged so an operator can tell a chatty tab from a chatty user.
   */
  limitedBy: "socket" | "user" | null;
  /** Whole milliseconds until one token is available. 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Two-keyed token-bucket limiter.
 *
 * Deliberately holds NO reference to a socket or to the io server: it is a pure
 * counting structure over string/number keys, which is what makes it testable
 * with a fake clock and impossible for it to keep a disconnected socket alive.
 */
export class RateLimiter {
  private readonly socketBuckets = new Map<string, Bucket>();
  private readonly userBuckets = new Map<number, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: () => number;

  constructor(options: { capacity?: number; refillPerSecond?: number; clock?: () => number } = {}) {
    this.capacity = options.capacity ?? BUCKET_CAPACITY;
    this.refillPerMs = (options.refillPerSecond ?? REFILL_PER_SECOND) / 1000;
    // Injected so tests advance time instead of sleeping. A test that sleeps for
    // a second per case is a test suite nobody runs.
    this.clock = options.clock ?? Date.now;
  }

  private touch(bucket: Bucket | undefined, now: number): Bucket {
    if (!bucket) return { tokens: this.capacity, lastRefillMs: now };

    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastRefillMs = now;
    }
    return bucket;
  }

  /**
   * Consume one token from both buckets, or refuse.
   *
   * BOTH BUCKETS ARE EVALUATED BEFORE EITHER IS CHARGED. Charging the socket
   * bucket and then discovering the user bucket is empty would bill the client
   * for an event that never happened, so a user at their limit would drain their
   * per-socket budget too and be throttled twice as long as intended.
   */
  consume(socketId: string, userId: number): RateLimitDecision {
    const now = this.clock();

    const socketBucket = this.touch(this.socketBuckets.get(socketId), now);
    const userBucket = this.touch(this.userBuckets.get(userId), now);
    this.socketBuckets.set(socketId, socketBucket);
    this.userBuckets.set(userId, userBucket);

    if (socketBucket.tokens < 1) {
      return { allowed: false, limitedBy: "socket", retryAfterMs: this.waitMs(socketBucket) };
    }
    if (userBucket.tokens < 1) {
      return { allowed: false, limitedBy: "user", retryAfterMs: this.waitMs(userBucket) };
    }

    socketBucket.tokens -= 1;
    userBucket.tokens -= 1;
    return { allowed: true, limitedBy: null, retryAfterMs: 0 };
  }

  private waitMs(bucket: Bucket): number {
    return Math.ceil((1 - bucket.tokens) / this.refillPerMs);
  }

  /**
   * Drop a socket's bucket on disconnect.
   *
   * The USER bucket is deliberately NOT dropped here — dropping it would hand a
   * fresh full bucket to anyone who reconnects, turning the limiter into a
   * suggestion for any client willing to cycle its socket. It is reaped by
   * `sweep` once it has been idle long enough to be full anyway, at which point
   * discarding it and keeping it are indistinguishable.
   */
  releaseSocket(socketId: string): void {
    this.socketBuckets.delete(socketId);
  }

  /**
   * Discard user buckets that have refilled to capacity and are therefore
   * carrying no information. Called on an interval by ./server.ts, which owns
   * the timer and clears it on shutdown.
   *
   * Without this the user Map grows for the lifetime of the process — one entry
   * per user who has ever connected. Small, but unbounded is unbounded, and this
   * is the memory-leak acceptance criterion.
   */
  sweep(): number {
    const now = this.clock();
    let removed = 0;
    for (const [userId, bucket] of this.userBuckets) {
      this.touch(bucket, now);
      if (bucket.tokens >= this.capacity) {
        this.userBuckets.delete(userId);
        removed += 1;
      }
    }
    return removed;
  }

  /** Live sizes, for /healthz and for the leak assertions in the tests. */
  sizes(): { sockets: number; users: number } {
    return { sockets: this.socketBuckets.size, users: this.userBuckets.size };
  }
}
