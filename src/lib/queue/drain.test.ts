// =============================================================================
// DRAIN LOOP TESTS — the retry lifecycle, end to end, with no database.
// -----------------------------------------------------------------------------
// The claim/complete pair is injected (see DrainDeps in ./drain.ts), so this file
// can run a job through all five of its attempts and watch it become `dead`
// without a Postgres, without a mail relay, and without waiting 7.5 minutes for
// the real backoff. The in-memory store below is a faithful model of the parts of
// ./store.ts that the loop depends on — the attempts-increment-at-claim, the
// run_after gate, and the attempts guard on completion — and each of those is
// commented with the real behaviour it stands in for.
//
// WHAT THIS FILE CANNOT PROVE, stated so nobody reads it as more than it is:
// `FOR UPDATE SKIP LOCKED` and the unique index are database behaviours. A fake
// store cannot demonstrate them. The concurrency test below models what SKIP
// LOCKED does; it does not verify that Postgres does it.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { drainJobs, runOne, type DrainDeps } from "./drain";
import { DEFAULT_MAX_ATTEMPTS, decideNextState } from "./policy";
import type { JobHandler, JobOutcome, JobRecord } from "./types";

// ---------------------------------------------------------------------------
// A minimal in-memory model of src/lib/queue/store.ts
// ---------------------------------------------------------------------------

interface FakeClock {
  nowMs: number;
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const t = new Date(0);
  return {
    id: 1,
    kind: "submission_graded_email",
    idempotencyKey: "submission_graded_email:1:1",
    payload: { submissionId: 1, gradedAtMs: 1 },
    status: "queued",
    attempts: 0,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runAfter: t,
    leaseExpiresAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: t,
    updatedAt: t,
    completedAt: null,
    ...overrides,
  };
}

function makeStore(initial: JobRecord[], clock: FakeClock) {
  const rows = initial.map((j) => ({ ...j }));

  const claim: DrainDeps["claim"] = async ({ limit, workerId, leaseMs }) => {
    const now = clock.nowMs;
    const eligible = rows
      .filter(
        (r) =>
          (r.status === "queued" && r.runAfter.getTime() <= now) ||
          // Lease reclaim — the recovery path for a killed serverless invocation.
          (r.status === "running" &&
            r.leaseExpiresAt !== null &&
            r.leaseExpiresAt.getTime() < now),
      )
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime() || a.id - b.id)
      .slice(0, limit);

    for (const row of eligible) {
      row.status = "running";
      // AT CLAIM, not at completion — a worker killed mid-handler still burns an
      // attempt, so a job that crashes its runtime is not immortal.
      row.attempts += 1;
      row.leaseExpiresAt = new Date(now + leaseMs);
      row.lockedBy = workerId;
    }
    return eligible.map((r) => ({ ...r }));
  };

  const complete: DrainDeps["complete"] = async ({ jobId, expectedAttempts, next }) => {
    const row = rows.find((r) => r.id === jobId);
    // The guard that stops a stalled worker overwriting the result written by
    // the worker that reclaimed its job.
    if (!row || row.attempts !== expectedAttempts) return false;
    row.status = next.status;
    row.runAfter = next.runAfter;
    row.lastError = next.lastError;
    row.completedAt = next.completedAt;
    row.leaseExpiresAt = null;
    row.lockedBy = null;
    return true;
  };

  return { rows, claim, complete };
}

function deps(
  clock: FakeClock,
  store: ReturnType<typeof makeStore>,
  handler: JobHandler,
  overrides: Partial<DrainDeps> = {},
): Partial<DrainDeps> {
  return {
    claim: store.claim,
    complete: store.complete,
    resolve: () => handler,
    now: () => new Date(clock.nowMs),
    // Zero jitter so the asserted run_after values are exact.
    random: () => 0.5,
    elapsedMs: () => 0,
    log: () => {},
    ...overrides,
  };
}

const succeed: JobHandler = async () => ({ status: "succeeded" });
const alwaysFail: JobHandler = async () => ({ status: "retry", error: "relay refused" });

// ---------------------------------------------------------------------------

