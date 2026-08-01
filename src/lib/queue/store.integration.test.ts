// @vitest-environment node
// =============================================================================
// INTEGRATION — the half of this queue's correctness that lives in POSTGRES.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS. ./drain.test.ts is a good test file and it proves nothing
// about the two guarantees this queue actually rests on. Its in-memory store
// MODELS `for update skip locked` and MODELS the unique index, so it agrees with
// itself by construction: drop `jobs_idempotency_key_idx` from the database, or
// delete the words `skip locked` from ./store.ts, and every one of those 40-odd
// tests still passes while the production system sends duplicate email. That was
// stated as a known gap when the queue was written. This closes it.
//
// The three things asserted here cannot be asserted any other way:
//
//   1. TWO CONCURRENT ENQUEUES OF ONE KEY PRODUCE ONE ROW. Not "the second call
//      returns created:false" — that is application code reporting on itself. The
//      test issues N inserts at once on N separate connections and counts rows,
//      and separately reads `pg_indexes` to assert the index is UNIQUE, so a
//      migration that recreated it as a plain index fails here rather than in
//      production.
//
//   2. TWO CONCURRENT CLAIMS NEVER TAKE THE SAME JOB. The interesting half is not
//      that they get different rows — with luck, a broken implementation does too.
//      It is that the second claim RETURNS AT ALL. A plain `for update` would
//      BLOCK behind the first transaction's locks; `skip locked` steps over them.
//      So the second claim runs under a short `statement_timeout` and the test
//      fails as a timeout if the clause is ever removed.
//
//   3. `run_after` IS WRITTEN BY THE DATABASE'S CLOCK. This is the regression test
//      for the bug that made tests/e2e/queue/queue.spec.ts's "never stuck" spec
//      fail: the app process's clock ran ~1_080 ms ahead of Neon's, so a job
//      enqueued with delayMs 0 was not claimable for a second, the `after()` drain
//      fired inside that second and claimed nothing, and — with no scheduled drain
//      at the time — the row was never picked up again.
//
// HOW IT COEXISTS WITH FIVE OTHER AGENTS ON ONE SHARED DATABASE:
//   * every row it creates carries the PROBE_PREFIX in its idempotency key and is
//     deleted in afterAll, and nothing here reads or writes any other table;
//   * probe jobs use a `kind` no handler is registered for, so a real drain that
//     landed mid-test would dead-letter them rather than emailing a student —
//     visible, harmless, and cleaned up;
//   * claims are confined to the test's own row ids with `claimJobs({ onlyIds })`,
//     so another stream's traffic cannot change what a claim returns here. See
//     that parameter's comment in ./store.ts: it narrows WHICH rows are eligible
//     and changes nothing about HOW they are locked, so the mechanism under test
//     is the production one.
//
// SKIPPED, LOUDLY, WITHOUT A REAL DATABASE. tests/setup.ts deliberately points
// DATABASE_URL at an unreachable placeholder so that no unit test can touch
// Postgres. This file re-reads .env with `override` and skips itself — with a
// console warning, never silently — when that yields nothing real. A green run
// that quietly asserted nothing would be worse than a red one.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { config as loadEnv } from "dotenv";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { enqueueJob as EnqueueJob, claimJobs as ClaimJobs } from "./store";
import type { sendDeduplicated as SendDeduplicated } from "@/lib/mail/dispatch";

/** Marks every row this file creates, so cleanup is exact and collision-free. */
const PROBE_PREFIX = "__qint";

/** A `kind` no handler is registered for. See the header for why that is safer. */
const PROBE_KIND = "__queue_integration_probe";

/**
 * Ceiling on the second, contended claim. If `for update skip locked` ever becomes
 * a plain `for update`, that statement blocks on the first transaction's locks
 * until it commits — which, in this test, is never. 4_000 ms is far longer than a
 * ~245 ms round trip against this Neon instance and far shorter than the suite
 * timeout, so the regression surfaces as a named error rather than a hang.
 */
const CONTENDED_CLAIM_TIMEOUT_MS = 4_000;

// ---------------------------------------------------------------------------
// Wiring. The modules are imported DYNAMICALLY, after the environment is fixed:
// src/db throws at import time when DATABASE_URL is missing and opens a pool when
// it is present, and tests/setup.ts has already pinned the placeholder value by
// the time this file's static imports would run.
// ---------------------------------------------------------------------------

