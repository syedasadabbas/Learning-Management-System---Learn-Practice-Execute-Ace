// =============================================================================
// E2E — the grand quiz: one attempt, server-authoritative time, idempotent submit.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Authored, typechecked and lint-clean, handed to the
// coordinator who runs the suite serially at integration. Reason: this file
// consumes the demo student's ONE AND ONLY attempt at a grand quiz, and I1 means
// it cannot be given back through any UI. A second run without a reseed reaches a
// terminal attempt and every case after the first asserts the wrong thing.
//
// WHAT THESE CASES ADD OVER THE 143 UNIT TESTS
//
// The unit tests replace `./queries.ts` with an in-memory store that MIMICS the
// two database behaviours the invariants rest on — the unique index for I1 and
// `SELECT ... FOR UPDATE` for I3. They cannot prove the real SQL has those
// semantics. That is precisely what this file proves, and it is the reason both
// exist:
//
//   * two concurrent POSTs to /start against real Postgres yield ONE row;
//   * two concurrent POSTs to /submit against real Postgres yield ONE result;
//   * `deadline_at` really is written once and never updated;
//   * the answer key really is absent from the wire payload.
//
// PRECONDITIONS — state these to the coordinator before running:
//
//   1. A GRAND QUIZ MUST EXIST. `quizzes.kind = 'grand'` with questions, for some
//      week the demo student has unlocked. Nothing seeds one yet: the
//      curriculum-content stream authors the four 50-question exams. Until then
//      EVERY test here SKIPS rather than fails — see `resolveExamWeek` below. A
//      skipped suite is honest; a suite that fails because content is absent
//      trains people to ignore red.
//   2. FRESH SEED. One attempt, consumed. `npm run db:seed` before each run.
//   3. SERIAL, CHROMIUM ONLY. playwright.config already sets `workers: 1` and
//      `fullyParallel: false`; the non-chromium project is skipped here because it
//      would find the attempt already spent.
//   4. CRON_SECRET must be set for the sweeper case, which otherwise asserts the
//      fail-closed 503 instead.
//
// Timeouts and durations in milliseconds (house rule 5).
// =============================================================================

import { expect, test, type APIRequestContext } from "@playwright/test";

import { QUIZ_PASS_PERCENT } from "../../../src/lib/contracts/scoring";
import { loginAs, SEEDED } from "../fixtures";

// ---------------------------------------------------------------------------
// Wire shapes — deliberately restated here rather than imported.
// ---------------------------------------------------------------------------
// Importing `ExamResult` would make these assertions tautological: the test would
// agree with the server because both read one type. Restating what the BROWSER is
// promised means a field the server stops sending fails here.

interface ExamOptionWire {
  id: number;
  optionText: string;
  orderIndex: number;
}

interface ExamQuestionWire {
  id: number;
  questionText: string;
  type: string;
  orderIndex: number;
  points: number;
  language: string | null;
  starterCode: string | null;
  options: ExamOptionWire[];
}

interface ExamViewWire {
  state: "not_started" | "in_progress" | "finished";
  quiz?: { id: number; title: string; totalPoints: number; timeLimitMinutes: number };
  exam?: {
    quiz: { id: number; weekId: number; totalPoints: number; timeLimitMinutes: number };
    attempt: {
      id: number;
      status: string;
      countdown: {
        deadlineAtMs: number | null;
        serverNowMs: number;
        remainingMs: number | null;
        expired: boolean;
      };
    };
    questions: ExamQuestionWire[];
    saved: { questionId: number; selectedOptionId: number | null; codeAnswer: string | null }[];
  };
  result?: ExamResultWire;
}