describe("drainJobs — the happy path", () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = { nowMs: 1_000_000 };
  });

  it("claims, runs and marks the job succeeded", async () => {
    const store = makeStore([makeJob()], clock);
    const report = await drainJobs({}, deps(clock, store, succeed));

    expect(report.claimed).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(report.retried).toBe(0);
    expect(report.deadLettered).toBe(0);
    expect(store.rows[0].status).toBe("succeeded");
    expect(store.rows[0].completedAt).not.toBeNull();
    // The lease must be released, or the row reads as still claimed.
    expect(store.rows[0].leaseExpiresAt).toBeNull();
  });

  it("stops immediately on an empty queue without a second round trip", async () => {
    const store = makeStore([], clock);
    const claim = vi.fn(store.claim);
    const report = await drainJobs({}, deps(clock, store, succeed, { claim }));

    expect(report.claimed).toBe(0);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("does not touch a job whose backoff has not elapsed", async () => {
    const store = makeStore(
      [makeJob({ status: "queued", runAfter: new Date(clock.nowMs + 60_000) })],
      clock,
    );
    const report = await drainJobs({}, deps(clock, store, succeed));
    expect(report.claimed).toBe(0);
    expect(store.rows[0].status).toBe("queued");
  });
});

describe("drainJobs — bounded retries ending in a dead letter", () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = { nowMs: 1_000_000 };
  });

  it("retries with growing millisecond backoff and dies after exactly maxAttempts", async () => {
    // The central assertion of this work item. Each iteration is one drain
    // invocation; between them the clock is advanced past the backoff, which is
    // what a real scheduler would do.
    const store = makeStore([makeJob()], clock);
    const expectedDelaysMs = [30_000, 60_000, 120_000, 240_000];
    const observedDelaysMs: number[] = [];

    for (let invocation = 1; invocation <= DEFAULT_MAX_ATTEMPTS; invocation += 1) {
      const before = clock.nowMs;
      const report = await drainJobs({}, deps(clock, store, alwaysFail));
      expect(report.claimed).toBe(1);

      const row = store.rows[0];
      if (invocation < DEFAULT_MAX_ATTEMPTS) {
        expect(row.status).toBe("queued");
        expect(report.retried).toBe(1);
        observedDelaysMs.push(row.runAfter.getTime() - before);
        // Advance past the backoff, as a later drain would find it.
        clock.nowMs = row.runAfter.getTime();
      } else {
        expect(report.deadLettered).toBe(1);
      }
    }

    expect(observedDelaysMs).toEqual(expectedDelaysMs);

    const dead = store.rows[0];
    expect(dead.status).toBe("dead");
    expect(dead.attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(dead.completedAt).not.toBeNull();
    expect(dead.lastError).toContain("gave up after 5 attempts");
    // TERMINAL. A further drain must not resurrect it — a dead letter that
    // quietly re-runs is not a dead letter.
    clock.nowMs += 86_400_000;
    const after = await drainJobs({}, deps(clock, store, alwaysFail));
    expect(after.claimed).toBe(0);
    expect(store.rows[0].status).toBe("dead");
  });

  it("dead-letters a permanent failure on the first attempt", async () => {
    const store = makeStore([makeJob()], clock);
    const permanent: JobHandler = async () => ({
      status: "dead",
      error: "Submission 1 no longer exists.",
    });

    const report = await drainJobs({}, deps(clock, store, permanent));
    expect(report.deadLettered).toBe(1);
    expect(store.rows[0].attempts).toBe(1);
    expect(store.rows[0].status).toBe("dead");
  });

  it("reports a dead letter at ERROR level so it cannot pass unnoticed", async () => {
    const store = makeStore([makeJob({ maxAttempts: 1 })], clock);
    const log = vi.fn();
    await drainJobs({}, deps(clock, store, alwaysFail, { log }));

    const errors = log.mock.calls.filter((call) => call[0] === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0][1])).toContain("DEAD-LETTERED");
    // Points the reader at where to look, which is the difference between a log
    // line and an actionable one.
    expect(String(errors[0][1])).toContain("/api/admin/jobs?status=dead");
  });
});

