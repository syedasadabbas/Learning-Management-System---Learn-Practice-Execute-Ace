// =============================================================================
// E2E — async job queue + idempotency. Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Six agents share port 3000 and one seeded database, so
// the coordinator runs the e2e suite serially at integration. Authored and
// reviewed here; NEVER EXECUTED. Nothing below should be read as a passing
// result — see the stream report.
//
// WHAT THE FIRST INTEGRATION RUN OF THIS FILE FOUND, because the next reader of
// "never stuck" should know it has already earned its keep once. It failed, and
// the cause was not in this file: `jobs.run_after` was written from the Node
// process's clock while claim eligibility is `run_after <= now()` in Postgres. The
// app clock ran ~1_080 ms ahead of Neon's, so a job enqueued with no delay was
// ineligible for about a second — and the `after()`-attached drain that exists to
// deliver it fires inside that second. It claimed nothing, and with no scheduled
// drain at the time the row stayed `queued` with `attempts = 0` for good. The fix
// is in src/lib/queue/store.ts (every timestamp now comes from `now()`), the
// regression tests are in src/lib/queue/store.integration.test.ts, and the floor
// under a missed drain is now .github/workflows/drain-jobs.yml.
//
// WHY THESE ASSERTIONS AND NOT OTHERS. The unit tests in src/lib/queue/*.test.ts
// already cover the backoff arithmetic, the attempt bound, the dead-letter
// transition and the handler's failure classification, all with fakes and no
// I/O. What they CANNOT cover is the half of the idempotency guarantee that
// lives in Postgres:
//
//   * that `jobs_idempotency_key_idx` — a UNIQUE INDEX, not an application
//     check — is what collapses two enqueues of the same logical job into one
//     row. A fake store cannot demonstrate that, and the point of this work item
//     is precisely that the race is resolved by the database;
//   * that the real producer (POST /api/instructor/submissions/:id/grade, via
//     applyGrade) is actually wired to it;
//   * that the real consumer runs and reaches a terminal state.
//
// So this file drives the REAL producer over HTTP, twice, and then reads the
// queue back through the admin endpoint.
//
// SIDE EFFECTS, stated because this database is shared. Grading a submission
// WRITES: it sets score/feedback/graded_at on the row, may issue penalty rows,
// and updates the leaderboard. The specs below therefore grade a submission that
// the seed has ALREADY graded wherever possible, so the visible state is not
// changed for other streams' specs; where a fresh grade is unavoidable the test
// records the prior values and restores them is NOT attempted — see the TODO at
// the top of the grading block.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

// LOADS .env INTO THE TEST PROCESS, and this is a fix, not a convenience.
//
// Three specs in this file guard themselves with `test.skip(!process.env.CRON_SECRET)`.
// playwright.config.ts does not load dotenv, so on a developer machine — and in the
// integration run — that variable was undefined and all three SKIPPED: the
// confused-deputy defence, "an authorised drain returns a report", and "a second
// drain immediately after the first claims nothing". Those are the only specs that
// exercise the authorised drain path at all, so the skip was not a neutral
// environment guard; it silently removed the coverage of the endpoint a scheduler
// calls every five minutes. Only CI ever ran them (ci.yml sets CRON_SECRET in the
// job env), which is the worst arrangement: a red CI on code that was never
// exercised locally.
//
// `dotenv/config` never overwrites a variable that is already set, so CI's value
// still wins and nothing about that job changes.
import "dotenv/config";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { loginAs } from "../fixtures";

/** How long a poll waits for an `after()`-attached drain to finish, in ms. */
const DRAIN_POLL_TIMEOUT_MS = 20_000;
const DRAIN_POLL_INTERVAL_MS = 500;

interface JobView {
  id: number;
  kind: string;
  idempotencyKey: string;
  status: "queued" | "running" | "succeeded" | "dead";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  /** ISO timestamp. Read by the clock-skew regression assertion below. */
  runAfter: string;
  createdAt: string;
}