interface ExamResultWire {
  attemptId: number;
  score: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  status: string;
  deferredCount: number;
  provisional: boolean;
  provisionalCeiling: number;
  unansweredCount: number;
  autoSubmitted: boolean;
  replayed: boolean;
  answers: {
    questionId: number;
    questionText: string;
    awarded: number;
    maxPoints: number;
    deferred: boolean;
    unanswered: boolean;
  }[];
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a week whose grand quiz the demo student can sit, or null.
 *
 * Walks the seeded weeks and asks the exam page's own API. Returns null when no
 * `kind = 'grand'` quiz exists anywhere, which is the state until
 * curriculum-content lands — every test then skips.
 */
async function resolveExamWeek(request: APIRequestContext): Promise<number | null> {
  // Week ids are serial values reassigned by every reseed, so they are resolved
  // through the API rather than assumed to equal the week number.
  const response = await request.get("/api/me/progress");
  if (!response.ok()) return null;
  const body = (await response.json()) as {
    ok: boolean;
    data?: { weeks?: { weekId: number; weekNumber: number; unlocked?: boolean }[] };
  };
  const candidates = (body.data?.weeks ?? []).slice(0, SEEDED.weekCount);

  for (const week of candidates) {
    // A GET of the exam page's API surface is the cheapest existence probe that
    // does not create anything: `loadExamOverview` behind /exams/:weekId reads.
    const probe = await request.get(`/exams/${week.weekId}`);
    if (probe.status() === 200) return week.weekId;
  }
  return null;
}

/** Start (or resume) the attempt. Idempotent by I1, so calling it twice is safe. */
async function startAttempt(
  request: APIRequestContext,
  weekId: number,
): Promise<Envelope<ExamViewWire>> {
  const response = await request.post(`/api/exams/${weekId}/start`);
  return (await response.json()) as Envelope<ExamViewWire>;
}

async function readAttempt(
  request: APIRequestContext,
  attemptId: number,
): Promise<Envelope<ExamViewWire>> {
  const response = await request.get(`/api/exams/${attemptId}`);
  return (await response.json()) as Envelope<ExamViewWire>;
}

/** Every key present anywhere in a JSON value, at any depth. */
function allKeys(value: unknown, into: Set<string> = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allKeys(entry, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      allKeys(nested, into);
    }
  }
  return into;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

test.describe.serial("Grand quiz — invariants I1 to I6 against a real database", () => {
  let weekId: number;
  let attemptId: number;
  let questions: ExamQuestionWire[] = [];
  let deadlineAtMs: number | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    // Precondition 3: the mobile-chrome project would find the one attempt spent.
    test.skip(
      testInfo.project.name !== "chromium",
      "One attempt only (I1): a second project would find it already used.",
    );

    await loginAs(page, "student");

    const resolved = await resolveExamWeek(request);
    test.skip(
      resolved === null,
      "No quizzes.kind='grand' row exists yet — curriculum-content seeds the four " +
        "50-question exams. Skipping is deliberate: failing here would be a content " +
        "gap reported as a code defect.",
    );
    weekId = resolved as number;
  });

  // =========================================================================
  // I1 — one attempt, ever
  // =========================================================================

  test("I1: two CONCURRENT starts yield one attempt and the same attempt id", async ({
    request,
  }) => {
    // Fired together, so both hit the UNIQUE (student_id, quiz_id, attempt_number)
    // index at once. Exactly one INSERT commits; the loser gets SQLSTATE 23505 and
    // is handed the winner's row. A read-then-write count would let both through.
    const [first, second] = await Promise.all([
      startAttempt(request, weekId),
      startAttempt(request, weekId),
    ]);

    expect(first.ok, first.ok ? "" : `first start failed: ${first.error}`).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const firstId = first.data.exam?.attempt.id ?? first.data.result?.attemptId;
    const secondId = second.data.exam?.attempt.id ?? second.data.result?.attemptId;
    expect(firstId).toBeDefined();
    expect(secondId).toBe(firstId);

    attemptId = firstId as number;
    questions = first.data.exam?.questions ?? [];
    deadlineAtMs = first.data.exam?.attempt.countdown.deadlineAtMs ?? null;
  });

