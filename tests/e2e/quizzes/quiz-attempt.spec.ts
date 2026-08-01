// =============================================================================
// E2E — take a quiz, get graded, unlock the next week. Owner: quizzes stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Authored, typechecked, and handed to the coordinator,
// who runs the suite serially at integration. Reason: the seeded demo student has
// a 3-attempt budget per quiz and it is global mutable state. Nine agents sharing
// port 3000 would interleave submits and make every assertion meaningless — and
// the attempts, once spent, cannot be given back through the UI.
//
// PRECONDITIONS (state them to the coordinator before running):
//
//   1. FRESH SEED. This file consumes ALL THREE Week 1 attempts for
//      student@codequeenshub.test, by design — the third case is "the 4th attempt
//      is refused". Re-running without `npm run db:seed` on a clean database will
//      fail at the first case with attempts_exhausted, which is correct
//      behaviour, not a regression.
//   2. SERIAL. `test.describe.serial` plus playwright.config's
//      `fullyParallel: false`. The order is load-bearing: FAIL first, then PASS,
//      then exhaustion. A pass cannot be undone (unlocking is deliberately
//      monotone), so the "stays locked" case must run before any pass.
//   3. CHROMIUM ONLY. playwright.config declares two projects (chromium and
//      mobile-chrome). Both would run this file and the second would find the
//      budget already spent, so the non-chromium projects are skipped here.
//
// Timeouts are milliseconds (house rule 5).
// =============================================================================

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { curriculum } from "../../../scripts/seed-content";
import { QUIZ_PASS_PERCENT, quizPointsFromPercent } from "../../../src/lib/contracts/scoring";
import { loginAs, SEEDED } from "../fixtures";

const WEEK_1 = curriculum[0];

type SubmitEnvelope = {
  ok: boolean;
  error?: string;
  code?: string;
  data?: {
    score: number;
    totalPossible: number;
    percentage: number;
    passed: boolean;
    attemptNumber: number;
    attemptsRemaining: number;
    bestPercent: number;
    quizPoints: number;
    unlockedWeekNumber: number | null;
    unlockedNow: boolean;
  };
};