describe("drainJobs — failures of the machinery, not of the job", () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = { nowMs: 1_000_000 };
  });

  it("treats a THROWN handler error as a retry, never as a dead letter", async () => {
    // An exception carries no signal about permanence. Of the two possible
    // mistakes, retrying something hopeless costs a bounded number of attempts;
    // dead-lettering something transient loses the work.
    const store = makeStore([makeJob()], clock);
    const thrower: JobHandler = async () => {
      throw new Error("ECONNRESET");
    };
    const report = await drainJobs({}, deps(clock, store, thrower));
    expect(report.retried).toBe(1);
    expect(store.rows[0].status).toBe("queued");
    expect(store.rows[0].lastError).toContain("ECONNRESET");
  });

  it("dead-letters a job whose kind has no handler, on the first attempt", async () => {
    const store = makeStore([makeJob({ kind: "kind_from_a_rolled_back_deploy" })], clock);
    const report = await drainJobs({}, deps(clock, store, succeed, { resolve: () => null }));
    expect(report.deadLettered).toBe(1);
    expect(store.rows[0].lastError).toContain("No handler is registered");
  });

  it("treats a handler that returns nothing as a retry, not as success", async () => {
    const store = makeStore([makeJob()], clock);
    const forgotToReturn = (async () => undefined) as unknown as JobHandler;
    const report = await drainJobs({}, deps(clock, store, forgotToReturn));
    expect(report.succeeded).toBe(0);
    expect(report.retried).toBe(1);
  });

  it("stops the drain when CLAIM fails, without stranding anything", async () => {
    const store = makeStore([makeJob()], clock);
    const claim = vi.fn(async () => {
      throw new Error("pool exhausted");
    });
    const report = await drainJobs({}, deps(clock, store, succeed, { claim }));
    expect(report.claimed).toBe(0);
    // No row was moved to `running`, so nothing needs recovering.
    expect(store.rows[0].status).toBe("queued");
  });

  it("NEVER throws, whatever the collaborators do", async () => {
    const store = makeStore([makeJob()], clock);
    const complete = vi.fn(async () => {
      throw new Error("write failed");
    });
    await expect(
      drainJobs({}, deps(clock, store, succeed, { complete })),
    ).resolves.toBeDefined();
  });

  it("logs loudly when the handler ran and its result could not be recorded", async () => {
    // The job WILL be reclaimed once its lease expires and the handler WILL run
    // again — that is the same mechanism that recovers a killed invocation, not a
    // defect. What this asserts is that the drain says so at ERROR level and names
    // the condition under which the effect repeats, because the drain itself
    // cannot prevent it: de-duplication has to happen at the point of effect. The
    // mail handler does that through src/lib/mail/dispatch.ts; a future handler
    // that does not will repeat its effect, and this line is where an operator
    // reading a duplicate report starts.
    const store = makeStore([makeJob()], clock);
    const log = vi.fn();
    const complete = vi.fn(async () => {
      throw new Error("write failed");
    });
    await drainJobs({}, deps(clock, store, succeed, { complete, log }));

    const errors = log.mock.calls.filter((c) => c[0] === "error").map((c) => String(c[1]));
    expect(errors.some((m) => m.includes("RAN but its result could not be recorded"))).toBe(
      true,
    );
    // The log must point at the mechanism that actually fixes this, not merely
    // announce the problem — an error message that names no remedy is a shrug.
    expect(errors.some((m) => m.includes("de-duplicates at the point of effect"))).toBe(true);
    expect(errors.some((m) => m.includes("src/lib/mail/dispatch.ts"))).toBe(true);
  });

  it("discards its own result when another worker reclaimed the job mid-run", async () => {
    // Models what ./store.ts#completeJob's `and(eq(id), eq(attempts))` guard does.
    // Without it, a stalled worker can resurrect a job another worker already
    // finished — and send the email a second time.
    const store = makeStore([makeJob()], clock);
    const log = vi.fn();
    const slowHandler: JobHandler = async () => {
      // Simulate the reclaim happening while this handler runs.
      store.rows[0].attempts += 1;
      return { status: "succeeded" };
    };
    const report = await drainJobs({}, deps(clock, store, slowHandler, { log }));

    expect(report.succeeded).toBe(0);
    const warnings = log.mock.calls.filter((c) => c[0] === "warn").map((c) => String(c[1]));
    expect(warnings.some((m) => m.includes("reclaimed by another worker"))).toBe(true);
  });
});

