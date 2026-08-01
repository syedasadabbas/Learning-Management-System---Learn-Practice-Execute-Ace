// =============================================================================
// CONSUMER TESTS — the failure CLASSIFICATION, which is where the value is.
// -----------------------------------------------------------------------------
// The interesting behaviour of this handler is not "it sends an email". It is
// which failures it declares PERMANENT (dead-lettered on the first attempt, no
// retries) and which it declares TRANSIENT (retried with backoff). Getting that
// backwards produces either a job that retries a deleted submission five times
// before giving up, or an email lost to a relay hiccup with no second attempt.
//
// The database and the mailer are both mocked. `@/db` is mocked with a factory
// so the real module — which throws at import time when DATABASE_URL is unset,
// and opens a connection pool when it is — is never evaluated in a unit test.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks, declared before the module under test is imported.
// ---------------------------------------------------------------------------

/** The single row the mocked query chain will return, or nothing. */
let queryRows: unknown[] = [];

vi.mock("@/db", () => {
  // A chainable stub shaped like the drizzle select builder the handler uses:
  // .select().from().innerJoin().innerJoin().innerJoin().where().limit()
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "innerJoin", "leftJoin", "where"]) {
    chain[method] = () => chain;
  }
  chain.limit = async () => queryRows;
  return { db: chain };
});

const sendMock = vi.fn();

vi.mock("@/lib/mail", async (importOriginal) => {
  // The TEMPLATE is deliberately NOT mocked — a test that stubs the renderer
  // proves nothing about the message a student would actually receive.
  const actual = await importOriginal<typeof import("@/lib/mail")>();
  return { ...actual, appOrigin: () => "https://lms.example.test" };
});

/** Records what `sendDeduplicated` was asked to de-duplicate on. */
const dedupeKeys: string[] = [];

vi.mock("@/lib/mail/dispatch", async (importOriginal) => {
  // MOCKED AT THE DISPATCH SEAM, NOT AT THE TRANSPORT, because the transport is no
  // longer what this handler talks to — it hands a message and a dedupe key to the
  // ledger and classifies what comes back (see ./submission-graded-email.ts).
  //
  // The stub DELEGATES to `sendMock` and translates a MailResult into the two
  // DispatchOutcome branches that a working ledger produces for that result. That
  // keeps every message-content and failure-classification assertion below reading
  // the message the transport would have received, while the four branches a
  // transport cannot produce (already_sent, resent_after_unknown,
  // unknown_exhausted, ledger_unavailable) are asserted directly against the
  // exported `classifyDispatch`, which is where their logic lives.
  const actual = await importOriginal<typeof import("@/lib/mail/dispatch")>();
  return {
    ...actual,
    sendDeduplicated: async (input: { dedupeKey: string; message: Record<string, unknown> }) => {
      dedupeKeys.push(input.dedupeKey);
      const messageId = `<test-${input.dedupeKey}@lms.example.test>`;
      const result = await sendMock({ ...input.message, messageId });
      return result.ok
        ? { status: "sent", transport: result.transport, messageId, attempts: 1 }
        : {
            status: "failed",
            transport: result.transport,
            reason: result.reason,
            detail: result.detail,
            attempts: 1,
          };
    },
  };
});

import { INDETERMINATE_RESEND_LIMIT, type DispatchOutcome } from "@/lib/mail/dispatch";

import {
  GRADED_AT_TOLERANCE_MS,
  classifyDispatch,
  handleSubmissionGradedEmail,
  parseGradedEmailPayload,
} from "./submission-graded-email";
import type { JobRecord } from "../types";

const GRADED_AT = new Date("2026-07-31T09:00:00.000Z");

function job(payload: unknown): JobRecord {
  const t = new Date(0);
  return {
    id: 1,
    kind: "submission_graded_email",
    idempotencyKey: "submission_graded_email:1:1",
    payload,
    status: "running",
    attempts: 1,
    maxAttempts: 5,
    runAfter: t,
    leaseExpiresAt: null,
    lockedBy: "w",
    lastError: null,
    createdAt: t,
    updatedAt: t,
    completedAt: null,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: 1,
    score: 36,
    feedback: "Solid work on the flexbox layout.",
    stars: 4,
    status: "graded",
    gradedAt: GRADED_AT,
    studentName: "Demo Student",
    studentEmail: "student@codequeenshub.test",
    assignmentTitle: "Week 2 — Responsive Layout",
    weekId: 2,
    ...overrides,
  };
}

const goodPayload = { submissionId: 1, gradedAtMs: GRADED_AT.getTime() };

beforeEach(() => {
  queryRows = [row()];
  dedupeKeys.length = 0;
  sendMock.mockReset();
  sendMock.mockResolvedValue({ ok: true, transport: "dev" });
});

// ---------------------------------------------------------------------------