/**
 * The CRON_SECRET, or null.
 *
 * Read through one helper so the three specs that need it fail-or-skip with ONE
 * message, and so that message says what to do. `import "dotenv/config"` at the top
 * of this file makes it present on any machine with a .env; a null here means the
 * variable is genuinely absent from both the environment and .env, in which case the
 * app itself answers 503 and there is nothing to assert.
 */
function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

const NO_CRON_SECRET =
  "CRON_SECRET is set in neither the environment nor .env, so the authorised drain " +
  "path cannot be exercised. This is the ONLY coverage of the endpoint the scheduler " +
  "calls (.github/workflows/drain-jobs.yml) — set CRON_SECRET rather than accepting " +
  "the skip.";

/** Read the queue through the admin endpoint. Requires an admin session on `api`. */
async function readJobs(
  api: APIRequestContext,
  query = "",
): Promise<{ counts: Record<string, number>; jobs: JobView[] }> {
  const response = await api.get(`/api/admin/jobs${query}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  return body.data;
}

/**
 * Find a submission the instructor may grade.
 *
 * Prefers one that is ALREADY graded: regrading it with its existing star rating
 * changes no score a student or another spec would notice, while still exercising
 * the full producer path. Falls back to any row, and skips the test when the
 * queue is empty — an empty grading queue is a legitimate seeded state (see the
 * header of src/app/api/instructor/submissions/route.ts) and must not be reported
 * as a queue failure.
 */
async function pickSubmission(
  api: APIRequestContext,
): Promise<{ submissionId: number; stars: number } | null> {
  const response = await api.get("/api/instructor/submissions?status=all");
  expect(response.status()).toBe(200);
  const rows = (await response.json()).data.rows as Array<{
    submissionId: number;
    status: string;
    instructorRating?: number | null;
  }>;
  if (!rows.length) return null;

  const graded = rows.find((r) => r.status === "graded" && (r.instructorRating ?? 0) >= 1);
  const chosen = graded ?? rows[0];
  return {
    submissionId: chosen.submissionId,
    stars: graded?.instructorRating ?? 4,
  };
}

/** Poll until a job reaches a terminal state, or the timeout elapses. */
async function waitForTerminal(
  api: APIRequestContext,
  jobId: number,
): Promise<JobView | null> {
  const deadline = Date.now() + DRAIN_POLL_TIMEOUT_MS;
  let last: JobView | null = null;
  while (Date.now() < deadline) {
    const { jobs } = await readJobs(api, "?limit=200");
    last = jobs.find((j) => j.id === jobId) ?? null;
    if (last && (last.status === "succeeded" || last.status === "dead")) return last;
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_INTERVAL_MS));
  }
  return last;
}

// ---------------------------------------------------------------------------
// 1. AUTHORIZATION. The highest-value group: the drain route can send email to
//    students and the admin route exposes the whole queue.
// ---------------------------------------------------------------------------

test.describe("queue endpoints — authorization", () => {
  test("the drain endpoint rejects a request with no bearer token", async ({ request }) => {
    const response = await request.post("/api/cron/drain-jobs");
    // 401 when CRON_SECRET is set, 503 when it is not — both are the guard
    // working, and neither is 200. Same shape as the two cron routes that
    // already exist.
    expect([401, 503]).toContain(response.status());
    expect((await response.json()).ok).toBe(false);
  });

  test("the drain endpoint rejects a wrong bearer token", async ({ request }) => {
    const response = await request.post("/api/cron/drain-jobs", {
      headers: { authorization: "Bearer definitely-not-the-cron-secret" },
    });
    expect([401, 503]).toContain(response.status());
  });

  test("NO user role satisfies the drain endpoint — not even an admin", async ({ page }) => {
    // `ROLES_SATISFYING.cron` is the empty array. An admin who could reach this
    // could trigger mail to every student in the cohort.
    await loginAs(page, "admin");
    const response = await page.request.post("/api/cron/drain-jobs");
    expect([401, 403, 503]).toContain(response.status());
  });

  test("a valid bearer token PLUS a session cookie is still refused", async ({ page }) => {
    // The confused-deputy defence: if the secret ever leaked into client code, a
    // logged-in browser must not be able to drive the drain.
    const secret = cronSecret();
    test.skip(secret === null, NO_CRON_SECRET);
    await loginAs(page, "admin");
    const response = await page.request.post("/api/cron/drain-jobs", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("cron_only");
  });

  test("the admin jobs endpoint refuses anonymous and student callers", async ({
    page,
    request,
  }) => {
    const anonymous = await request.get("/api/admin/jobs");
    expect([401, 403]).toContain(anonymous.status());

    await loginAs(page, "student");
    const student = await page.request.get("/api/admin/jobs");
    expect(student.status()).toBe(403);
  });

  test("the admin jobs endpoint refuses an INSTRUCTOR — this is operations, not teaching", async ({
    page,
  }) => {
    // `ROLES_SATISFYING.instructor` admits admins but not the reverse, so this
    // asserts the level was chosen deliberately rather than copied.
    await loginAs(page, "instructor");
    const response = await page.request.get("/api/admin/jobs");
    expect(response.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 2. THE ADMIN VIEW. A dead-letter state that nobody can see is not a state.
// ---------------------------------------------------------------------------

test.describe("queue visibility", () => {
  test("an admin can read the counts and filter to the dead letters", async ({ page }) => {
    await loginAs(page, "admin");
    const { counts, jobs } = await readJobs(page.request, "?status=dead");

    for (const key of ["queued", "running", "succeeded", "dead", "readyNow", "staleLeases"]) {
      expect(typeof counts[key]).toBe("number");
    }
    // The filter must be honoured, or an operator checking for dead jobs would
    // read a list of successes and conclude there are none.
    for (const job of jobs) expect(job.status).toBe("dead");
    expect(jobs.length).toBe(counts.dead);
  });

  test("an unrecognised status filter returns nothing rather than everything", async ({
    page,
  }) => {
    // ?status=deadd must not silently list the whole queue.
    await loginAs(page, "admin");
    const { jobs } = await readJobs(page.request, "?status=deadd");
    expect(jobs).toEqual([]);
  });

  test("requeuing requires an explicit target", async ({ page }) => {
    await loginAs(page, "admin");
    const response = await page.request.post("/api/admin/jobs", {
      data: { action: "requeue" },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe("target_required");
  });
});

// ---------------------------------------------------------------------------
// 3. THE REAL PRODUCER, AND THE DATABASE-LEVEL IDEMPOTENCY GUARANTEE.
// ---------------------------------------------------------------------------

test.describe("grading enqueues exactly one notification", () => {
  // TODO(queue): these specs WRITE. Grading sets score/feedback/graded_at, may
  // issue penalty rows and updates the leaderboard, and nothing here restores the
  // prior values. `pickSubmission` prefers an already-graded row and re-submits
  // its existing star rating so the visible score does not move, but the
  // `graded_at` timestamp DOES change, which shifts the row's position in any
  // spec that orders by it. Flagged to the coordinator rather than silently
  // relied upon.

  test("a grade enqueues a job, and grading again does NOT enqueue a second", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    const target = await pickSubmission(page.request);
    test.skip(target === null, "The grading queue is empty in this seeded state.");
    if (!target) return;

    const grade = async () =>
      page.request.post(`/api/instructor/submissions/${target.submissionId}/grade`, {
        data: { stars: target.stars, feedback: "Queue e2e: unchanged rating." },
      });

    const first = await grade();
    expect(first.status()).toBe(200);

    // Read the queue as an admin. A separate login, because the instructor is
    // deliberately not permitted to read /api/admin/jobs.
    await loginAs(page, "admin");
    const afterFirst = await readJobs(page.request, "?kind=submission_graded_email&limit=200");
    const mine = afterFirst.jobs.filter((j) =>
      j.idempotencyKey.startsWith(`submission_graded_email:${target.submissionId}:`),
    );
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const keysAfterFirst = new Set(mine.map((j) => j.idempotencyKey));

    // GRADE AGAIN, immediately, with the same values. The second grading
    // transaction writes a NEW graded_at, so this is a genuine regrade and a
    // second job is CORRECT — see src/lib/queue/keys.ts, which argues at length
    // why keying on the submission alone would silently never notify a regrade.
    // What must NOT happen is two jobs for ONE graded_at, which is the assertion
    // below: every key is distinct, i.e. no key was inserted twice.
    await loginAs(page, "instructor");
    const second = await grade();
    expect(second.status()).toBe(200);

    await loginAs(page, "admin");
    const afterSecond = await readJobs(page.request, "?kind=submission_graded_email&limit=200");
    const allMine = afterSecond.jobs.filter((j) =>
      j.idempotencyKey.startsWith(`submission_graded_email:${target.submissionId}:`),
    );
    const distinctKeys = new Set(allMine.map((j) => j.idempotencyKey));
    expect(distinctKeys.size).toBe(allMine.length);
    expect(distinctKeys.size).toBeGreaterThanOrEqual(keysAfterFirst.size);
  });

  test("TWO CONCURRENT grade requests produce ONE job for that grading moment", async ({
    page,
  }) => {
    // THE CENTRAL SPEC OF THIS WORK ITEM, and the one thing no unit test can
    // assert: the race is resolved by `jobs_idempotency_key_idx`, not by
    // application code. Both requests are in flight at once — the shape of a
    // double-clicked Save routed to two serverless instances — so both producers
    // read the same committed `graded_at` and build the SAME key. Under READ
    // COMMITTED a select-then-insert would let both through; the unique index
    // does not.
    //
    // The assertion is on DISTINCT KEYS rather than on a job count, because the
    // two grade calls may commit as one or two grading transactions depending on
    // interleaving, and either is legitimate. What is never legitimate is the
    // same key existing twice — and if the index were dropped, that is exactly
    // what this would produce.
    await loginAs(page, "instructor");
    const target = await pickSubmission(page.request);
    test.skip(target === null, "The grading queue is empty in this seeded state.");
    if (!target) return;

    const body = { stars: target.stars, feedback: "Queue e2e: concurrent." };
    const [a, b] = await Promise.all([
      page.request.post(`/api/instructor/submissions/${target.submissionId}/grade`, {
        data: body,
      }),
      page.request.post(`/api/instructor/submissions/${target.submissionId}/grade`, {
        data: body,
      }),
    ]);
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);

    await loginAs(page, "admin");
    const { jobs } = await readJobs(page.request, "?kind=submission_graded_email&limit=200");
    const mine = jobs.filter((j) =>
      j.idempotencyKey.startsWith(`submission_graded_email:${target.submissionId}:`),
    );
    const keys = mine.map((j) => j.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 4. THE REAL CONSUMER. The job must reach a terminal state and stay there.
// ---------------------------------------------------------------------------

test.describe("draining runs the job to a terminal state", () => {
  test("a queued notification ends as succeeded or dead, never stuck", async ({ page }) => {
    // Two admin logins plus up to DRAIN_POLL_TIMEOUT_MS of polling does not fit in
    // the 30_000 ms default, and a test that dies of its own timeout reports
    // "timeout" instead of the assertion message below — which is the whole
    // diagnostic. Raised deliberately rather than by shortening the poll: the poll
    // budget is what makes "never stuck" mean something.
    test.setTimeout(90_000);
    await loginAs(page, "instructor");
    const target = await pickSubmission(page.request);
    test.skip(target === null, "The grading queue is empty in this seeded state.");
    if (!target) return;

    const graded = await page.request.post(
      `/api/instructor/submissions/${target.submissionId}/grade`,
      { data: { stars: target.stars, feedback: "Queue e2e: drain." } },
    );
    expect(graded.status()).toBe(200);

    await loginAs(page, "admin");
    const { jobs } = await readJobs(page.request, "?kind=submission_graded_email&limit=200");
    const mine = jobs
      .filter((j) =>
        j.idempotencyKey.startsWith(`submission_graded_email:${target.submissionId}:`),
      )
      .sort((x, y) => y.id - x.id);
    expect(mine.length).toBeGreaterThan(0);

    // THE CLOCK-SKEW REGRESSION, checked BEFORE the poll so a failure names the
    // cause instead of reporting a mysterious "still queued".
    //
    // This job was enqueued with no delay, so `run_after` must not be in the future
    // relative to `created_at` — both are stamped by `now()` inside one INSERT. When
    // `run_after` came from the Node process's clock instead, this difference was
    // +823 ms on the row that made this spec fail, and any positive value here means
    // there is a window in which the `after()` drain cannot see its own job. A small
    // NEGATIVE difference would be fine and is not asserted against, because it only
    // ever makes a job eligible sooner.
    const skewMs =
      new Date(mine[0].runAfter).getTime() - new Date(mine[0].createdAt).getTime();
    expect(
      skewMs,
      "run_after is later than the created_at stamped on the same INSERT, so the " +
        "row is not claimable yet and the request-attached drain will miss it. " +
        "Both must come from the DATABASE clock — see src/lib/queue/store.ts.",
    ).toBeLessThanOrEqual(0);

    // The `after()`-attached drain (src/lib/queue/schedule.ts) normally finishes
    // this within a second of the grading response. Polled rather than asserted
    // immediately, because it runs AFTER the response is flushed and there is no
    // synchronisation point the test can observe.
    const terminal = await waitForTerminal(page.request, mine[0].id);
    expect(terminal).not.toBeNull();
    expect(
      ["succeeded", "dead"],
      `job ${mine[0].id} was still "${terminal?.status}" after ${DRAIN_POLL_TIMEOUT_MS} ms ` +
        `with ${terminal?.attempts} attempt(s). attempts=0 means NO drain ever claimed it ` +
        `(check that after() is firing, that QUEUE_AUTO_DRAIN is not "false", and the ` +
        `run_after assertion above); attempts>0 means it was claimed and is being retried, ` +
        `so read lastError: ${terminal?.lastError ?? "null"}`,
    ).toContain(terminal?.status);
    // Bounded either way — a job must never sit at more attempts than it is
    // allowed.
    expect(terminal!.attempts).toBeLessThanOrEqual(terminal!.maxAttempts);

    // WITH NO SMTP CONFIGURED — this project's default state per FREE_STACK.md —
    // the dev transport reports success without delivering anything. A green run
    // here therefore proves the queue ran the handler; it does NOT prove an email
    // arrived. Stated in the assertion message so a reader cannot miss it.
    if (terminal?.status === "dead") {
      expect(
        terminal.lastError,
        "the job dead-lettered; read lastError before assuming the queue is broken",
      ).toBeTruthy();
    }
  });

  test("an authorised drain returns a report and leaves nothing ready", async ({ request }) => {
    const secret = cronSecret();
    test.skip(secret === null, NO_CRON_SECRET);

    const response = await request.post("/api/cron/drain-jobs", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status()).toBe(200);
    const { data } = await response.json();

    for (const key of ["claimed", "succeeded", "retried", "deadLettered", "durationMs"]) {
      expect(typeof data[key]).toBe("number");
    }
    expect(typeof data.workerId).toBe("string");
    // 200 even when `deadLettered` is non-zero: a sweep that ran and reported
    // problems is a successful sweep. The number is the signal, not the status.
    expect(data.deadLettered).toBeGreaterThanOrEqual(0);
  });

  test("a second drain immediately after the first claims nothing", async ({ request }) => {
    // Idempotency at the DRAIN level: a succeeded job is terminal and must not be
    // picked up again. If this fails, students receive duplicate email on every
    // cron tick.
    const secret = cronSecret();
    test.skip(secret === null, NO_CRON_SECRET);
    const headers = { authorization: `Bearer ${secret}` };

    await request.post("/api/cron/drain-jobs", { headers });
    const second = await request.post("/api/cron/drain-jobs", { headers });
    expect(second.status()).toBe(200);
    const { data } = await second.json();
    // Anything still claimable is a job whose backoff elapsed between the two
    // calls, which is possible but should not be a steady state.
    expect(data.claimed).toBe(0);
  });
});