describe("drainJobs — lease reclaim, the serverless recovery path", () => {
  it("re-claims a `running` job whose lease expired, so a killed function loses nothing", async () => {
    // Without this, a Vercel invocation terminated between claim and completion
    // leaves the row `running` forever and the email is silently never sent.
    const clock: FakeClock = { nowMs: 5_000_000 };
    const store = makeStore(
      [
        makeJob({
          status: "running",
          attempts: 1,
          lockedBy: "drain-that-died",
          leaseExpiresAt: new Date(clock.nowMs - 1),
        }),
      ],
      clock,
    );

    const report = await drainJobs({}, deps(clock, store, succeed));
    expect(report.claimed).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(store.rows[0].status).toBe("succeeded");
    // The reclaim burned an attempt, which is what stops a job that kills its
    // worker from being retried without limit.
    expect(store.rows[0].attempts).toBe(2);
  });

  it("leaves a `running` job alone while its lease is still valid", async () => {
    const clock: FakeClock = { nowMs: 5_000_000 };
    const store = makeStore(
      [
        makeJob({
          status: "running",
          attempts: 1,
          leaseExpiresAt: new Date(clock.nowMs + 60_000),
        }),
      ],
      clock,
    );
    const report = await drainJobs({}, deps(clock, store, succeed));
    expect(report.claimed).toBe(0);
  });
});

describe("drainJobs — the wall-clock budget", () => {
  it("stops claiming once the budget is spent and says so", async () => {
    // Being KILLED at the platform's maxDuration is worse than stopping early: a
    // killed invocation leaves work leased and returns no report at all.
    const clock: FakeClock = { nowMs: 1_000_000 };
    const store = makeStore(
      Array.from({ length: 5 }, (_, i) => makeJob({ id: i + 1, idempotencyKey: `k${i}` })),
      clock,
    );

    let elapsed = 0;
    const report = await drainJobs(
      { budgetMs: 1_000, batchSize: 5 },
      deps(clock, store, succeed, {
        elapsedMs: () => {
          // First call (the loop's entry check) is under budget; every subsequent
          // per-job check is over it.
          const value = elapsed;
          elapsed += 600;
          return value;
        },
      }),
    );

    expect(report.budgetExhausted).toBe(true);
    expect(report.succeeded).toBeLessThan(5);
  });

  it("honours maxJobs so a request-attached drain stays small", async () => {
    const clock: FakeClock = { nowMs: 1_000_000 };
    const store = makeStore(
      Array.from({ length: 8 }, (_, i) => makeJob({ id: i + 1, idempotencyKey: `k${i}` })),
      clock,
    );
    const report = await drainJobs({ maxJobs: 2, batchSize: 5 }, deps(clock, store, succeed));
    expect(report.claimed).toBe(2);
    expect(report.succeeded).toBe(2);
  });
});

describe("runOne", () => {
  const baseDeps: DrainDeps = {
    claim: async () => [],
    complete: async () => true,
    resolve: () => null,
    now: () => new Date(0),
    random: () => 0.5,
    elapsedMs: () => 0,
    log: () => {},
  };

  it("passes the whole job record to the handler", async () => {
    const seen: JobRecord[] = [];
    const handler: JobHandler = async (job) => {
      seen.push(job);
      return { status: "succeeded" };
    };
    const job = makeJob({ attempts: 3 });
    await runOne(job, { ...baseDeps, resolve: () => handler });
    expect(seen[0].attempts).toBe(3);
  });

  it("truncates a very long thrown message before it reaches last_error", async () => {
    const handler: JobHandler = async () => {
      throw new Error("x".repeat(5_000));
    };
    const outcome: JobOutcome = await runOne(makeJob(), {
      ...baseDeps,
      resolve: () => handler,
    });
    expect(outcome.status).toBe("retry");
    if (outcome.status === "retry") expect(outcome.error.length).toBeLessThanOrEqual(1_000);
  });
});

describe("the loop and the policy agree", () => {
  it("uses decideNextState's delay verbatim — no second opinion in the loop", async () => {
    // Guards against the loop growing its own scheduling arithmetic, which is how
    // the documented backoff and the observed one drift apart.
    const clock: FakeClock = { nowMs: 2_000_000 };
    const store = makeStore([makeJob()], clock);
    await drainJobs({}, deps(clock, store, alwaysFail));

    const expected = decideNextState(
      { attempts: 1, maxAttempts: DEFAULT_MAX_ATTEMPTS },
      { status: "retry", error: "relay refused" },
      new Date(clock.nowMs),
      () => 0.5,
    );
    expect(store.rows[0].runAfter.getTime()).toBe(expected.runAfter.getTime());
  });
});