test.describe.serial("Week 1 quiz — grading, unlocking, attempt limit", () => {
  let week1Id: number;
  let week2Id: number;
  let quizId: number;

  test.beforeEach(async ({ page }, testInfo) => {
    // Skip every non-chromium project: see precondition 3 above. Done here
    // rather than at describe scope because the project name is only reachable
    // through testInfo, which the describe-level skip callback is not given.
    test.skip(
      testInfo.project.name !== "chromium",
      "Attempt budget is global state; run this file in one project only.",
    );

    await loginAs(page, "student");
    const week1 = await resolveWeek(page.request, 0);
    const week2 = await resolveWeek(page.request, 1);
    week1Id = week1.weekId;
    week2Id = week2.weekId;
    if (week1.quizId === null) {
      throw new Error(
        "Week 1's quiz is not reachable. Week 1 is always unlocked, so this means " +
          "the seed is missing or incomplete — run `npm run db:seed`.",
      );
    }
    quizId = week1.quizId;
  });

  // -------------------------------------------------------------------------
  // Case 1 — all wrong. Records the attempt, does NOT unlock Week 2.
  // Runs FIRST because a pass cannot be reverted.
  // -------------------------------------------------------------------------
  test("all-wrong attempt is recorded, fails, and leaves Week 2 locked", async ({ page }) => {
    await page.goto(`/quizzes/${week1Id}`);
    await expect(page.getByTestId("quiz-form")).toBeVisible();

    const submitted = await answerAll(page, "wrong");
    expect(submitted).toBe(SEEDED.questionsPerQuiz);

    const body = await submitAndCapture(page, quizId);

    expect(body.ok).toBe(true);
    expect(body.data?.score).toBe(0);
    expect(body.data?.percentage).toBe(0);
    expect(body.data?.passed).toBe(false);
    expect(body.data?.attemptNumber).toBe(1);
    // Contract-driven rather than hardcoded: 0% earns nothing and unlocks nothing.
    expect(body.data?.quizPoints).toBe(quizPointsFromPercent(0));
    expect(body.data?.unlockedWeekNumber).toBeNull();
    expect(body.data?.unlockedNow).toBe(false);

    // Results view: fail badge, no unlock notice, and the attempt was counted.
    await expect(page.getByTestId("quiz-results")).toBeVisible();
    await expect(page.getByTestId("result-status")).toHaveText("FAIL");
    await expect(page.getByTestId("unlock-notice")).toHaveCount(0);
    await expect(page.getByTestId("attempts-remaining")).toHaveText(
      String(SEEDED.attemptsAllowed - 1),
    );

    // Explanations are revealed only after grading — every question has one.
    await expect(page.getByTestId("result-breakdown").locator("> li")).toHaveCount(
      SEEDED.questionsPerQuiz,
    );

    // Week 2 must still be locked. Asserted two ways: the quiz endpoint refuses
    // it outright (the guarantee sequential unlocking actually makes), and the
    // progress read model agrees when available (see isWeekUnlocked's TODO(test)).
    await expectQuizRefusedAsLocked(page.request, week2Id);

    const week2Unlocked = await isWeekUnlocked(page.request, week2Id);
    if (week2Unlocked !== null) expect(week2Unlocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Case 2 — all correct. Passes and unlocks Week 2 exactly once.
  // -------------------------------------------------------------------------
  // Renamed when subject sections landed: the quiz still PASSES and the unlock
  // event still fires and is recorded, but week 2 belongs to the CSS3 subject,
  // which appConfig.curriculumSections withholds — so the week does not become
  // readable. Both halves are asserted below, because they are separate
  // guarantees and a regression in either one matters.
  test("all-correct attempt passes and fires the unlock, but a withheld subject stays shut", async ({
    page,
  }) => {
    await page.goto(`/quizzes/${week1Id}`);
    await expect(page.getByTestId("quiz-form")).toBeVisible();

    const submitted = await answerAll(page, "correct");
    expect(submitted).toBe(SEEDED.questionsPerQuiz);

    const body = await submitAndCapture(page, quizId);

    expect(body.ok).toBe(true);
    expect(body.data?.score).toBe(SEEDED.questionsPerQuiz);
    expect(body.data?.percentage).toBe(100);
    expect(body.data?.passed).toBe(true);
    expect(body.data?.percentage).toBeGreaterThanOrEqual(QUIZ_PASS_PERCENT);
    expect(body.data?.quizPoints).toBe(quizPointsFromPercent(100));
    expect(body.data?.attemptNumber).toBe(2);
    // Best counts, not latest: attempt 1 scored 0 and must not drag this down.
    expect(body.data?.bestPercent).toBe(100);
    expect(body.data?.unlockedWeekNumber).toBe(WEEK_1.weekNumber + 1);
    expect(body.data?.unlockedNow).toBe(true);

    await expect(page.getByTestId("result-status")).toHaveText("PASS");
    await expect(page.getByTestId("unlock-notice")).toBeVisible();

    // …AND YET WEEK 2 IS STILL SHUT. The unlock was written (asserted above via
    // unlockedNow / unlockedWeekNumber); the subject-release switch overrides it
    // on the read side. This is the live-system counterpart of the unit test
    // "overrides a stored unlocked:true" in lock-state.test.ts, and it is the
    // assertion that would catch the switch being reduced to a UI-only hint.
    const week2Unlocked = await isWeekUnlocked(page.request, week2Id);
    if (week2Unlocked !== null) expect(week2Unlocked).toBe(false);

    // The content gate must agree with the read model — a disagreement here is
    // how a student gets sent to a page that then refuses them.
    await expectQuizRefusedAsLocked(page.request, week2Id);
  });

  // -------------------------------------------------------------------------
  // Case 3 — the attempt limit is a SERVER rule. Spends attempt 3 through the
  // API, then proves the 4th is refused even though no UI was involved.
  // -------------------------------------------------------------------------
  test("the 4th attempt is refused by the API even with the UI bypassed", async ({ page }) => {
    // Attempt 3, straight to the endpoint — no form, no disabled button.
    const third = await postAttempt(page.request, quizId, week1Id, "correct");
    expect(third.status).toBe(201);
    expect(third.body.data?.attemptNumber).toBe(SEEDED.attemptsAllowed);
    expect(third.body.data?.attemptsRemaining).toBe(0);

    // Attempt 4 — refused with a clear error, not a silent extra row.
    const fourth = await postAttempt(page.request, quizId, week1Id, "correct");
    expect(fourth.status).toBe(409);
    expect(fourth.body.ok).toBe(false);
    expect(fourth.body.code).toBe("attempts_exhausted");
    expect(fourth.body.error).toContain(String(SEEDED.attemptsAllowed));

    // The history route must show exactly the allowed number of attempts: the
    // refused submit wrote nothing, because it rolled back before any insert.
    const history = await page.request.get(`/api/quizzes/${quizId}/attempts`);
    expect(history.ok()).toBe(true);
    const historyBody = (await history.json()) as {
      data: { attemptsUsed: number; attemptsRemaining: number; attempts: unknown[] };
    };
    expect(historyBody.data.attemptsUsed).toBe(SEEDED.attemptsAllowed);
    expect(historyBody.data.attemptsRemaining).toBe(0);
    expect(historyBody.data.attempts).toHaveLength(SEEDED.attemptsAllowed);

    // The UI reflects the same state rather than offering a form it cannot honour.
    await page.goto(`/quizzes/${week1Id}`);
    await expect(page.getByTestId("attempts-exhausted")).toBeVisible();
    await expect(page.getByTestId("quiz-form")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Case 4 — the GET payload must not contain the answer key. Read-only:
  // consumes no attempt, so it is safe to run at any point.
  // -------------------------------------------------------------------------
  test("the quiz payload never carries isCorrect or explanation", async ({ page }) => {
    const response = await page.request.get(`/api/weeks/${week1Id}/quiz`);
    expect(response.ok()).toBe(true);

    const raw = await response.text();
    expect(raw).not.toContain("isCorrect");
    expect(raw).not.toContain("explanation");
    // A weaker check on the wire format alone could pass on a truncated body;
    // confirm the payload really is the whole quiz.
    const body = (await response.json()) as { data: { questions: unknown[] } };
    expect(body.data.questions).toHaveLength(SEEDED.questionsPerQuiz);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a curriculum week's week id and quiz id by probing this stream's own
 * GET route and matching the seeded quiz title.
 *
 * Serial primary keys are not guaranteed to start at 1 after a re-seed, and
 * hardcoding `weekId = 1` is the kind of assumption that fails once, silently,
 * on somebody else's database.
 */
async function resolveWeek(
  request: APIRequestContext,
  curriculumIndex: number,
): Promise<{ weekId: number; quizId: number | null }> {
  // Resolved from GET /api/courses, which deliberately lists LOCKED weeks too.
  //
  // This originally probed /api/weeks/{id}/quiz and matched the quiz title. That
  // stopped working when the coordinator gated that route on week unlock at
  // integration: a locked week now answers 403, so probing skipped it and the
  // helper threw "could not find the seeded quiz" for Week 2 — which the spec
  // needs precisely BECAUSE it is locked. The week list is the right source for
  // ids; the quiz endpoint is for content the student has earned.
  const wantedWeekNumber = curriculumIndex + 1;

  const listResponse = await request.get("/api/courses");
  if (!listResponse.ok()) {
    throw new Error(
      `GET /api/courses returned ${listResponse.status()}. Run \`npm run db:seed\` first.`,
    );
  }
  const list = (await listResponse.json()) as {
    data?: { weeks?: { id: number; weekNumber: number; locked: boolean }[] };
  };
  const week = list.data?.weeks?.find((w) => w.weekNumber === wantedWeekNumber);
  if (!week) {
    throw new Error(
      `Week ${wantedWeekNumber} is not in GET /api/courses. Run \`npm run db:seed\` first.`,
    );
  }

  // The quiz id is only obtainable for an unlocked week, which is correct — a
  // locked week must not reveal its quiz. Callers that need a quizId only ever
  // ask for Week 1.
  if (week.locked) return { weekId: week.id, quizId: null };

  const quizResponse = await request.get(`/api/weeks/${week.id}/quiz`);
  if (!quizResponse.ok()) return { weekId: week.id, quizId: null };
  const body = (await quizResponse.json()) as { data?: { quiz?: { id: number; title: string } } };

  const wantedTitle = curriculum[curriculumIndex].quiz.title;
  if (body.data?.quiz && body.data.quiz.title !== wantedTitle) {
    throw new Error(
      `Week ${wantedWeekNumber} quiz is "${body.data.quiz.title}", expected "${wantedTitle}". ` +
        "The database may hold a different curriculum revision.",
    );
  }
  return { weekId: week.id, quizId: body.data?.quiz?.id ?? null };
}

/**
 * Assert the quiz endpoint refuses a locked week.
 *
 * Added at integration alongside the week-lock gate. This is a stronger statement
 * than "the stored unlock flag is false": it proves a student cannot reach a later
 * week's quiz by URL, which is the behaviour sequential unlocking actually
 * promises.
 */
async function expectQuizRefusedAsLocked(
  request: APIRequestContext,
  weekId: number,
): Promise<void> {
  const response = await request.get(`/api/weeks/${weekId}/quiz`);
  expect(response.status()).toBe(403);
  const body = (await response.json()) as { ok: boolean; code?: string };
  expect(body.ok).toBe(false);
  expect(body.code).toBe("week_locked");
}

/**
 * Select an option for every question in the rendered form.
 *
 * The correct option is looked up in `scripts/seed-content.ts` — the same file
 * the seed inserts from — because the API deliberately does not tell the client
 * which option is right. Returns the number of questions answered.
 */
async function answerAll(page: Page, mode: "correct" | "wrong"): Promise<number> {
  const cards = page.locator('[data-testid^="question-"]');
  const count = await cards.count();

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const legend = ((await card.locator("legend").innerText()) ?? "").trim();
    // Strip the rendered "12. " prefix to recover the seeded question text.
    const questionText = legend.replace(/^\d+\.\s*/, "");
    const target = optionTextFor(questionText, mode);
    await clickOptionByText(card, target);
  }

  return count;
}

/** The correct (or a deliberately incorrect) option text for a seeded question. */
function optionTextFor(questionText: string, mode: "correct" | "wrong"): string {
  const question = WEEK_1.quiz.questions.find((q) => q.questionText === questionText);
  if (!question) {
    throw new Error(
      `Rendered question is not in the seeded curriculum: "${questionText}". ` +
        "The database and scripts/seed-content.ts have diverged — re-seed.",
    );
  }
  const option =
    mode === "correct"
      ? question.options.find((o) => o.correct)
      : question.options.find((o) => !o.correct);
  if (!option) {
    throw new Error(`Seeded question has no ${mode} option: "${questionText}".`);
  }
  return option.text;
}

/** Click the radio whose label text is exactly `text`, within one question card. */
async function clickOptionByText(card: Locator, text: string): Promise<void> {
  const label = card.locator("label", { hasText: text }).first();
  await label.locator('input[type="radio"]').check();
}

/** Press Submit and return the parsed POST /submit envelope. */
async function submitAndCapture(page: Page, quizId: number): Promise<SubmitEnvelope> {
  const waitForSubmit = page.waitForResponse(
    (r) => r.url().includes(`/api/quizzes/${quizId}/submit`) && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByTestId("submit-quiz").click();
  const response = await waitForSubmit;
  return (await response.json()) as SubmitEnvelope;
}

/**
 * POST an attempt directly, bypassing the UI entirely. Answers are taken from
 * the GET payload's option order cross-referenced with the seeded curriculum.
 */
async function postAttempt(
  request: APIRequestContext,
  quizId: number,
  weekId: number,
  mode: "correct" | "wrong",
): Promise<{ status: number; body: SubmitEnvelope }> {
  const quizResponse = await request.get(`/api/weeks/${weekId}/quiz`);
  const quizBody = (await quizResponse.json()) as {
    data: {
      questions: { id: number; questionText: string; options: { id: number; optionText: string }[] }[];
    };
  };

  const answers = quizBody.data.questions.map((question) => {
    const wanted = optionTextFor(question.questionText, mode);
    const option = question.options.find((o) => o.optionText === wanted);
    if (!option) {
      throw new Error(`No option matching "${wanted}" on question ${question.id}.`);
    }
    return { questionId: question.id, selectedOptionId: option.id };
  });

  const response = await request.post(`/api/quizzes/${quizId}/submit`, {
    data: { quizId, answers },
  });
  return { status: response.status(), body: (await response.json()) as SubmitEnvelope };
}

/**
 * Is `weekId` unlocked for the signed-in student? Returns null when the answer
 * cannot be determined, which the caller must treat as "not asserted".
 *
 * Read through `GET /api/me/progress` (progress-tracking stream), whose response
 * is `ApiResult<WeekProgress[]>`. Note that stream's design decision: it DERIVES
 * unlock from best quiz percentages via `shouldUnlockNextWeek` and deliberately
 * ignores the stored `progress.weekUnlocked` flag this stream writes. So this
 * assertion checks the read side agrees with the write side's input, not the flag
 * itself.
 *
 * TODO(test): also assert the LockBadge on the course week list once
 * course-content's selectors are settled — that is the state the student sees.
 * Null is returned (and the assertion skipped) when the route is unavailable or
 * its shape is unrecognised, so this file never fails for another stream's
 * reason; it means "Week 2 stays locked" can fall back to being verified only at
 * the grading decision, which is why it is flagged here.
 */
async function isWeekUnlocked(
  request: APIRequestContext,
  weekId: number,
): Promise<boolean | null> {
  const response = await request.get("/api/me/progress");
  if (!response.ok()) return null;

  const body = (await response.json()) as {
    ok?: boolean;
    data?: { weekId: number; unlocked: boolean }[];
  };
  const weeks = body.data;
  if (!Array.isArray(weeks)) return null;

  const week = weeks.find((w) => w.weekId === weekId);
  // A week absent from the read model has certainly not been unlocked.
  return week ? week.unlocked === true : false;
}
