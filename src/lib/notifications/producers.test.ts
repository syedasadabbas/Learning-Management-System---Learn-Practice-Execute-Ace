// =============================================================================
// PRODUCER TESTS — the message a student would actually receive, and the gate.
// -----------------------------------------------------------------------------
// The TEMPLATE IS NOT MOCKED. A test that stubs the renderer proves nothing about
// the mail anyone receives, which is the same call
// src/lib/queue/handlers/submission-graded-email.test.ts makes. So the assertions
// below read the real rendered subject and body that `recordAndEnqueue` is handed.
//
// `recordAndEnqueue` IS mocked, because its own behaviour (write order, dedupe,
// drain scheduling) is asserted exhaustively in ./record.test.ts and re-proving it
// through three producers would be three copies of the same test.
//
// NOTE ON WIRING. These producers have no callers in src/ yet — the three call
// sites belong to other streams' files and were reported to the coordinator rather
// than edited (see ./producers.ts's header for the exact file:line of each). These
// tests are therefore the ONLY thing exercising them today, which is stated plainly
// so nobody reads a green suite as evidence that a student receives this mail.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail")>();
  return { ...actual, appOrigin: () => "https://lms.example.test" };
});

const recordAndEnqueue = vi.fn();
vi.mock("./record", () => ({
  recordAndEnqueue: (...args: unknown[]) => recordAndEnqueue(...args),
}));

import { PREFERENCE_DEFAULTS } from "./preferences";
import { notifyExamCompleted, notifyPenaltyIssued, notifyQuizSubmitted } from "./producers";

/**
 * A chainable stub for the two reads a producer makes:
 *   select().from().where().limit()                    (the user row)
 *   select().from().leftJoin().where().limit()          (the quiz/week row)
 * Rows are served in the order the producer asks for them.
 */
function fakeClient(rowQueue: unknown[][]) {
  const queue = [...rowQueue];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "leftJoin", "innerJoin"]) {
    chain[method] = () => chain;
  }
  chain.limit = async () => queue.shift() ?? [];
  return chain as never;
}

const USER = [{ name: "Demo Student", email: "student@codequeenshub.test" }];
const NO_PREFERENCE_ROW: unknown[] = [];

const QUIZ_EVENT = {
  studentId: 7,
  attemptId: 41,
  quizId: 3,
  weekId: 2,
  attemptNumber: 2,
  attemptsAllowed: 3,
  score: 8,
  totalPossible: 10,
  percentage: 80,
  passed: true,
  passingScore: 70,
};

beforeEach(() => {
  vi.restoreAllMocks();
  recordAndEnqueue.mockReset();
  recordAndEnqueue.mockResolvedValue({
    ok: true,
    notificationId: 5,
    dedupeKey: "notification_email:quiz_submitted:41",
    enqueued: true,
  });
});

describe("quiz_submitted — the message a student receives", () => {
  it("states the score, the attempt number and what is left", async () => {
    const result = await notifyQuizSubmitted(
      QUIZ_EVENT,
      fakeClient([USER, NO_PREFERENCE_ROW, [{ title: "Week 2 quiz" }]]),
    );

    expect(result.ok).toBe(true);
    const input = recordAndEnqueue.mock.calls[0][0];
    expect(input.subject).toBe('You passed "Week 2 quiz" (80%)');
    expect(input.body).toContain("attempt 2 of 3");
    expect(input.body).toContain("Score: 8 / 10 (80%)");
    expect(input.body).toContain("https://lms.example.test/quizzes/2");
    expect(input).toMatchObject({
      userId: 7,
      type: "quiz_submitted",
      dedupeKey: "notification_email:quiz_submitted:41",
      recipientEmail: "student@codequeenshub.test",
      preferenceAlreadyChecked: true,
      metadata: { quizId: 3, attemptId: 41, weekId: 2, url: "/quizzes/2" },
    });
  });

  it("tells a failing student how many attempts remain, and that the best counts", async () => {
    await notifyQuizSubmitted(
      { ...QUIZ_EVENT, passed: false, percentage: 40, score: 4, attemptNumber: 1 },
      fakeClient([USER, NO_PREFERENCE_ROW, [{ title: "Week 2 quiz" }]]),
    );
    const body = recordAndEnqueue.mock.calls[0][0].body as string;
    expect(recordAndEnqueue.mock.calls[0][0].subject).toBe('Your "Week 2 quiz" attempt scored 40%');
    expect(body).toContain("2 attempts left");
    expect(body).toContain("BEST attempt");
  });

  it("still notifies when the quiz row has been deleted", async () => {
    // The score and the link are still true; losing the notification because a title
    // is missing would be the wrong trade.
    await notifyQuizSubmitted(QUIZ_EVENT, fakeClient([USER, NO_PREFERENCE_ROW, []]));
    expect(recordAndEnqueue).toHaveBeenCalledTimes(1);
    expect(recordAndEnqueue.mock.calls[0][0].subject).toContain("your quiz");
  });

  it("does not render or record anything for an opted-out student", async () => {
    const result = await notifyQuizSubmitted(
      QUIZ_EVENT,
      fakeClient([USER, [{ ...PREFERENCE_DEFAULTS, quizSubmitted: false }]]),
    );
    expect(result).toEqual({ ok: false, reason: "suppressed_by_preference" });
    expect(recordAndEnqueue).not.toHaveBeenCalled();
  });

  it("reports no_recipient when the user row is gone", async () => {
    const result = await notifyQuizSubmitted(QUIZ_EVENT, fakeClient([[]]));
    expect(result).toEqual({ ok: false, reason: "no_recipient" });
    expect(recordAndEnqueue).not.toHaveBeenCalled();
  });

  it("reports no_recipient when the account has no email address", async () => {
    const result = await notifyQuizSubmitted(
      QUIZ_EVENT,
      fakeClient([[{ name: "Demo", email: "   " }]]),
    );
    expect(result).toEqual({ ok: false, reason: "no_recipient" });
  });

  it("never throws — a notification failure must not fail the quiz submit", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding = {
      select: () => {
        throw new Error("pool exhausted");
      },
    } as never;
    const result = await notifyQuizSubmitted(QUIZ_EVENT, exploding);
    expect(result).toEqual({ ok: false, reason: "record_failed" });
    expect(String(spy.mock.calls[0][0])).toContain("The underlying event IS saved");
  });
});

