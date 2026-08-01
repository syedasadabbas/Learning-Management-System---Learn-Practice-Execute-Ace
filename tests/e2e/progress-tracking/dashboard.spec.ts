// =============================================================================
// E2E: student dashboard. Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Nine streams share one working copy and one port 3000;
// the coordinator runs the Playwright suite serially at integration. Authored
// here so it is ready for that run.
//
// Asserts against the shared fixtures (tests/e2e/fixtures.ts) and against the
// scoring contract, never against magic numbers: the expected week score is
// computed with the same helpers the app uses, so a change to the bands moves the
// app and this test together.
//
// The seeded demo student has no quiz attempts and no submissions, which makes it
// exactly the zero-activity first load this stream is most at risk of getting
// wrong. The "passed quiz + graded assignment" acceptance case from the skill
// definition needs seeded activity that the shared seed does not create — see the
// TODO(test) on that block.
// =============================================================================

import { expect, test } from "@playwright/test";

import { DEMO, SEEDED, expectNoServerError, loginAs } from "../fixtures";
import { POINTS, QUIZ_PASS_PERCENT } from "../../../src/lib/contracts/scoring";

test.describe("student dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/dashboard");
    await expectNoServerError(page);
  });

  test("renders for a student with zero activity without NaN or an empty page", async ({
    page,
  }) => {
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByTestId("progress-summary")).toBeVisible();

    // One card per seeded week. An empty list here is the failure this asserts on.
    const cards = page.getByTestId("week-card");
    await expect(cards).toHaveCount(SEEDED.weekCount);

    // No arithmetic accident anywhere on the page.
    await expect(page.locator("body")).not.toContainText("NaN");
    await expect(page.locator("body")).not.toContainText("Infinity");
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect(page.locator("body")).not.toContainText("Invalid Date");

    // Percentage and points must be real numbers against a real ceiling.
    await expect(page.getByTestId("overall-percent")).toHaveText(/^\d+(\.\d)?%$/);
    await expect(page.getByTestId("total-score")).toHaveText(
      new RegExp(`\\d+ / ${SEEDED.weekCount * POINTS.WEEK_MAX}$`),
    );
  });

  test("greets the student by name", async ({ page }) => {
    await expect(page.getByTestId("progress-summary")).toContainText(DEMO.student.name);
  });

  test("week 1 is unlocked and later weeks are locked with a stated reason", async ({ page }) => {
    const week1 = page.locator('[data-testid="week-card"][data-week-number="1"]');
    await expect(week1).toHaveAttribute("data-unlocked", "true");

    for (let n = 2; n <= SEEDED.weekCount; n += 1) {
      const card = page.locator(`[data-testid="week-card"][data-week-number="${n}"]`);
      await expect(card).toHaveAttribute("data-unlocked", "false");
      // A padlock with no explanation is a dead end for the student.
      await expect(card).toContainText(`${QUIZ_PASS_PERCENT}%`);
    }
  });

  test("shows lecture counts as 'x of y', not a bare number", async ({ page }) => {
    const week1 = page.locator('[data-testid="week-card"][data-week-number="1"]');
    await expect(week1).toContainText(/\d+ of \d+ lectures?|No lectures yet/);
  });

  test("shows a per-week quiz and assignment status", async ({ page }) => {
    const week1 = page.locator('[data-testid="week-card"][data-week-number="1"]');
    await expect(week1.getByTestId("week-quiz-status")).toBeVisible();
    await expect(week1.getByTestId("week-assignment-status")).toBeVisible();
  });

  test("shows a next deadline and an actionable next step", async ({ page }) => {
    await expect(page.getByTestId("next-deadline")).toBeVisible();
    await expect(page.getByTestId("next-action-label")).toContainText(/Week \d/);
    // The call to action must go somewhere, not to "#".
    const href = await page.getByTestId("next-action-link").getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).not.toBe("#");
  });

  test("every week score is within the contract's cap", async ({ page }) => {
    const scores = await page
      .locator('[data-testid="week-card"]')
      .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute("data-week-score"))));
    expect(scores).toHaveLength(SEEDED.weekCount);
    for (const score of scores) {
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(POINTS.WEEK_MAX);
    }
  });
});

test.describe("progress API", () => {
  test("GET /api/me/progress returns the student's own weeks in the frozen envelope", async ({
    page,
  }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/me/progress");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(SEEDED.weekCount);
    expect(body.data.map((w: { weekNumber: number }) => w.weekNumber)).toEqual(
      Array.from({ length: SEEDED.weekCount }, (_, i) => i + 1),
    );
    // lectureTotal is present so no caller needs a second query.
    expect(body.data[0]).toHaveProperty("lectureTotal");
    expect(body.data[0].unlocked).toBe(true);
  });

  test("a query parameter cannot make it read another student", async ({ page }) => {
    await loginAs(page, "student");
    const mine = await (await page.request.get("/api/me/progress")).json();
    // There is no studentId parameter to honour; the response must be identical.
    const spoofed = await (await page.request.get("/api/me/progress?studentId=1")).json();
    expect(spoofed).toEqual(mine);
  });

  test("GET /api/me/dashboard returns a coherent summary", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/me/dashboard");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.maxScore).toBe(SEEDED.weekCount * POINTS.WEEK_MAX);
    expect(Number.isFinite(body.data.overallPercent)).toBe(true);
    expect(body.data.weeksUnlocked).toBeGreaterThanOrEqual(1);
    expect(body.data.nextAction.label).toBeTruthy();
  });

  test("both routes reject an anonymous caller", async ({ request }) => {
    // ROUTE_AUTH marks these "student"; an unauthenticated fetch must get 401,
    // never a redirect to an HTML login page a fetch() caller cannot act on.
    for (const path of ["/api/me/progress", "/api/me/dashboard"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.ok).toBe(false);
    }
  });
});

// TODO(test): the skill's acceptance criterion — "seed a passed Week 1 quiz + a
// graded assignment, then assert the Week 1 score equals the scoring.ts
// expectation" — cannot run against the shared seed, which creates no attempts
// and no submissions for the demo student. Making it pass needs one of:
//   (a) a seeded "advanced student" account in scripts/seed.ts (owned by
//       devops-testing), or
//   (b) driving the quizzes UI to a pass and ingesting a graded submission first,
//       which couples this spec to two other streams' flows.
// Option (a) is preferred and is a request for the devops-testing stream. Until
// it lands, the expected score is asserted here as a computation only, so at
// least the arithmetic this stream owns is pinned:
test("week score for a passed quiz plus a graded on-time assignment", () => {
  // 20 (quiz >= pass) + 40 (assignment, on time, 3+ stars) + 10 (participation)
  // = POINTS.WEEK_MAX. If this ever stops holding, the dashboard's numbers moved.
  expect(POINTS.QUIZ_MAX + POINTS.ASSIGNMENT_MAX + POINTS.PARTICIPATION_MAX).toBe(
    POINTS.WEEK_MAX,
  );
});
