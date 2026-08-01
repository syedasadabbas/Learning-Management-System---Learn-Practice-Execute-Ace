// =============================================================================
// RECORD-AND-ENQUEUE TESTS — the write ORDER and the one shared key.
// -----------------------------------------------------------------------------
// What is actually worth asserting here is not "a row is inserted". It is:
//
//   1. THE KEY IS ONE STRING. `notifications.dedupe_key` and
//      `jobs.idempotency_key` must be the same value, because the mail ledger
//      (src/lib/mail/dispatch.ts) de-duplicates the SEND on the job's key. If they
//      ever diverge, the send is de-duplicated against another message's ledger row
//      — the only failure mode that can suppress a real email or duplicate one.
//   2. A CONFLICTING INSERT ENQUEUES NOTHING. The replay of an exam finalize (the
//      cron sweeper racing the student's own submit) must not add a second job.
//   3. A FAILED ENQUEUE STILL LEAVES THE HISTORY ROW. That is the whole reason the
//      history is written first: the failure is late-not-lost and it is visible.
//   4. THE PREFERENCE GATE RUNS BEFORE BOTH WRITES, so an opted-out student costs
//      no row, no job and no drain.
//
// The database, the queue store and the drain scheduler are all mocked: this module
// makes DECISIONS about ordering, and a test that needed Postgres to prove an
// ordering decision would be an integration test of drizzle.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const enqueueJob = vi.fn();
const scheduleDrain = vi.fn();

vi.mock("@/lib/queue/store", () => ({ enqueueJob: (...args: unknown[]) => enqueueJob(...args) }));
vi.mock("@/lib/queue/schedule", () => ({ scheduleDrain: () => scheduleDrain() }));

import { PREFERENCE_DEFAULTS } from "./preferences";
import { quizSubmittedKey } from "./keys";
import { parseNotificationEmailPayload, recordAndEnqueue } from "./record";

/**
 * A chainable stub covering the two builders this module uses:
 *   select().from().where().limit()                      (the preference read)
 *   insert().values().onConflictDoNothing().returning()  (the history row)
 */
function fakeClient(options: {
  preferenceRows?: unknown[];
  insertReturns?: unknown[];
  insertThrows?: boolean;
  captured?: Record<string, unknown>;
}) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "insert", "onConflictDoNothing"]) {
    chain[method] = () => chain;
  }
  chain.values = (arg: unknown) => {
    if (options.captured) options.captured.values = arg;
    return chain;
  };
  chain.limit = async () => options.preferenceRows ?? [];
  chain.returning = async () => {
    if (options.insertThrows) throw new Error("neon: could not write");
    return options.insertReturns ?? [];
  };
  return chain as never;
}

const INPUT = {
  userId: 7,
  type: "quiz_submitted" as const,
  dedupeKey: quizSubmittedKey(41),
  recipientEmail: " student@codequeenshub.test ",
  subject: "You passed",
  body: "Hello,\n\nScore: 8 / 10",
  metadata: { attemptId: 41, url: "/quizzes/3" },
};

beforeEach(() => {
  // `restoreAllMocks` FIRST, then the defaults. In the other order it strips the
  // implementations set on the two module mocks (it calls mockRestore on every mock,
  // not only on spies), which makes `enqueueJob` return undefined and every
  // assertion below fail for a reason that has nothing to do with the code.
  vi.restoreAllMocks();
  enqueueJob.mockReset();
  enqueueJob.mockResolvedValue({ created: true, jobId: 99, idempotencyKey: INPUT.dedupeKey });
  scheduleDrain.mockReset();
});