describe("exam_completed", () => {
  const EXAM_EVENT = {
    studentId: 7,
    attemptId: 12,
    quizId: 9,
    weekId: 4,
    score: 30,
    totalPossible: 40,
    percentage: 75,
    passed: true,
    passingScore: 70,
    autoSubmitted: true,
  };

  it("says out loud that the deadline closed the attempt", async () => {
    await notifyExamCompleted(
      EXAM_EVENT,
      fakeClient([USER, NO_PREFERENCE_ROW, [{ title: "Week 4 exam", weekNumber: 4 }]]),
    );
    const input = recordAndEnqueue.mock.calls[0][0];
    expect(input.dedupeKey).toBe("notification_email:exam_completed:12");
    expect(input.subject).toBe('Your "Week 4 exam" exam is complete — 75%');
    expect(input.body).toContain("submitted automatically when the time limit ran out");
    expect(input.body).toContain("ONE attempt");
    expect(input.body).toContain("https://lms.example.test/exams/4");
  });

  it("says the student submitted it themselves otherwise", async () => {
    await notifyExamCompleted(
      { ...EXAM_EVENT, autoSubmitted: false },
      fakeClient([USER, NO_PREFERENCE_ROW, [{ title: "Week 4 exam", weekNumber: 4 }]]),
    );
    expect(recordAndEnqueue.mock.calls[0][0].body).toContain("submitted by you");
  });

  it("respects its own switch, not the quiz one", async () => {
    const result = await notifyExamCompleted(
      EXAM_EVENT,
      fakeClient([USER, [{ ...PREFERENCE_DEFAULTS, examCompleted: false, quizSubmitted: true }]]),
    );
    expect(result).toEqual({ ok: false, reason: "suppressed_by_preference" });
  });
});

describe("penalty_issued", () => {
  const PENALTY_EVENT = {
    studentId: 7,
    penaltyId: 88,
    type: "late_submission",
    severity: "notice",
    description: "Submitted 2 days after the deadline.",
    penaltyPoints: 5,
  };

  it("uses the human label, keeps the severity out of the subject, and quotes the detail", async () => {
    await notifyPenaltyIssued(PENALTY_EVENT, fakeClient([USER, NO_PREFERENCE_ROW]));
    const input = recordAndEnqueue.mock.calls[0][0];
    expect(input.dedupeKey).toBe("notification_email:penalty_issued:88");
    expect(input.subject).toContain("late submission record");
    expect(input.subject).not.toContain("notice");
    expect(input.body).toContain("Points deducted: 5");
    expect(input.body).toContain("Submitted 2 days after the deadline.");
    expect(input.body).toContain("records can be resolved");
  });

  it("says explicitly when nothing was deducted", async () => {
    await notifyPenaltyIssued(
      { ...PENALTY_EVENT, penaltyPoints: 0 },
      fakeClient([USER, NO_PREFERENCE_ROW]),
    );
    expect(recordAndEnqueue.mock.calls[0][0].body).toContain("No points were deducted");
  });

  it("falls back to a neutral label for an unknown penalty type", async () => {
    await notifyPenaltyIssued(
      { ...PENALTY_EVENT, type: "something_new" },
      fakeClient([USER, NO_PREFERENCE_ROW]),
    );
    expect(recordAndEnqueue.mock.calls[0][0].subject).toContain("penalty record");
  });

  it("cannot be used to inject a header via the penalty description", async () => {
    // The description is instructor free text and reaches a subject only through the
    // label; the body carries it. A CR/LF must not survive into anything header-like.
    await notifyPenaltyIssued(
      { ...PENALTY_EVENT, description: "line one\r\nBcc: attacker@example.test" },
      fakeClient([USER, NO_PREFERENCE_ROW]),
    );
    const input = recordAndEnqueue.mock.calls[0][0];
    expect(input.subject).not.toContain("Bcc:");
    // In the BODY a newline is just text — the body is not a header — so it is
    // preserved rather than mangled, which is correct.
    expect(input.body).toContain("Bcc: attacker@example.test");
  });
});
