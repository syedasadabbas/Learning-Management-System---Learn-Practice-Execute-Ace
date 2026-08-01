// =============================================================================
// CONSUMER TESTS — the failure CLASSIFICATION and the two "do not retry" branches.
// -----------------------------------------------------------------------------
// Same value proposition as ./submission-graded-email.test.ts: the interesting
// behaviour is not "it sends an email", it is which failures are declared PERMANENT
// (dead-lettered on the first attempt) and which are TRANSIENT (retried with
// backoff) — plus, unique to this handler, whether the `notifications` row is moved
// to a state that matches. Getting `already_sent` wrong reintroduces a double email
// on every lease expiry; getting `failed` wrong shows a student "we could not tell
// you" while a retry is still scheduled.
//
// The row loader, the status writers, the preference read and the mail ledger are
// all mocked. The ledger is mocked AT THE DISPATCH SEAM (not at the transport)
// because that is what this handler talks to, and the six DispatchOutcome branches
// are then asserted directly against `applyDispatch`, which is where the mapping
// lives — four of the six cannot be produced by any transport.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const loadNotificationForSend = vi.fn();
const markNotificationSent = vi.fn();
const markNotificationFailed = vi.fn();
const markNotificationSuppressed = vi.fn();
const noteNotificationRetry = vi.fn();

vi.mock("@/lib/notifications/record", async (importOriginal) => {
  // `parseNotificationEmailPayload` is REAL — it is the permanent-failure classifier
  // for a malformed payload and stubbing it would erase the assertion.
  const actual = await importOriginal<typeof import("@/lib/notifications/record")>();
  return {
    ...actual,
    loadNotificationForSend: (...a: unknown[]) => loadNotificationForSend(...a),
    markNotificationSent: (...a: unknown[]) => markNotificationSent(...a),
    markNotificationFailed: (...a: unknown[]) => markNotificationFailed(...a),
    markNotificationSuppressed: (...a: unknown[]) => markNotificationSuppressed(...a),
    noteNotificationRetry: (...a: unknown[]) => noteNotificationRetry(...a),
  };
});

const isEnabledFor = vi.fn();
vi.mock("@/lib/notifications/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/preferences")>();
  return { ...actual, isEnabledFor: (...a: unknown[]) => isEnabledFor(...a) };
});

const sendDeduplicated = vi.fn();
vi.mock("@/lib/mail/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/dispatch")>();
  return { ...actual, sendDeduplicated: (...a: unknown[]) => sendDeduplicated(...a) };
});

import type { DispatchOutcome } from "@/lib/mail/dispatch";

import { applyDispatch, handleNotificationEmail } from "./notification-email";
import type { JobRecord } from "../types";

const KEY = "notification_email:quiz_submitted:41";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 500,
    kind: "notification_email",
    idempotencyKey: KEY,
    payload: { notificationId: 5 },
    status: "running",
    attempts: 1,
    maxAttempts: 5,
    runAfter: new Date(),
    leaseExpiresAt: new Date(),
    lockedBy: "worker-1",
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

const ROW = {
  id: 5,
  userId: 7,
  type: "quiz_submitted" as const,
  dedupeKey: KEY,
  recipientEmail: "student@codequeenshub.test",
  subject: "You passed",
  body: "Hello,\n\nScore: 8 / 10",
  status: "pending" as const,
  metadata: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  for (const m of [
    loadNotificationForSend,
    markNotificationSent,
    markNotificationFailed,
    markNotificationSuppressed,
    noteNotificationRetry,
    isEnabledFor,
    sendDeduplicated,
  ]) {
    m.mockReset();
  }
  loadNotificationForSend.mockResolvedValue(ROW);
  isEnabledFor.mockResolvedValue(true);
  markNotificationSent.mockResolvedValue(undefined);
  markNotificationFailed.mockResolvedValue(undefined);
  markNotificationSuppressed.mockResolvedValue(undefined);
  noteNotificationRetry.mockResolvedValue(undefined);
  sendDeduplicated.mockResolvedValue({
    status: "sent",
    transport: "dev",
    messageId: "<lms-test@example.test>",
    attempts: 1,
  });
});

describe("permanent failures — dead-lettered on the first attempt", () => {
  it("dead-letters a malformed payload", async () => {
    const outcome = await handleNotificationEmail(job({ payload: { nope: true } }));
    expect(outcome.status).toBe("dead");
    expect(sendDeduplicated).not.toHaveBeenCalled();
  });

  it("dead-letters when the notification row is gone", async () => {
    loadNotificationForSend.mockResolvedValue(null);
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("dead");
    expect(outcome).toMatchObject({ error: expect.stringContaining("no longer exists") });
  });

  it("REFUSES to send when the row's dedupe key and the job's key disagree", async () => {
    // The one failure mode that could de-duplicate a send against another message's
    // ledger row. Refused loudly rather than resolved by preferring one of the two.
    loadNotificationForSend.mockResolvedValue({ ...ROW, dedupeKey: "notification_email:penalty_issued:88" });
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("dead");
    expect(sendDeduplicated).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ error: expect.stringContaining("must be one string") });
  });
});

describe("work that is already done reports success without sending", () => {
  it("does not re-send a row already recorded as sent", async () => {
    loadNotificationForSend.mockResolvedValue({ ...ROW, status: "sent" });
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("succeeded");
    expect(sendDeduplicated).not.toHaveBeenCalled();
  });

  it("does not send a row already marked suppressed", async () => {
    loadNotificationForSend.mockResolvedValue({ ...ROW, status: "suppressed" });
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("succeeded");
    expect(sendDeduplicated).not.toHaveBeenCalled();
  });
});

