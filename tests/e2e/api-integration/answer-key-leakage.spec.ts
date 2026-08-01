// =============================================================================
// ANSWER-KEY LEAKAGE — the highest-consequence regression in the wave.
// -----------------------------------------------------------------------------
// `practice_problems` stores the teaching material and the ANSWER in the same
// row: `solution_code`, `solution_explanation`, `solution_screenshot_url` sit
// beside `problem_statement` and `starter_code`. Every read path is therefore
// one `select *` away from handing students the solution, and the only thing
// standing between the two is the explicit column list in
// src/lib/learning/projection.ts.
//
// WHY THESE ASSERTIONS READ THE RAW BODY TEXT AND NOT TYPED FIELDS.
//
// The obvious test is `expect(body.solutionCode).toBeUndefined()`. It is close
// to worthless. It checks exactly the one key someone thought to name, in
// exactly the one place they thought to look, and it passes when the column
// reappears:
//
//   * nested inside a `problem` or `meta` object the assertion does not walk;
//   * under the snake_case `solution_code`, because a future handler returned a
//     raw pg row instead of a Drizzle projection;
//   * inside a serialized `testCases` blob, or an error message that echoed the
//     row back;
//   * on ONE element of a list where the assertion only checked `[0]`.
//
// So these specs assert on the SERIALIZED JSON as a string. If the secret is
// anywhere in the bytes that crossed the wire, the test fails, regardless of the
// shape it arrived in. That is the property that actually matters — "the student
// did not receive the answer" — rather than a proxy for it.
//
// The sentinel values are deliberately long and unmistakable so a substring
// match cannot collide with ordinary prose in a problem statement.
// =============================================================================

import { expect, test } from "@playwright/test";

import {
  assertFeatureFlagsOn,
  NO_TEST_DB_REASON,
  okBody,
  seedIds,
  signedInApi,
  TEST_DB_URL,
} from "./fixtures";

test.skip(!TEST_DB_URL, NO_TEST_DB_REASON);
test.describe.configure({ mode: "serial" });

// A LARGER BUDGET THAN THE 30 s DEFAULT, for compilation and not for slowness.
// Against `next dev` every route compiles on FIRST request, and the routes this
// file touches are newer than tests/e2e/global-setup.ts's warm-up list, so the
// first spec to reach one pays webpack out of its own budget. Run on its own,
// this file passes at the default; run first in a larger selection it timed out
// in `beforeAll` with "Timeout of 30000ms exceeded" while the server log showed
// a route still compiling. Raised HERE rather than in playwright.config.ts so
// the 30 s default — a useful signal everywhere else — stays intact. Same
// reasoning, same number, as tests/e2e/live-classes/class-workflow.spec.ts.
test.setTimeout(90_000);


/** Values planted in the answer-key columns. Any of these in a student-facing
 *  response body is a leak, whatever key it arrived under. */
const SECRET = {
  code: "SOLUTION_SENTINEL_CODE_d41d8cd98f00b204",
  explanation: "SOLUTION_SENTINEL_EXPLANATION_e3b0c44298fc1c14",
  screenshot: "https://example.test/SOLUTION_SENTINEL_SHOT_9e107d9d372bb682.png",
} as const;

