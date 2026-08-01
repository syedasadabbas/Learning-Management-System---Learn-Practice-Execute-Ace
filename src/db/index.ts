// =============================================================================
// DATABASE CLIENT — Drizzle over node-postgres. Import { db } for queries.
// Owner: shared-contracts skill (Wave 0). Do not edit inside feature streams.
// -----------------------------------------------------------------------------
// DRIVER DECISION (and the trade-off, stated plainly)
//
// This uses `drizzle-orm/node-postgres` against Neon's *pooled* endpoint (the
// host containing "-pooler", which is PgBouncer) rather than the neon-http
// driver. Reasons:
//
//   1. TRANSACTIONS. The neon-http driver has no interactive transactions --
//      `db.transaction()` does not exist on it. This app genuinely needs them:
//      submitting a quiz writes an attempt, its answers, a progress row, and
//      possibly a week unlock. If that half-applies, a student ends up with a
//      recorded attempt and no unlock, and the only repair is manual SQL.
//   2. ONE CODE PATH. node-postgres speaks the standard wire protocol, so CI
//      can run against a throwaway `postgres:18` service using these same
//      migrations. The HTTP driver only talks to Neon, which would have forced
//      either a second driver in CI (untested code paths) or a live Neon branch
//      per pull request.
//
// The cost: on a cold serverless invocation, opening a TCP+TLS connection is
// slower than a single HTTP round trip. PgBouncer on the "-pooler" host absorbs
// the connection churn, which is what that endpoint exists for. At 50-80
// students per cohort this is not a load the pooler notices.
//
// If cold-start latency later proves to matter more than transactional
// integrity, revisit this — but it is a coordinated seam change, not a
// per-stream decision.
// =============================================================================

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  // Fail loudly at import time. A non-null assertion here turned a missing env
  // var into a confusing driver-level error much later in the request.
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in the Neon " +
      "connection string (see README).",
  );
}

const connectionString = process.env.DATABASE_URL;

// Neon terminates TLS with a public CA, but the local postgres service in CI
// serves no TLS at all. Enable it only when talking to a remote host.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

// Serverless functions are recycled, not torn down, between invocations. Cache
// the pool on globalThis so each warm invocation reuses its connections instead
// of opening a new pool every request (and, in dev, so hot reload does not leak
// one pool per edit).
const globalForDb = globalThis as unknown as { __lmsPool?: Pool };

// -----------------------------------------------------------------------------
// POOL TUNING — MEASURED, not guessed. See scripts/perf-roundtrips.ts.
//
// Against this Neon instance (us-east-2) the numbers are:
//
//     opening a NEW pooled connection  ~1700 ms   (TCP + TLS + PgBouncer auth)
//     a query on an EXISTING one        ~245 ms   (pure network round trip)
//
// Connection setup costs SEVEN TIMES a query. That reorders the whole problem:
// the expensive thing this app does is not running statements, it is acquiring
// connections to run them on. Everything below follows from that one fact.
// -----------------------------------------------------------------------------

const pool =
  globalForDb.__lmsPool ??
  new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    // Small ceiling: many concurrent serverless instances each holding a pool
    // is how connection limits get exhausted. PgBouncer multiplexes behind this.
    max: 5,

    // Milliseconds (metric units per house rules).
    //
    // WAS 30_000, AND THAT WAS THE SINGLE MOST EXPENSIVE LINE IN THIS FILE.
    // A cohort of 50-80 students does not generate continuous traffic; it
    // generates bursts with quiet gaps. At a 30-second idle timeout, any gap
    // longer than half a minute closed every connection, so the next student to
    // load a page paid the full ~1700 ms handshake again — and so did the one
    // after lunch, and after every lecture. The page was not slow because of its
    // queries; it was slow because it kept re-introducing itself to the database.
    //
    // Five minutes spans the realistic gaps while still releasing connections on
    // a genuinely idle instance. The cost of holding one idle connection is a
    // slot on the pooler, which is what PgBouncer exists to multiplex.
    idleTimeoutMillis: 300_000,

    connectionTimeoutMillis: 10_000,

    // Stops a NAT or load balancer silently dropping an idle connection, which
    // would otherwise surface as a hung request that only fails at the 10 s
    // connection timeout — strictly worse than the reconnect it replaces.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

// Cache the pool across hot reloads in development too. Without this, every edit
// leaked a pool AND made the next request pay a fresh ~1700 ms handshake, which
// is a large part of why the app feels slower in `next dev` than it really is.
globalForDb.__lmsPool = pool;

/**
 * How many connections to open eagerly at start-up.
 *
 * WHY 3 AND NOT 1. A pooled connection is only created when a statement needs
 * one and none is free, so CONCURRENCY is what creates connections. The gated
 * lecture page issues three statements at once (the lecture row, the course +
 * weeks read, and the progress aggregate), which on a one-connection pool means
 * two ~1700 ms handshakes inside that request — measured at 2449 ms for a page
 * whose actual query work is one round trip. Three is the widest fan-out any
 * page performs today; the remaining two slots of `max: 5` absorb genuine
 * concurrent users.
 *
 * Raising this is not free: each connection holds a pooler slot from boot, and
 * on a serverless platform that is multiplied by the number of live instances.
 * It is set to what the app demonstrably uses, not to `max`.
 */
const PREWARM_CONNECTIONS = 3;

// PRE-WARM. Open those connections as this module is imported rather than on the
// first student's first page, so the handshakes happen during server start (or
// during a serverless cold start, alongside the other init work) instead of
// inside a request.
//
// The queries are issued CONCURRENTLY on purpose — issued in sequence they would
// each be handed the one connection the previous had just released, and the pool
// would finish with exactly one connection, which is the state being avoided.
//
// Fire-and-forget ON PURPOSE: a failure here must not stop the module loading.
// If the database is unreachable the real query will fail with its own error,
// which is the one worth surfacing — a rejection here would only mask it with a
// less specific one at import time. The catch is required all the same, since an
// unhandled rejection terminates a Node process.
//
// Skipped for a local database, where a handshake is sub-millisecond and holding
// idle connections against a developer's postgres buys nothing.
if (!isLocal) {
  void Promise.all(
    Array.from({ length: PREWARM_CONNECTIONS }, () => pool.query("select 1")),
  ).catch(() => {
    // Intentionally silent. See above.
  });
}

export const db = drizzle(pool, { schema });

/** Exported for scripts that must close the pool and let the process exit. */
export { pool };

export * from "./schema";