describe("the late opt-out is honoured", () => {
  it("suppresses a queued message whose category was switched off after enqueue", async () => {
    isEnabledFor.mockResolvedValue(false);
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("succeeded");
    expect(sendDeduplicated).not.toHaveBeenCalled();
    expect(markNotificationSuppressed).toHaveBeenCalledWith(5);
  });

  it("a failing status write must not turn an opt-out into a sent email", async () => {
    isEnabledFor.mockResolvedValue(false);
    markNotificationSuppressed.mockRejectedValue(new Error("write failed"));
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("succeeded");
    expect(sendDeduplicated).not.toHaveBeenCalled();
  });
});

describe("the send itself", () => {
  it("de-duplicates on the JOB's key and sends the stored subject and body as text", async () => {
    const outcome = await handleNotificationEmail(job());
    expect(outcome.status).toBe("succeeded");
    expect(sendDeduplicated).toHaveBeenCalledTimes(1);
    expect(sendDeduplicated.mock.calls[0][0]).toEqual({
      dedupeKey: KEY,
      message: {
        to: "student@codequeenshub.test",
        subject: "You passed",
        text: "Hello,\n\nScore: 8 / 10",
      },
    });
    // No `html` key at all — the HTML part is deliberately not persisted, so the
    // message is text/plain rather than a re-derivation that could disagree with the
    // history the student can read in the app.
    expect(sendDeduplicated.mock.calls[0][0].message).not.toHaveProperty("html");
    expect(markNotificationSent).toHaveBeenCalledWith(5);
  });
});

describe("applyDispatch — which outcomes may be retried, and what the row says", () => {
  const outcomes: Array<{
    name: string;
    dispatch: DispatchOutcome;
    expected: "succeeded" | "retry" | "dead";
  }> = [
    {
      name: "sent",
      dispatch: { status: "sent", transport: "dev", messageId: "<a@b>", attempts: 1 },
      expected: "succeeded",
    },
    {
      name: "already_sent",
      dispatch: { status: "already_sent", messageId: "<a@b>", sentAtMs: 1 },
      expected: "succeeded",
    },
    {
      name: "resent_after_unknown",
      dispatch: {
        status: "resent_after_unknown",
        transport: "smtp",
        messageId: "<a@b>",
        attempts: 2,
      },
      expected: "succeeded",
    },
    {
      name: "failed",
      dispatch: { status: "failed", transport: "smtp", reason: "send_failed", attempts: 1 },
      expected: "retry",
    },
    {
      name: "ledger_unavailable",
      dispatch: { status: "ledger_unavailable", error: "pool down" },
      expected: "retry",
    },
    {
      name: "unknown_exhausted",
      dispatch: { status: "unknown_exhausted", attempts: 2, claimedAtMs: 1 },
      expected: "dead",
    },
  ];

  it.each(outcomes)("$name -> $expected", async ({ dispatch, expected }) => {
    const outcome = await applyDispatch(dispatch, 5, { attempts: 1, maxAttempts: 5 });
    expect(outcome.status).toBe(expected);
  });

  it("marks the row sent for all three success branches", async () => {
    for (const { dispatch, expected } of outcomes) {
      if (expected !== "succeeded") continue;
      markNotificationSent.mockClear();
      await applyDispatch(dispatch, 5, { attempts: 1, maxAttempts: 5 });
      expect(markNotificationSent).toHaveBeenCalledWith(5);
    }
  });

  it("keeps the row PENDING on a transient failure that still has attempts left", async () => {
    const outcome = await applyDispatch(
      { status: "failed", transport: "smtp", reason: "send_failed", attempts: 1 },
      5,
      { attempts: 2, maxAttempts: 5 },
    );
    expect(outcome.status).toBe("retry");
    expect(noteNotificationRetry).toHaveBeenCalledTimes(1);
    expect(markNotificationFailed).not.toHaveBeenCalled();
  });

  it("marks the row FAILED once the queue is on its last attempt", async () => {
    // `attempts` is incremented AT CLAIM TIME (../store.ts#claimJobs), so
    // attempts === maxAttempts means this run is the last one.
    const outcome = await applyDispatch(
      { status: "failed", transport: "smtp", reason: "send_failed", attempts: 1 },
      5,
      { attempts: 5, maxAttempts: 5 },
    );
    expect(outcome.status).toBe("retry");
    expect(markNotificationFailed).toHaveBeenCalledTimes(1);
    expect(noteNotificationRetry).not.toHaveBeenCalled();
  });

  it("marks the row failed and dead-letters an indeterminate send, whatever the attempt", async () => {
    const outcome = await applyDispatch({ status: "unknown_exhausted", attempts: 2, claimedAtMs: 1 }, 5, {
      attempts: 1,
      maxAttempts: 5,
    });
    expect(outcome.status).toBe("dead");
    expect(String((outcome as { error: string }).error)).toContain("NOT known whether");
    expect(markNotificationFailed).toHaveBeenCalledTimes(1);
  });

  it("a failing status write never changes the job outcome", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    markNotificationSent.mockRejectedValue(new Error("update failed"));
    const outcome = await applyDispatch(
      { status: "sent", transport: "dev", messageId: "<a@b>", attempts: 1 },
      5,
      { attempts: 1, maxAttempts: 5 },
    );
    // Turning a successful send into a retry because a display column failed to
    // update is exactly how a duplicate email happens.
    expect(outcome.status).toBe("succeeded");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