  test("I1: ten further starts are indistinguishable from one", async ({ request }) => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => startAttempt(request, weekId)),
    );
    const ids = new Set(
      results.map((result) =>
        result.ok ? result.data.exam?.attempt.id ?? result.data.result?.attemptId : -1,
      ),
    );
    expect(ids.size).toBe(1);
    expect(ids.has(attemptId)).toBe(true);
  });

  // =========================================================================
  // I2 — server-authoritative time
  // =========================================================================

  test("I2: deadline_at is start + the stored limit, and is never rewritten", async ({
    request,
  }) => {
    const view = await readAttempt(request, attemptId);
    expect(view.ok).toBe(true);
    if (!view.ok || !view.data.exam) return;

    const countdown = view.data.exam.attempt.countdown;
    expect(countdown.deadlineAtMs).toBe(deadlineAtMs);
    expect(countdown.remainingMs).not.toBeNull();
    expect(countdown.remainingMs as number).toBeGreaterThan(0);
    // The window is exactly the quiz's own limit — no more, and not restarted.
    const limitMs = view.data.exam.quiz.timeLimitMinutes * 60_000;
    expect(countdown.remainingMs as number).toBeLessThanOrEqual(limitMs);

    // Read it again: the deadline must be the SAME instant, not pushed forward.
    const again = await readAttempt(request, attemptId);
    expect(again.ok && again.data.exam?.attempt.countdown.deadlineAtMs).toBe(deadlineAtMs);
    // And the remaining time must have gone DOWN, never up.
    const laterRemaining = again.ok ? again.data.exam?.attempt.countdown.remainingMs : null;
    expect(laterRemaining as number).toBeLessThanOrEqual(countdown.remainingMs as number);
  });

  test("I2: the response carries the server clock, and no field to send one back", async ({
    request,
  }) => {
    const view = await readAttempt(request, attemptId);
    // Asserted, not narrowed-and-returned (qa-hardening): the bare `if (…) return`
    // that used to stand here made this the one I2 test that reported green when
    // GET /api/exams/:id failed outright, having asserted nothing at all.
    expect(view.ok, "GET /api/exams/:attemptId must succeed").toBe(true);
    expect(view.ok && view.data.exam, "the attempt must still be in progress").toBeTruthy();
    if (!view.ok || !view.data.exam) return;
    const countdown = view.data.exam.attempt.countdown;

    // The browser corrects its own skew from this rather than trusting Date.now().
    expect(typeof countdown.serverNowMs).toBe("number");
    expect(Object.keys(countdown).sort()).toEqual([
      "deadlineAtMs",
      "expired",
      "remainingMs",
      "serverNowMs",
    ]);
  });

  test("I2: a forged remainingMs in the request body changes nothing", async ({ request }) => {
    // The schema has no timing field, so this is silently ignored rather than
    // honoured. The assertion is that the exam is still open with a server-derived
    // countdown afterwards.
    const response = await request.post(`/api/exams/${attemptId}/answer`, {
      data: {
        questionId: questions[0]?.id ?? 1,
        selectedOptionId: questions[0]?.options[0]?.id ?? null,
        // Not part of examAnswerSchema. Present here precisely to prove it is inert.
        remainingMs: 999_999_999,
        deadlineAt: "2099-01-01T00:00:00.000Z",
      },
    });
    expect([200, 400, 409]).toContain(response.status());

    const view = await readAttempt(request, attemptId);
    expect(view.ok && view.data.exam?.attempt.countdown.deadlineAtMs).toBe(deadlineAtMs);
  });

  // =========================================================================
  // The answer-key barrier
  // =========================================================================

  test("no answer key, no hidden tests, on the wire before submit", async ({ request }) => {
    const response = await request.get(`/api/exams/${attemptId}`);
    const raw = await response.text();
    const keys = allKeys(JSON.parse(raw) as unknown);

    // Absent, not merely undefined — this is the real serialised body.
    expect(keys.has("isCorrect")).toBe(false);
    expect(keys.has("explanation")).toBe(false);
    expect(keys.has("tests")).toBe(false);
    // And nothing named like a key slipped through under another spelling.
    expect(raw).not.toContain("is_correct");
    expect(raw).not.toContain("\"expected\"");
  });

  // =========================================================================
  // Autosave, then I4/I5/I6 at submit
  // =========================================================================

  test("autosave stores answers and survives a reload", async ({ request }) => {
    const answerable = questions.filter((question) => question.options.length > 0).slice(0, 12);
    expect(answerable.length).toBeGreaterThan(0);

    for (const question of answerable) {
      const response = await request.post(`/api/exams/${attemptId}/answer`, {
        data: { questionId: question.id, selectedOptionId: question.options[0]?.id },
      });
      expect(response.status(), `autosave for question ${question.id}`).toBe(200);
    }

    const view = await readAttempt(request, attemptId);
    // Asserted rather than silently returned (qa-hardening) — a failing read used
    // to drop the two assertions below and still pass.
    expect(view.ok, "GET /api/exams/:attemptId must succeed").toBe(true);
    expect(view.ok && view.data.exam, "the attempt must still be in progress").toBeTruthy();
    if (!view.ok || !view.data.exam) return;
    // The saved work comes back, so a closed tab loses nothing.
    expect(view.data.exam.saved.length).toBeGreaterThanOrEqual(answerable.length);
    // And nothing was scored during the exam — a student cannot poll for
    // correctness by watching an awarded value change.
    const keys = allKeys(view.data.exam.saved);
    expect(keys.has("awarded")).toBe(false);
  });

  test("an option belonging to another question is refused", async ({ request }) => {
    const target = questions.find((question) => question.options.length > 0);
    const other = questions.find(
      (question) => question.id !== target?.id && question.options.length > 0,
    );
    test.skip(!target || !other, "Needs two option-keyed questions.");

    const response = await request.post(`/api/exams/${attemptId}/answer`, {
      data: { questionId: target?.id, selectedOptionId: other?.options[0]?.id },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as Envelope<unknown>;
    expect(body.ok).toBe(false);
    expect(!body.ok && body.code).toBe("option_not_in_question");
  });

  test("I3+I4+I5+I6: two CONCURRENT submits give one result and identical bodies", async ({
    request,
  }) => {
    // Fired together against real Postgres, so both reach `SELECT ... FOR UPDATE`
    // on the attempt row. One scores; the other blocks, sees the terminal status,
    // and replays. This is the case the in-memory unit test can only mimic.
    const [first, second] = await Promise.all([
      request.post(`/api/exams/${attemptId}/submit`, { data: { autoSubmitted: false } }),
      request.post(`/api/exams/${attemptId}/submit`, { data: { autoSubmitted: false } }),
    ]);

    // BOTH answer 200. A 409 for the loser would show an error over a perfectly
    // good exam at the end of two hours.
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);

    const firstBody = (await first.json()) as Envelope<ExamResultWire>;
    const secondBody = (await second.json()) as Envelope<ExamResultWire>;
    expect(firstBody.ok && secondBody.ok).toBe(true);
    if (!firstBody.ok || !secondBody.ok) return;

    const a = firstBody.data;
    const b = secondBody.data;

    // I3 — one result. Same attempt, same numbers, one of them a replay.
    expect(b.attemptId).toBe(a.attemptId);
    expect(b.score).toBe(a.score);
    expect(b.totalPossible).toBe(a.totalPossible);
    expect(b.percentage).toBe(a.percentage);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);

    // I4 — one answer entry per question in the quiz, not per answer given.
    expect(a.answers).toHaveLength(questions.length);
    const blank = a.answers.filter((answer) => answer.unanswered);
    for (const answer of blank) expect(answer.awarded).toBe(0);
    expect(a.unansweredCount).toBe(blank.length);

    // I5 — every award inside [0, maxPoints], and the score is their SUM.
    for (const answer of a.answers) {
      expect(answer.awarded).toBeGreaterThanOrEqual(0);
      expect(answer.awarded).toBeLessThanOrEqual(answer.maxPoints);
    }
    expect(a.answers.reduce((total, answer) => total + answer.awarded, 0)).toBe(a.score);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(a.totalPossible);

    // I6 — a score exists, and provisional iff something is deferred.
    expect(typeof a.score).toBe("number");
    expect(a.provisional).toBe(a.deferredCount > 0);
    expect(a.provisionalCeiling).toBeGreaterThanOrEqual(a.score);
    expect(a.status).toBe(a.deferredCount > 0 ? "submitted" : "graded");
    expect(a.passed).toBe(a.percentage >= QUIZ_PASS_PERCENT);
  });

  test("I3: an autosave arriving after submit is refused and the score does not move", async ({
    request,
  }) => {
    const before = await readAttempt(request, attemptId);
    const scoreBefore = before.ok ? before.data.result?.score : undefined;
    expect(scoreBefore).toBeDefined();

    const target = questions.find((question) => question.options.length > 0);
    const response = await request.post(`/api/exams/${attemptId}/answer`, {
      data: { questionId: target?.id, selectedOptionId: target?.options[0]?.id },
    });
    expect(response.status()).toBe(409);
    const body = (await response.json()) as Envelope<unknown>;
    expect(!body.ok && body.code).toBe("attempt_terminal");

    const after = await readAttempt(request, attemptId);
    expect(after.ok && after.data.result?.score).toBe(scoreBefore);
  });

  test("I1: starting again after submitting returns the SAME finished attempt", async ({
    request,
  }) => {
    const restart = await startAttempt(request, weekId);
    expect(restart.ok).toBe(true);
    if (!restart.ok) return;
    // No second sitting. The finished result comes back instead.
    expect(restart.data.state).toBe("finished");
    expect(restart.data.result?.attemptId).toBe(attemptId);
    expect(restart.data.exam).toBeUndefined();
  });

  // =========================================================================
  // The page renders the result (I6's visible half)
  // =========================================================================

  test("the exam page shows a score, never a blank 'we will be in touch'", async ({ page }) => {
    await page.goto(`/exams/${weekId}`);
    const results = page.getByTestId("exam-results");
    await expect(results).toBeVisible();
    // A number is on screen.
    await expect(page.getByTestId("exam-score")).toContainText("/");
    // Exactly one of the two notes, and the provisional one states the direction.
    const provisional = page.getByTestId("exam-provisional-note");
    const final = page.getByTestId("exam-final-note");
    const provisionalCount = await provisional.count();
    if (provisionalCount > 0) {
      await expect(provisional).toContainText(/can only go up/i);
    } else {
      await expect(final).toBeVisible();
    }
  });
});