test.describe("practice problems withhold the answer key", () => {
  let lectureId = 0;
  let problemId = 0;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await assertFeatureFlagsOn(api);
    ({ lectureId } = await seedIds());

    const created = await api.post(`/api/lectures/${lectureId}/practice-problems`, {
      data: {
        title: "QA answer-key leakage fixture",
        problemContext: "A problem that exists so the solution has somewhere to hide.",
        problemStatement: "Do the thing.",
        hints: [
          { level: 1, text: "first nudge" },
          { level: 2, text: "second nudge" },
          { level: 3, text: "third nudge" },
        ],
        solutionCode: SECRET.code,
        solutionExplanation: SECRET.explanation,
        solutionScreenshotUrl: SECRET.screenshot,
        problemOrder: 990,
      },
    });
    const row = await okBody<{ id: number }>(created, created.status());
    problemId = row.id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!problemId) return;
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await api.delete(`/api/practice-problems/${problemId}`);
    await page.close();
  });

  test("the LIST route leaks no part of the answer key", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.get(`/api/lectures/${lectureId}/practice-problems`);
    expect(response.status()).toBe(200);

    const raw = await response.text();
    expect(raw, "solution_code reached a student through the list route").not.toContain(
      SECRET.code,
    );
    expect(raw).not.toContain(SECRET.explanation);
    expect(raw).not.toContain(SECRET.screenshot);
    // Nor the column names themselves — their presence means a raw row was
    // serialized even if this particular fixture's values happen to be null.
    expect(raw).not.toContain("solutionCode");
    expect(raw).not.toContain("solution_code");
    expect(raw).not.toContain("solutionExplanation");
    expect(raw).not.toContain("solution_explanation");
    expect(raw).not.toContain("solutionScreenshotUrl");
    expect(raw).not.toContain("solution_screenshot_url");
  });

  test("the DETAIL route leaks no part of the answer key", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.get(`/api/practice-problems/${problemId}`);
    expect(response.status()).toBe(200);

    const raw = await response.text();
    expect(raw).not.toContain(SECRET.code);
    expect(raw).not.toContain(SECRET.explanation);
    expect(raw).not.toContain(SECRET.screenshot);
    expect(raw).not.toContain("solutionCode");
    expect(raw).not.toContain("solution_code");
  });

  test("the DETAIL route withholds hint TEXT while reporting how many exist", async ({ page }) => {
    // The hint ladder is metered by a separate endpoint. If the detail payload
    // carried the array, the metering would be decoration: hint 3 would already
    // be in the bytes that rendered hint 1's button.
    const api = await signedInApi(page, "student");
    const response = await api.get(`/api/practice-problems/${problemId}`);
    const raw = await response.text();
    expect(raw, "hint text must not ride along on the detail payload").not.toContain(
      "second nudge",
    );
    expect(raw).not.toContain("third nudge");

    const data = await okBody<{ hintCount: number; maxHintLevel: number }>(response);
    expect(data.hintCount).toBe(3);
    expect(data.maxHintLevel).toBe(3);
  });

  test("the LIST route still says WHETHER a solution exists", async ({ page }) => {
    // Withholding the answer is not the same as hiding that there is one — the
    // UI needs to know whether to render the "show solution" affordance. This is
    // the control case proving the projection is selective, not merely empty.
    const api = await signedInApi(page, "student");
    const response = await api.get(`/api/lectures/${lectureId}/practice-problems`);
    const raw = await response.text();
    expect(raw).toContain("solutionAvailable");
  });

  test("the hints ladder reveals only up to the level asked for", async ({ page }) => {
    const api = await signedInApi(page, "student");

    const first = await api.get(`/api/practice-problems/${problemId}/hints?upTo=1`);
    const firstRaw = await first.text();
    expect(first.status()).toBe(200);
    expect(firstRaw).toContain("first nudge");
    expect(firstRaw, "upTo=1 must not include hint 2").not.toContain("second nudge");
    expect(firstRaw).not.toContain("third nudge");

    const second = await api.get(`/api/practice-problems/${problemId}/hints?upTo=2`);
    const secondRaw = await second.text();
    expect(secondRaw).toContain("second nudge");
    expect(secondRaw).not.toContain("third nudge");
  });

  test("the hints ladder defaults to ONE hint when upTo is omitted", async ({ page }) => {
    // Documented in the handler header: defaulting the other way would undo the
    // metering with a typo.
    const api = await signedInApi(page, "student");
    const response = await api.get(`/api/practice-problems/${problemId}/hints`);
    const raw = await response.text();
    expect(raw).toContain("first nudge");
    expect(raw).not.toContain("second nudge");
  });

  test("an out-of-range upTo is rejected rather than clamped open", async ({ page }) => {
    const api = await signedInApi(page, "student");
    for (const bad of ["0", "-1", "999", "abc"]) {
      const response = await api.get(`/api/practice-problems/${problemId}/hints?upTo=${bad}`);
      expect(
        [422, 400].includes(response.status()),
        `upTo=${bad} returned ${response.status()}; an accepted out-of-range value would open the ladder`,
      ).toBe(true);
    }
  });

  test("the SOLUTION route is where the answer lives, and it does return it", async ({ page }) => {
    // The control case for this entire file. Without it, every assertion above
    // would also pass against a fixture whose solution columns were never
    // written — which is the classic way a leakage suite proves nothing.
    //
    // NOTE, and this is a genuine finding rather than an assertion: this route
    // is reachable by ANY signed-in student with no attempt-gate, because
    // `practice_problems` has no attempts ledger to gate on. The handler header
    // says so plainly. The test therefore pins current behaviour and the comment
    // records that the behaviour is a known gap, not an oversight in the test.
    const api = await signedInApi(page, "student");
    const response = await api.get(`/api/practice-problems/${problemId}/solution`);
    expect(response.status()).toBe(200);
    const raw = await response.text();
    expect(raw).toContain(SECRET.code);
  });
});

test.describe("quiz answers are withheld while the attempt is open", () => {
  test("the quiz question payload carries no correct-answer marker", async ({ page }) => {
    // Same class of leak, older feature, and the wave added
    // `questions.explanation_html` / `correct_breakdown` / `incorrect_analysis`
    // to this table — three new columns that a `select *` would now also expose.
    const api = await signedInApi(page, "student");
    const { weekId } = await seedIds();

    const response = await api.get(`/api/weeks/${weekId}/quiz`);
    if (response.status() !== 200) test.skip(true, `no quiz for week ${weekId}`);

    const raw = await response.text();
    for (const forbidden of [
      "isCorrect",
      "is_correct",
      "correctOptionId",
      "correct_option_id",
      "explanationHtml",
      "explanation_html",
      "correctBreakdown",
      "correct_breakdown",
      "incorrectAnalysis",
      "incorrect_analysis",
    ]) {
      expect(raw, `"${forbidden}" reached a student before they submitted`).not.toContain(
        forbidden,
      );
    }
  });
});