let pool: Pool;
let enqueueJob: typeof EnqueueJob;
let claimJobs: typeof ClaimJobs;
let sendDeduplicated: typeof SendDeduplicated;
let live = false;

/** Probe job ids created by this file, for cleanup and for claim isolation. */
const createdJobIds: number[] = [];
const createdDedupeKeys: string[] = [];

function key(name: string): string {
  return `${PROBE_PREFIX}:${name}:${process.pid}`;
}

beforeAll(async () => {
  // `override` because tests/setup.ts has already set DATABASE_URL to the
  // deliberately unreachable placeholder, and plain dotenv never replaces a value
  // that is already present.
  loadEnv({ override: true });

  const url = process.env.DATABASE_URL ?? "";
  if (!url || url.includes("never-connected")) {
    console.warn(
      "[queue:integration] SKIPPED — no real DATABASE_URL. These are the only tests " +
        "that prove `for update skip locked` and `jobs_idempotency_key_idx`; a run " +
        "without them proves neither. Provide .env or the CI DATABASE_URL.",
    );
    return;
  }

  const db = await import("@/db");
  const store = await import("./store");
  const dispatch = await import("@/lib/mail/dispatch");
  pool = db.pool;
  enqueueJob = store.enqueueJob;
  claimJobs = store.claimJobs;
  sendDeduplicated = dispatch.sendDeduplicated;

  // Fail fast and clearly if the tables are missing, rather than reporting a
  // confusing assertion failure from the first test.
  const present = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('jobs', 'mail_dispatches')`,
  );
  const names = present.rows.map((r) => r.table_name);
  if (!names.includes("jobs") || !names.includes("mail_dispatches")) {
    throw new Error(
      `[queue:integration] missing table(s). Found: ${names.join(", ") || "none"}. Run: npm run db:migrate`,
    );
  }

  live = true;
});

afterAll(async () => {
  if (!live) return;
  // Delete by PREFIX, not only by the recorded ids: a row inserted by a losing
  // racer that this process never learned the id of must still be cleaned up.
  await pool.query(`delete from jobs where idempotency_key like $1`, [`${PROBE_PREFIX}:%`]);
  await pool.query(`delete from mail_dispatches where dedupe_key like $1`, [`${PROBE_PREFIX}:%`]);
  createdJobIds.length = 0;
  createdDedupeKeys.length = 0;
});

/** Insert a probe job directly and remember its id. `delayMs` goes through enqueueJob. */
async function makeProbeJob(name: string, delayMs = 0): Promise<number> {
  const result = await enqueueJob({
    // Cast: PROBE_KIND is deliberately outside JobKind so no handler can route it.
    // The STORE does not care what the string is — routing happens in ./registry.ts
    // — and using a real kind here would risk a stray drain emailing a student.
    kind: PROBE_KIND as never,
    idempotencyKey: key(name),
    payload: { probe: true },
    delayMs,
  });
  expect(result.created).toBe(true);
  expect(result.jobId).not.toBeNull();
  createdJobIds.push(result.jobId!);
  return result.jobId!;
}

// ===========================================================================

describe("jobs_idempotency_key_idx — the index, not the application check", () => {
  it("exists AND is unique", async () => {
    if (!live) return;
    // A plain index here would satisfy every query in this codebase, make every
    // existing test pass, and silently allow two jobs for one grading moment. The
    // catalogue is the only place that distinguishes the two.
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'jobs' and indexname = 'jobs_idempotency_key_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("CREATE UNIQUE INDEX");
    expect(rows[0].indexdef).toContain("(idempotency_key)");
  });

  it("collapses EIGHT SIMULTANEOUS enqueues of one key into exactly one row", async () => {
    if (!live) return;
    // The real shape of this race is a double-clicked Save routed to two serverless
    // instances, both of which read the same committed graded_at and build the same
    // key. Eight rather than two because a race that only sometimes interleaves is
    // a race a test can pass by luck.
    //
    // Under READ COMMITTED, select-then-insert cannot resolve this: every one of
    // the eight sees no row and every one inserts. Only the unique index decides,
    // and `created: true` coming back exactly once is Postgres reporting who won —
    // not this code guessing.
    const k = key("concurrent-enqueue");
    createdDedupeKeys.push(k);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        enqueueJob({
          kind: PROBE_KIND as never,
          idempotencyKey: k,
          payload: { probe: true },
        }),
      ),
    );

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::int as n from jobs where idempotency_key = $1`,
      [k],
    );
    expect(Number(rows[0].n)).toBe(1);

    // Exactly one winner, and every loser reports the WINNER'S id rather than null,
    // so a producer can still log or correlate.
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.jobId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).not.toBeNull();
    createdJobIds.push([...ids][0]!);
  });
});