describe("parseGradedEmailPayload", () => {
  it("accepts the shape the producer writes", () => {
    expect(parseGradedEmailPayload(goodPayload)).toEqual(goodPayload);
  });

  it("rejects anything else, so a malformed row is classified rather than crashing", () => {
    for (const bad of [null, undefined, 7, "x", {}, { submissionId: 0, gradedAtMs: 1 }, { submissionId: 1 }, { submissionId: 1.5, gradedAtMs: 1 }]) {
      expect(parseGradedEmailPayload(bad)).toBeNull();
    }
  });
});

describe("permanent failures — dead-lettered on the first attempt", () => {
  it("a malformed payload", async () => {
    // Will never become well-formed by waiting. Retrying it four more times only
    // delays the moment it appears on the dead-letter list.
    const outcome = await handleSubmissionGradedEmail(job({ nope: true }));
    expect(outcome.status).toBe("dead");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a submission that no longer exists", async () => {
    queryRows = [];
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("dead");
    if (outcome.status === "dead") expect(outcome.error).toContain("no longer exists");
  });

  it("a submission whose grade was withdrawn", async () => {
    queryRows = [row({ gradedAt: null })];
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("dead");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a student with no email address", async () => {
    queryRows = [row({ studentEmail: "   " })];
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("dead");
    if (outcome.status === "dead") expect(outcome.error).toContain("no email address");
  });
});

describe("transient failures — retried with backoff", () => {
  it("a transport that reports send_failed", async () => {
    sendMock.mockResolvedValue({
      ok: false,
      transport: "smtp",
      reason: "send_failed",
      detail: "421 4.7.0 Try again later",
    });
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("retry");
    if (outcome.status === "retry") expect(outcome.error).toContain("421");
  });

  it("a transport that is unavailable", async () => {
    // `transport_unavailable` usually means a dependency or configuration a
    // redeploy fixes, so it is worth another attempt rather than a dead letter.
    sendMock.mockResolvedValue({
      ok: false,
      transport: "smtp",
      reason: "transport_unavailable",
      detail: "nodemailer is not installed",
    });
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("retry");
  });
});