// ===========================================================================
// Authorization — separate describe: no exam content needed, so it never skips
// ===========================================================================

test.describe("Grand quiz — authorization", () => {
  test("the exam API refuses an anonymous caller", async ({ request }) => {
    // No session. Both the edge middleware and apiGuard("student") reject.
    const response = await request.post("/api/exams/1/start");
    expect([401, 403, 307]).toContain(response.status());
  });

  test("a student cannot read another student's attempt", async ({ page }) => {
    await loginAs(page, "student");
    // MUST be `page.request`, not the `request` fixture. The `request` fixture is
    // a SEPARATE context with its own empty cookie jar, so it arrives with no
    // session and is refused 401 before the ownership check is ever reached —
    // which made this assertion unreachable and the test a permanent failure.
    // `page.request` shares the cookies that loginAs just established.
    //
    // `student_id` is in the WHERE clause, so an unowned id is 404 — not 403,
    // which would confirm the attempt exists.
    const response = await page.request.get("/api/exams/999999");
    expect(response.status()).toBe(404);
  });

  test("the cron sweeper refuses a browser session even with a valid token", async ({
    page,
    request,
  }) => {
    await loginAs(page, "student");
    const secret = process.env.CRON_SECRET;
    const response = await request.post("/api/cron/finalize-exams", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
    // 403 cron_only when the cookie is present; 401 without a valid secret; 503
    // when CRON_SECRET is unset — all three are the guard working, and none is 200.
    expect([401, 403, 503]).toContain(response.status());
    expect(response.status()).not.toBe(200);
  });

  test("the cron sweeper refuses an unauthenticated caller", async ({ request }) => {
    const response = await request.post("/api/cron/finalize-exams");
    expect([401, 503]).toContain(response.status());
  });

  test("the cron sweeper accepts the bearer token and reports a sweep", async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET is not set; the fail-closed 503 case covers that state.");

    const response = await request.post("/api/cron/finalize-exams", {
      headers: { authorization: `Bearer ${secret as string}` },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as Envelope<{
      examined: number;
      finalized: number;
      alreadyClosed: number;
      failed: unknown[];
      durationMs: number;
    }>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    // `examined: 0` is the normal, healthy state — nothing was abandoned.
    expect(body.data.examined).toBeGreaterThanOrEqual(0);
    expect(body.data.failed).toEqual([]);
    expect(body.data.durationMs).toBeGreaterThanOrEqual(0);
  });
});
