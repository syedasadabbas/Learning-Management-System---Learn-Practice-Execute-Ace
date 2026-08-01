// =============================================================================
// THE TWO TRIGGERS — the request-attached drain, and the scheduled floor.
// -----------------------------------------------------------------------------
// The second half of this file reads a YAML file off disk from a unit test, which
// deserves a justification rather than an apology.
//
// The availability gap this queue had was not a bug in any function. It was an
// ABSENT FILE: with no scheduled caller, a retry scheduled 240_000 ms out waited
// for the next request that happened to trigger a drain, so the retry policy was
// arithmetic nobody executed. Nothing in TypeScript can notice that
// .github/workflows/drain-jobs.yml has been deleted, renamed, quietly switched to
// a daily schedule, or edited to swallow a non-200 — and each of those returns the
// queue to exactly the state it was in, silently, because the common path keeps
// working via after(). A CI-visible assertion is the cheapest thing that fails
// when the floor is removed.
//
// It asserts PROPERTIES, not the file's text: that a schedule exists and is
// sub-hourly, that the drain step fails on a non-200, and that the secrets are
// checked. Reformatting the workflow does not break it; removing its guarantees
// does.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REQUEST_DRAIN_BUDGET_MS, REQUEST_DRAIN_MAX_JOBS, scheduleDrain } from "./schedule";
import { DRAIN_BUDGET_MS, BACKOFF_BASE_MS } from "./policy";

describe("scheduleDrain — the request-attached trigger", () => {
  it("does NOT throw when there is no request context", () => {
    // `after()` throws outside a request, which is every script, test and
    // build-time module evaluation. Producers call this immediately after
    // committing a grade, so a throw here would fail a request whose work is
    // already done. The catch is the contract, and this is the test of it.
    expect(() => scheduleDrain()).not.toThrow();
  });

  it("keeps a much smaller budget than the cron drain, because it rides a user's request", () => {
    // The response has already been flushed, but the invocation is still billed and
    // still counts against that route's maxDuration. If these two were equal, a
    // grading request could sit in a 25_000 ms drain on somebody else's behalf.
    expect(REQUEST_DRAIN_BUDGET_MS).toBeLessThan(DRAIN_BUDGET_MS);
    expect(REQUEST_DRAIN_MAX_JOBS).toBeGreaterThan(0);
  });
});

describe("the scheduled floor exists and fails loudly", () => {
  const workflow = readFileSync(
    path.join(process.cwd(), ".github", "workflows", "drain-jobs.yml"),
    "utf8",
  );

  it("is scheduled, and MORE OFTEN than hourly", () => {
    const match = workflow.match(/-\s*cron:\s*"([^"]+)"/);
    expect(match, "no `- cron:` expression — the queue has no scheduled drain").not.toBeNull();

    // `*/N * * * *` is the only shape that is sub-hourly in the minute field. A
    // plain number there (e.g. "0 * * * *") is hourly, which is longer than the
    // entire 5-attempt retry ladder (30_000 + 60_000 + 120_000 + 240_000 ms) and
    // would make every backoff below the last one meaningless.
    const minuteField = match![1].trim().split(/\s+/)[0];
    expect(minuteField).toMatch(/^\*\/\d+$/);
    const everyMs = Number(minuteField.slice(2)) * 60_000;
    expect(everyMs).toBeLessThanOrEqual(BACKOFF_BASE_MS * 20);
    expect(everyMs).toBeLessThan(3_600_000);
  });

  it("calls the drain route, with the bearer token as its only credential", () => {
    expect(workflow).toContain("/api/cron/drain-jobs");
    expect(workflow).toContain("authorization: Bearer ${CRON_SECRET}");
    // A scheduler that sent a cookie would be refused by the route's
    // confused-deputy guard, so the absence of one is part of it working. Matched
    // on the curl FLAGS rather than the word "cookie", which legitimately appears
    // in the prose explaining why a 403 happens — a first pass asserted the word
    // and failed against its own documentation.
    expect(workflow).not.toMatch(/--cookie|(^|\s)-b\s/m);
  });

  it("FAILS the run on anything that is not a 200", () => {
    // The point of a monitored schedule. A workflow that curls and ignores the
    // status is indistinguishable from no workflow: 401 on a rotated secret and
    // 503 on an unset one would both report green forever while nothing drained.
    expect(workflow).toMatch(/!=\s*"200"/);
    expect(workflow).toContain("exit 1");
    expect(workflow).toContain("::error");
  });

  it("checks both required secrets before doing anything", () => {
    // The likeliest reason this does not work on a fresh repository, so it gets a
    // named failure rather than a curl error with an empty URL.
    expect(workflow).toContain("APP_ORIGIN");
    expect(workflow).toContain("CRON_SECRET");
    expect(workflow).toMatch(/Missing repository secret/);
  });

  it("does NOT fail merely because jobs were dead-lettered", () => {
    // `deadLettered > 0` is a signal for an operator, not a broken sweep. A
    // permanently red schedule is a schedule people stop reading, and the route
    // deliberately answers 200 in that case — the workflow must agree with it.
    expect(workflow).toContain("::warning title=${dead} job(s) dead-lettered");
  });

  it("does not cancel a running drain in favour of a newer tick", () => {
    // Cancelling mid-batch would abandon claimed jobs and leave them leased for
    // LEASE_MS. Overlapping drains are safe (`for update skip locked` partitions
    // the queue), so queueing is strictly better than cancelling.
    expect(workflow).toContain("cancel-in-progress: false");
  });
});