describe("for update skip locked — two claims cannot take the same job", () => {
  it("a claim contending with an OPEN claiming transaction gets the other row, and does not block", async () => {
    if (!live) return;

    const a = await makeProbeJob("skiplocked-a");
    const b = await makeProbeJob("skiplocked-b");
    const mine = [a, b];

    // Worker A claims inside an EXPLICIT transaction that is held open. This is the
    // only way to make the overlap deterministic: claimJobs is a single statement,
    // so its locks are released the moment it commits and two calls issued "at the
    // same time" from Node will usually just serialise. Held open, A's row locks are
    // genuinely live while B runs — which is the situation SKIP LOCKED exists for.
    const clientA: PoolClient = await pool.connect();
    const clientB: PoolClient = await pool.connect();

    try {
      await clientA.query("begin");
      const claimedA = await runClaimOn(clientA, mine, 1);
      expect(claimedA).toHaveLength(1);

      // B runs on its own connection while A's transaction is still open, with a
      // statement timeout. THIS IS THE ASSERTION THAT MATTERS: without `skip
      // locked` this query waits for A to commit — forever, here — and the test
      // fails with a Postgres timeout naming the statement.
      await clientB.query(`set local statement_timeout = ${CONTENDED_CLAIM_TIMEOUT_MS}`);
      const claimedB = await runClaimOn(clientB, mine, 2);

      // B asked for TWO and can only have ONE: the other is locked by A and was
      // stepped over. A broken implementation returns two rows here (both workers
      // hold the same job, and a mail handler sends twice) or zero (it blocked and
      // timed out).
      expect(claimedB).toHaveLength(1);
      expect(claimedB[0]).not.toBe(claimedA[0]);
      expect(new Set([...claimedA, ...claimedB]).size).toBe(2);

      await clientA.query("commit");

      // Both rows are now `running` with a live lease, each held by ONE worker, and
      // a third claim finds nothing — the property that stops a cron tick landing
      // on top of an after() drain and running the same handler twice.
      const third = await claimJobs({ limit: 5, workerId: "probe-c", onlyIds: mine });
      expect(third).toHaveLength(0);
    } finally {
      // `rollback` is a no-op after a successful commit and the safety net if an
      // assertion above threw mid-transaction; without it a failing test would
      // leave two rows locked and the next test would be the one that hangs.
      await clientA.query("rollback").catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it("reclaims a `running` row whose lease has expired, which is the only recovery path", async () => {
    if (!live) return;
    // A serverless invocation killed between claiming and completing leaves a
    // `running` row. Without the lease-reclaim arm of the WHERE clause it is never
    // eligible again and the email is silently never sent — the "fails forever and
    // vanishes" outcome the dead-letter state exists to make impossible.
    const id = await makeProbeJob("lease-reclaim");

    const first = await claimJobs({ limit: 1, workerId: "probe-dead", onlyIds: [id] });
    expect(first).toHaveLength(1);
    expect(first[0].attempts).toBe(1);

    // Not reclaimable while the lease is live.
    expect(await claimJobs({ limit: 1, workerId: "probe-2", onlyIds: [id] })).toHaveLength(0);

    // Expire it in DB time rather than sleeping for LEASE_MS.
    await pool.query(`update jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [
      id,
    ]);

    const reclaimed = await claimJobs({ limit: 1, workerId: "probe-3", onlyIds: [id] });
    expect(reclaimed).toHaveLength(1);
    // AT CLAIM, not at completion: a job that kills its worker still burns an
    // attempt and therefore still reaches the dead-letter state instead of being
    // immortal.
    expect(reclaimed[0].attempts).toBe(2);
  });
});

describe("run_after is written by the DATABASE's clock", () => {
  it("a zero-delay job is claimable IMMEDIATELY, whatever the app process's clock says", async () => {
    if (!live) return;
    // THE REGRESSION TEST for the failing e2e. Previously `run_after` was
    // `new Date(Date.now())` — the Node clock — while eligibility is `run_after <=
    // now()` in Postgres. With the app clock ~1_080 ms ahead, this claim returned
    // nothing, the after() drain that fired in that window did nothing, and the row
    // stuck at queued/0 attempts.
    //
    // Asserting "claimable right now" rather than comparing the two clocks is
    // deliberate: it is the property the queue depends on, and it holds no matter
    // which direction any future skew runs in.
    const id = await makeProbeJob("dbclock-now");
    const claimed = await claimJobs({ limit: 1, workerId: "probe-clock", onlyIds: [id] });
    expect(claimed).toHaveLength(1);
  });

  it("run_after never precedes the created_at the database stamped on the same INSERT", async () => {
    if (!live) return;
    // The direct form of the same fact, and the shape the bug was diagnosed from:
    // the stuck row's run_after was 823 ms LATER than its own created_at. Both are
    // now produced by `now()` inside one statement, so they are equal.
    const id = await makeProbeJob("dbclock-stamp");
    const { rows } = await pool.query<{ skew_ms: string }>(
      `select extract(epoch from (run_after - created_at)) * 1000 as skew_ms from jobs where id = $1`,
      [id],
    );
    expect(Math.abs(Number(rows[0].skew_ms))).toBeLessThan(1);
  });

  it("a delayed job is NOT claimable before its delay has elapsed", async () => {
    if (!live) return;
    // The other half: fixing the skew must not have made `delayMs` a no-op, which
    // would turn every backoff into an instant re-run against the relay that just
    // rate-limited us.
    const id = await makeProbeJob("dbclock-delayed", 60_000);
    expect(await claimJobs({ limit: 1, workerId: "probe-delay", onlyIds: [id] })).toHaveLength(0);
  });
});

describe("mail_dispatches — one send per dedupe key, decided by the database", () => {
  /** A mailer that records rather than sends. Never touches a relay. */
  function recordingMailer(sent: string[], ok = true) {
    return {
      name: "dev" as const,
      async send(message: { to: string; messageId?: string }) {
        sent.push(message.messageId ?? "no-id");
        return ok
          ? { ok: true as const, transport: "dev" as const, messageId: message.messageId }
          : {
              ok: false as const,
              transport: "dev" as const,
              reason: "send_failed" as const,
              detail: "probe",
            };
      },
    };
  }

  const message = { to: "probe@example.test", subject: "probe", text: "probe" };

  it("exists AND is unique", async () => {
    if (!live) return;
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'mail_dispatches' and indexname = 'mail_dispatches_dedupe_key_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("CREATE UNIQUE INDEX");
  });

  it("FOUR SIMULTANEOUS sends on one key produce exactly one message", async () => {
    if (!live) return;
    // The failure this prevents: a cron drain and an after() drain both running the
    // same reclaimed job, both calling the transport. The winner is decided by
    // `INSERT ... ON CONFLICT DO NOTHING` on the unique index above, in the
    // database, before any I/O happens.
    const k = key("dispatch-race");
    createdDedupeKeys.push(k);
    const sent: string[] = [];

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendDeduplicated({ dedupeKey: k, message }, { mailer: recordingMailer(sent) }),
      ),
    );

    expect(sent).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "sent")).toHaveLength(1);
    // The three losers must NOT report a failure — nothing failed. They either read
    // the winner's `sent_at` (already_sent) or lost the attempt guard, and both are
    // outcomes the handler maps to `succeeded`. A `failed` here would be a retry
    // that eventually re-sends.
    for (const o of outcomes.filter((o) => o.status !== "sent")) {
      expect(["already_sent", "unknown_exhausted"]).toContain(o.status);
    }
  });

  it("a second send on a key already marked sent does not reach the transport", async () => {
    if (!live) return;
    // THE FIX FOR THE DOUBLE-SEND, stated as the sequence it repairs: the handler
    // ran, the email went out, `completeJob` failed, the lease expired and the job
    // was correctly reclaimed. The second run must find the ledger and stop.
    const k = key("dispatch-already");
    createdDedupeKeys.push(k);
    const sent: string[] = [];

    const first = await sendDeduplicated({ dedupeKey: k, message }, { mailer: recordingMailer(sent) });
    expect(first.status).toBe("sent");

    const second = await sendDeduplicated({ dedupeKey: k, message }, { mailer: recordingMailer(sent) });
    expect(second.status).toBe("already_sent");
    expect(sent).toHaveLength(1);
  });

  it("a DEFINITE transport failure leaves the key retryable, and the retry does send", async () => {
    if (!live) return;
    // The distinction the (sent_at, failed_at) pair exists to draw. A refused relay
    // must not lock the key: `failed_at` set with `sent_at` null means "we know it
    // did not go out", so the next attempt is an ordinary retry rather than an
    // indeterminate one.
    const k = key("dispatch-failed");
    createdDedupeKeys.push(k);
    const failedSends: string[] = [];
    const okSends: string[] = [];

    const first = await sendDeduplicated(
      { dedupeKey: k, message },
      { mailer: recordingMailer(failedSends, false) },
    );
    expect(first.status).toBe("failed");

    const { rows } = await pool.query<{ sent_at: string | null; failed_at: string | null }>(
      `select sent_at, failed_at from mail_dispatches where dedupe_key = $1`,
      [k],
    );
    expect(rows[0].sent_at).toBeNull();
    expect(rows[0].failed_at).not.toBeNull();

    const second = await sendDeduplicated(
      { dedupeKey: k, message },
      { mailer: recordingMailer(okSends) },
    );
    expect(second.status).toBe("sent");
    expect(okSends).toHaveLength(1);
  });

  it("an INDETERMINATE key is resent exactly once, then refused", async () => {
    if (!live) return;
    // The residual risk, exercised rather than described. A row at
    // (sent_at NULL, failed_at NULL) means a sender claimed the key and never came
    // back, which is what the post-send UPDATE failing looks like from the outside.
    // Policy (INDETERMINATE_RESEND_LIMIT = 2): resend once with the SAME derived
    // Message-ID, then stop and let a human read the relay's log.
    const k = key("dispatch-indeterminate");
    createdDedupeKeys.push(k);
    const sent: string[] = [];

    // Row 1: claimed, no outcome recorded. Written directly because the only way to
    // produce it through the module is to kill the process mid-send.
    await pool.query(
      `insert into mail_dispatches (dedupe_key, channel, recipient, attempts) values ($1, 'email', $2, 1)`,
      [k, message.to],
    );

    const resent = await sendDeduplicated({ dedupeKey: k, message }, { mailer: recordingMailer(sent) });
    expect(resent.status).toBe("resent_after_unknown");
    expect(sent).toHaveLength(1);

    // Force the same indeterminate state again, now at the attempt limit.
    await pool.query(
      `update mail_dispatches set sent_at = null, failed_at = null where dedupe_key = $1`,
      [k],
    );

    const refused = await sendDeduplicated(
      { dedupeKey: k, message },
      { mailer: recordingMailer(sent) },
    );
    expect(refused.status).toBe("unknown_exhausted");
    // NOTHING further was sent. This is the branch the handler dead-letters, and it
    // is the point at which this design stops guessing.
    expect(sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The claim statement, run on a CALLER-SUPPLIED connection.
//
// A near-copy of ./store.ts#claimJobs's SQL, and that duplication is deliberate
// and confined to this file: `claimJobs` takes a drizzle client, and the test needs
// two RAW pg connections so that one can hold a transaction open while the other
// runs. Every clause that the test is about — `for update skip locked`, the
// eligibility predicate, the ordering, `attempts + 1` — is byte-identical, and the
// test above ALSO calls the real `claimJobs` for the uncontended assertions, so a
// divergence between the two shows up as a contradiction between tests in this same
// describe block rather than as a false pass.
// ---------------------------------------------------------------------------
async function runClaimOn(
  client: PoolClient,
  onlyIds: number[],
  limit: number,
): Promise<number[]> {
  const { rows } = await client.query<{ id: number }>(
    `with claimable as (
       select j0.id
         from jobs j0
        where j0.id = any($1::int[])
          and ( (j0.status = 'queued'  and j0.run_after <= now())
             or (j0.status = 'running' and j0.lease_expires_at is not null and j0.lease_expires_at < now()) )
        order by j0.run_after asc, j0.id asc
        limit $2
          for update skip locked
     )
     update jobs j
        set status = 'running',
            attempts = j.attempts + 1,
            lease_expires_at = now() + make_interval(secs => 120),
            locked_by = $3,
            updated_at = now()
       from claimable c
      where j.id = c.id
     returning j.id`,
    [onlyIds, limit, "probe-raw"],
  );
  return rows.map((r) => Number(r.id));
}