describe("the supersede guard — a regrade must not produce a stale email", () => {
  it("succeeds WITHOUT sending when graded_at has moved past the tolerance", async () => {
    // A second job already exists for the new grade (different idempotency key),
    // so this one is obsolete. Reported as succeeded, not failed: nothing went
    // wrong, and dead-lettering it would put a non-problem on the operator's list.
    queryRows = [row({ gradedAt: new Date(GRADED_AT.getTime() + 60_000) })];
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") expect(outcome.detail).toContain("Superseded");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("STILL SENDS within the tolerance window", async () => {
    // The tolerance is not cosmetic. Postgres keeps microseconds and a JS Date
    // keeps milliseconds; a strict equality check would classify every
    // notification as superseded and the queue would silently send nothing while
    // looking perfectly healthy.
    queryRows = [row({ gradedAt: new Date(GRADED_AT.getTime() + GRADED_AT_TOLERANCE_MS - 1) })];
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("succeeded");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("the message a student actually receives", () => {
  it("carries the score, the rating and a link to the week's assignment", async () => {
    await handleSubmissionGradedEmail(job(goodPayload));
    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];

    expect(message.to).toBe("student@codequeenshub.test");
    expect(message.subject).toContain("Week 2 — Responsive Layout");
    expect(message.text).toContain("36 / 40");
    expect(message.text).toContain("Solid work on the flexbox layout.");
    // Deep-links to the student's own view, from configured origin — never from
    // a request Host header (see appOrigin in src/lib/mail/index.ts).
    expect(message.text).toContain("https://lms.example.test/assignments/2");
  });

  it("renders a null rating as zero stars rather than NaN", async () => {
    // `instructor_rating` is nullable in the schema even though the grade path
    // always writes it, and the template repeats the value as a star string.
    queryRows = [row({ stars: null, score: null })];
    const outcome = await handleSubmissionGradedEmail(job(goodPayload));
    expect(outcome.status).toBe("succeeded");
    const message = sendMock.mock.calls[0][0];
    expect(message.text).not.toContain("NaN");
    expect(message.text).toContain("0 / 40");
  });

  it("escapes instructor-authored HTML instead of rendering it", async () => {
    // The feedback and the assignment title are the first genuinely untrusted
    // strings to reach mail markup in this app.
    queryRows = [
      row({
        feedback: '<img src=x onerror="alert(1)">',
        assignmentTitle: "<b>Week 2</b>",
      }),
    ];
    await handleSubmissionGradedEmail(job(goodPayload));
    const message = sendMock.mock.calls[0][0];

    // The assertion is about TAG BOUNDARIES, not about the substring "onerror".
    // A first pass here checked `not.toContain("onerror=")` and failed against
    // correctly-escaped output: the payload survives as the inert text
    // `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;`, which no mail client can
    // execute because there is no `<` to open a tag. Asserting on the angle
    // brackets is the property that actually matters.
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(message.html).toContain("&lt;b&gt;Week 2&lt;/b&gt;");

    // Only the markup this template itself emits may contain a real tag; every
    // tag in the output must be one of ours.
    const tags = [...message.html.matchAll(/<\/?([a-zA-Z]+)/g)].map((m) => m[1].toLowerCase());
    expect(new Set(tags)).toEqual(new Set(["p", "strong", "br", "blockquote", "a"]));
  });

  it("strips CR/LF from the subject, which is a header-injection vector", async () => {
    queryRows = [row({ assignmentTitle: "Week 2\r\nBcc: attacker@example.com" })];
    await handleSubmissionGradedEmail(job(goodPayload));
    const message = sendMock.mock.calls[0][0];
    expect(message.subject).not.toMatch(/[\r\n]/);
  });
});

// ---------------------------------------------------------------------------
// THE DE-DUPLICATION SEAM. The queue guarantees one JOB per grading moment; it
// does not guarantee one RUN per job, so this handler must not be the thing that
// turns a legitimate reclaim into a second email.
// ---------------------------------------------------------------------------

describe("de-duplication is keyed on the job's own idempotency key", () => {
  it("passes jobs.idempotency_key through as the dedupe key, unmodified", async () => {
    // ONE STRING FOR BOTH GUARANTEES. If this handler derived its own key, then
    // `jobs_idempotency_key_idx` and `mail_dispatches_dedupe_key_idx` would be
    // two things to keep in step, and the failure of that would be silent: the
    // ledger would happily allow a send for every job row.
    await handleSubmissionGradedEmail(job(goodPayload));
    expect(dedupeKeys).toEqual(["submission_graded_email:1:1"]);
  });

  it("does not reach the ledger at all for a permanently-failed job", async () => {
    // A dead-lettered job must not leave a claimed-but-never-sent ledger row
    // behind: such a row reads as INDETERMINATE forever and is exactly the state
    // an operator would have to investigate by hand.
    queryRows = [];
    await handleSubmissionGradedEmail(job(goodPayload));
    expect(dedupeKeys).toEqual([]);
  });
});

describe("classifyDispatch — which dispatch outcomes may be retried", () => {
  // A TABLE, because the mapping is the whole substance: two of these six branches
  // mean "do not retry", and getting either wrong reintroduces the double-send that
  // src/lib/mail/dispatch.ts exists to close.
  const cases: Array<{ name: string; dispatch: DispatchOutcome; expected: string }> = [
    {
      name: "sent",
      dispatch: { status: "sent", transport: "smtp", messageId: "<a@b>", attempts: 1 },
      expected: "succeeded",
    },
    {
      name: "already_sent — a previous run of THIS job sent it; the work is done",
      dispatch: { status: "already_sent", messageId: "<a@b>", sentAtMs: 1 },
      expected: "succeeded",
    },
    {
      name: "resent_after_unknown — succeeded, and a duplicate is possible",
      dispatch: {
        status: "resent_after_unknown",
        transport: "smtp",
        messageId: "<a@b>",
        attempts: 2,
      },
      expected: "succeeded",
    },
    {
      name: "failed — a definite transport failure is worth another attempt",
      dispatch: { status: "failed", transport: "smtp", reason: "send_failed", attempts: 1 },
      expected: "retry",
    },
    {
      name: "ledger_unavailable — NOTHING was sent, so a retry cannot duplicate",
      dispatch: { status: "ledger_unavailable", error: "connection terminated" },
      expected: "retry",
    },
    {
      name: "unknown_exhausted — a human has to look; retrying is how copies multiply",
      dispatch: { status: "unknown_exhausted", attempts: 2, claimedAtMs: 1 },
      expected: "dead",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(classifyDispatch(c.dispatch, 7).status).toBe(c.expected);
    });
  }

  it("says out loud, in the detail, that a resend may have produced two copies", () => {
    // The queue reports success here. A reader of that success must not have to
    // guess that a duplicate is possible, so the wording is asserted rather than
    // left to whoever edits it next.
    const outcome = classifyDispatch(
      { status: "resent_after_unknown", transport: "smtp", messageId: "<x@y>", attempts: 2 },
      7,
    );
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.detail).toContain("MAY HAVE RECEIVED TWO COPIES");
      expect(outcome.detail).toContain("<x@y>");
    }
  });

  it("refuses to claim knowledge it does not have when the outcome is unknown", () => {
    const outcome = classifyDispatch(
      { status: "unknown_exhausted", attempts: INDETERMINATE_RESEND_LIMIT, claimedAtMs: 1 },
      7,
    );
    expect(outcome.status).toBe("dead");
    if (outcome.status === "dead") {
      // "It is NOT known" — not "failed to send", which would be a claim, and not
      // "sent", which would be a different one. The dead-letter list is read by a
      // human deciding whether to requeue, and the honest answer is the useful one.
      expect(outcome.error).toContain("NOT known whether the student received");
      expect(outcome.error).toContain("mail_dispatches");
    }
  });
});