describe("the history row and the job share ONE key", () => {
  it("passes the same string as dedupe_key and idempotency_key", async () => {
    const captured: Record<string, unknown> = {};
    const result = await recordAndEnqueue(
      INPUT,
      fakeClient({ insertReturns: [{ id: 5 }], captured }),
    );

    expect(result).toEqual({
      ok: true,
      notificationId: 5,
      dedupeKey: INPUT.dedupeKey,
      enqueued: true,
    });
    expect((captured.values as { dedupeKey: string }).dedupeKey).toBe(INPUT.dedupeKey);
    expect(enqueueJob.mock.calls[0][0]).toMatchObject({
      kind: "notification_email",
      idempotencyKey: INPUT.dedupeKey,
      payload: { notificationId: 5 },
    });
  });

  it("trims the recipient and records the row as pending", async () => {
    const captured: Record<string, unknown> = {};
    await recordAndEnqueue(INPUT, fakeClient({ insertReturns: [{ id: 5 }], captured }));
    expect(captured.values).toMatchObject({
      recipientEmail: "student@codequeenshub.test",
      status: "pending",
      userId: 7,
    });
  });

  it("drains in-request exactly once, and only when the job was created", async () => {
    await recordAndEnqueue(INPUT, fakeClient({ insertReturns: [{ id: 5 }] }));
    expect(scheduleDrain).toHaveBeenCalledTimes(1);

    scheduleDrain.mockReset();
    enqueueJob.mockResolvedValue({ created: false, jobId: 99, idempotencyKey: INPUT.dedupeKey });
    await recordAndEnqueue(INPUT, fakeClient({ insertReturns: [{ id: 6 }] }));
    // A duplicate job must not buy a second drain — the first already scheduled one.
    expect(scheduleDrain).not.toHaveBeenCalled();
  });

  it("does not drain when the caller asked not to", async () => {
    await recordAndEnqueue({ ...INPUT, drain: false }, fakeClient({ insertReturns: [{ id: 5 }] }));
    expect(scheduleDrain).not.toHaveBeenCalled();
  });
});

describe("a duplicate event is a normal outcome, not an error", () => {
  it("enqueues nothing when the dedupe key already exists", async () => {
    const result = await recordAndEnqueue(INPUT, fakeClient({ insertReturns: [] }));
    expect(result).toEqual({ ok: false, reason: "duplicate" });
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(scheduleDrain).not.toHaveBeenCalled();
  });
});

describe("the preference gate runs BEFORE either write", () => {
  it("writes nothing at all for an opted-out student", async () => {
    const captured: Record<string, unknown> = {};
    const result = await recordAndEnqueue(
      { ...INPUT, preferenceAlreadyChecked: false },
      fakeClient({
        preferenceRows: [{ ...PREFERENCE_DEFAULTS, quizSubmitted: false }],
        insertReturns: [{ id: 5 }],
        captured,
      }),
    );

    expect(result).toEqual({ ok: false, reason: "suppressed_by_preference" });
    expect(captured.values).toBeUndefined();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("proceeds when the student has no preferences row at all", async () => {
    const result = await recordAndEnqueue(
      { ...INPUT, preferenceAlreadyChecked: false },
      fakeClient({ preferenceRows: [], insertReturns: [{ id: 5 }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("skips the read when the producer already resolved preferences", async () => {
    // The producer reads once and passes the flag; a second read on the same request
    // is ~245 ms of round trip for an answer it already has.
    const client = fakeClient({ preferenceRows: [], insertReturns: [{ id: 5 }] });
    const spy = vi.spyOn(client as unknown as { select: () => unknown }, "select");
    await recordAndEnqueue({ ...INPUT, preferenceAlreadyChecked: true }, client);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("failures are values, and the visible one is preferred", () => {
  it("refuses an empty recipient without touching the database", async () => {
    const captured: Record<string, unknown> = {};
    const result = await recordAndEnqueue(
      { ...INPUT, recipientEmail: "   " },
      fakeClient({ insertReturns: [{ id: 5 }], captured }),
    );
    expect(result).toEqual({ ok: false, reason: "no_recipient" });
    expect(captured.values).toBeUndefined();
  });

  it("reports record_failed and enqueues nothing when the history insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await recordAndEnqueue(INPUT, fakeClient({ insertThrows: true }));
    expect(result).toEqual({ ok: false, reason: "record_failed" });
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain("NOTHING was enqueued");
  });

  it("keeps the pending history row when the ENQUEUE fails", async () => {
    // The write order's whole payoff: the student's message is late and visible,
    // rather than absent with a dead-lettered job pointing at nothing.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    enqueueJob.mockRejectedValue(new Error("jobs table unreachable"));

    const result = await recordAndEnqueue(INPUT, fakeClient({ insertReturns: [{ id: 5 }] }));

    expect(result).toEqual({
      ok: true,
      notificationId: 5,
      dedupeKey: INPUT.dedupeKey,
      enqueued: false,
    });
    expect(String(spy.mock.calls[0][0])).toContain("FAILED to enqueue");
  });
});

describe("parseNotificationEmailPayload classifies a malformed payload permanently", () => {
  it("accepts a positive integer id", () => {
    expect(parseNotificationEmailPayload({ notificationId: 5 })).toEqual({ notificationId: 5 });
  });

  it.each([null, undefined, 5, "5", {}, { notificationId: 0 }, { notificationId: -1 }, { notificationId: 1.5 }])(
    "rejects %j",
    (payload) => {
      expect(parseNotificationEmailPayload(payload)).toBeNull();
    },
  );
});
