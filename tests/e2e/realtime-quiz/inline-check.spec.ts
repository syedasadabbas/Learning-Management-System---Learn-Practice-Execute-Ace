// =============================================================================
// E2E — the inline knowledge check. Owner: realtime-quiz stream.
// -----------------------------------------------------------------------------
// NOT RUN AS PART OF THE FULL SUITE BY THIS STREAM. Nine streams share one dev
// server on port 3000 and one demo student. The coordinator runs the suite
// serially at integration. This stream ran only this file.
//
// SAFE TO RUN IN ANY ORDER, unlike the graded quiz spec. Taking a realtime check
// consumes no attempt budget, writes no row and changes no unlock flag — which is
// exactly what the last describe block asserts, and it asserts it by measuring the
// leaderboard and the dashboard BEFORE and AFTER. If a future refactor wires this
// into scoring, the totals move and this spec fails. That is the whole point:
// nothing else in the suite would notice.
//
// TWO PRECONDITIONS THIS STREAM COULD NOT SATISFY ITSELF, both reported as
// hand-offs rather than worked around:
//
//   1. NO REALTIME QUIZ IS SEEDED. `scripts/seed.ts` and `scripts/content/**`
//      belong to other streams, so no row with `quizzes.kind = 'realtime'` exists
//      yet. The interactive cases below therefore skip with an explicit reason
//      instead of failing — see TODO(test) markers.
//   2. THE COMPONENT IS NOT MOUNTED IN THE LECTURE PAGE. That page belongs to the
//      course-content stream. Once `<RealtimeCheckPanel weekId={week.id} />` is
//      added there, and a realtime quiz is seeded, every skip below turns into a
//      real assertion with no edit to this file.
//
// Timeouts are milliseconds (house rule 5).
// =============================================================================

import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoServerError, loginAs, SEEDED } from "../fixtures";

/** How long to wait for the reveal round trip. Generous: it is one server action. */
const REVEAL_TIMEOUT_MS = 10_000;

/**
 * Per-test budget, milliseconds. Well above the 30 s default because these cases
 * sweep every unlocked lecture, and a lecture page in `next dev` compiles on first
 * request and lazy-loads Sandpack.
 */
const SWEEP_TIMEOUT_MS = 180_000;

test.describe("inline knowledge check", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(SWEEP_TIMEOUT_MS);
    await loginAs(page, "student");
  });

  // -------------------------------------------------------------------------
  // Where the check is expected to live
  // -------------------------------------------------------------------------

  test("every unlocked lecture renders without a server error, with or without a check", async ({
    page,
  }) => {
    // Always runs. An inline extra that breaks the lecture it sits in is the worst
    // possible failure for this stream, so the lecture pages are swept first.
    const lectureUrls = await unlockedLectureUrls(page);
    expect(lectureUrls.length).toBeGreaterThan(0);

    for (const url of lectureUrls) {
      await openLecture(page, url);
      await expectNoServerError(page);
      await expect(page.getByTestId("lecture-title")).toBeVisible();
    }
  });

  test("no lecture page leaks an answer key for an unanswered check", async ({ page }) => {
    // Always runs, and is meaningful even while nothing is mounted: it would catch
    // a future mount that passed the raw rows through instead of `toInlineCheck`.
    const lectureUrls = await unlockedLectureUrls(page);
    expect(lectureUrls.length).toBeGreaterThan(0);

    for (const url of lectureUrls) {
      const response = await openLecture(page, url);
      const html = (await response?.text()) ?? "";
      expect(html, `${url} must not ship isCorrect`).not.toContain("isCorrect");
      // `data-correct` / `correctOptionId` would be the other obvious mistakes.
      expect(html, `${url} must not ship correctOptionId`).not.toContain("correctOptionId");
    }
  });

  // -------------------------------------------------------------------------
  // The interactive flow
  // -------------------------------------------------------------------------

  test("answering reveals feedback, keyboard-only, announced in a live region", async ({
    page,
  }) => {
    const check = await findCheck(page);
    // TODO(test): unskips once a `quizzes.kind = 'realtime'` row is seeded AND
    // course-content mounts <RealtimeCheckPanel/> in the lecture page. Both are
    // outside this stream's file ownership; see the header.
    test.skip(check === null, "No realtime check is mounted on any seeded lecture yet.");
    if (!check) return;

    const question = check.locator('[data-testid="realtime-question"]').first();
    const feedback = question.locator('[data-testid="realtime-feedback"]');

    // The live region must exist BEFORE the first answer, or the first verdict is
    // silently not announced. jsdom cannot prove this; a real browser can.
    await expect(feedback).toHaveAttribute("aria-live", "polite");
    await expect(feedback).toHaveText("");
    await expect(question.locator('[data-testid="realtime-explanation"]')).toHaveCount(0);

    // KEYBOARD ONLY from here. No click, anywhere.
    const firstRadio = question.locator('input[type="radio"]').first();
    await firstRadio.focus();
    await expect(firstRadio).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(question.locator('input[type="radio"]').nth(1)).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(firstRadio).toBeChecked();

    await page.keyboard.press("Tab");
    const checkButton = question.locator('[data-testid="realtime-check-answer"]');
    await expect(checkButton).toBeFocused();
    await page.keyboard.press("Enter");

    const verdict = question.locator('[data-testid="realtime-verdict"]');
    await expect(verdict).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    // Words, not colour: one of these two strings must be present.
    await expect(verdict).toHaveText(/Correct|Not quite/);
    // The verdict lands inside the pre-existing live region.
    await expect(feedback.locator('[data-testid="realtime-verdict"]')).toHaveCount(1);
    // The explanation is revealed only now.
    await expect(question.locator('[data-testid="realtime-explanation"]')).toBeVisible();
  });

  test("attempts are unlimited — four wrong answers leave it fully answerable", async ({
    page,
  }) => {
    const check = await findCheck(page);
    // TODO(test): see the note above. A graded quiz would refuse the 4th attempt;
    // this must not, which is why the loop runs one past the graded ceiling of
    // SEEDED.attemptsAllowed.
    test.skip(check === null, "No realtime check is mounted on any seeded lecture yet.");
    if (!check) return;

    const question = check.locator('[data-testid="realtime-question"]').first();
    const radios = question.locator('input[type="radio"]');
    const count = await radios.count();

    for (let i = 0; i <= SEEDED.attemptsAllowed; i += 1) {
      await radios.nth(i % count).check();
      await question.locator('[data-testid="realtime-check-answer"]').click();
      await expect(question.locator('[data-testid="realtime-verdict"]')).toBeVisible({
        timeout: REVEAL_TIMEOUT_MS,
      });
      await question.locator('[data-testid="realtime-try-again"]').click();
    }

    // Past the graded ceiling and still open for business.
    for (let i = 0; i < count; i += 1) await expect(radios.nth(i)).toBeEnabled();
    await expect(check).not.toContainText(/attempts?\s+(remaining|left|used)/i);
    await expect(check.getByTestId("realtime-ungraded-badge")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // THE INVARIANT. The reason this quiz kind exists separately.
  // -------------------------------------------------------------------------

  test("taking a realtime check changes no leaderboard total and no progress", async ({
    page,
  }) => {
    const before = await measureGradeState(page);

    const check = await findCheck(page);
    // TODO(test): unskips with the two preconditions in the header. Until then the
    // baseline measurement above still runs, so a broken leaderboard or dashboard
    // is caught even while the check is unmounted.
    test.skip(check === null, "No realtime check is mounted on any seeded lecture yet.");
    if (!check) return;

    const question = check.locator('[data-testid="realtime-question"]').first();
    const radios = question.locator('input[type="radio"]');
    const count = await radios.count();

    // Answer every option in turn, so whichever one is correct gets committed too.
    // A "reward the right answer with a point" refactor is caught by this.
    for (let i = 0; i < count; i += 1) {
      await radios.nth(i).check();
      await question.locator('[data-testid="realtime-check-answer"]').click();
      await expect(question.locator('[data-testid="realtime-verdict"]')).toBeVisible({
        timeout: REVEAL_TIMEOUT_MS,
      });
      const tryAgain = question.locator('[data-testid="realtime-try-again"]');
      if (await tryAgain.count()) await tryAgain.click();
    }

    const after = await measureGradeState(page);

    // Every leaderboard total, byte for byte, and the whole dashboard body text.
    expect(after.leaderboardTotals).toEqual(before.leaderboardTotals);
    expect(after.myTotal).toBe(before.myTotal);
    expect(after.weekCards).toEqual(before.weekCards);
    expect(after.dashboardText).toBe(before.dashboardText);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * URLs of every lecture the demo student can actually open.
 *
 * Derived from the week list rather than hardcoded: the seed's ids are serial
 * values that change on every reseed. Locked weeks are excluded because their
 * lectures legitimately render a LockedNotice instead of content.
 */
/**
 * Open a lecture without waiting for `load`.
 *
 * `load` does not settle reliably on this page: the lecture view lazy-loads
 * Sandpack, whose bundler iframe keeps the load event pending. `domcontentloaded`
 * is what the assertions here actually need — the server-rendered markup.
 */
function openLecture(page: Page, url: string) {
  return page.goto(url, { waitUntil: "domcontentloaded" });
}

/**
 * Memoised across tests in this file: the ids are stable for the life of a seeded
 * database, and re-deriving them per test tripled the runtime of the sweep.
 */
let cachedLectureUrls: string[] | null = null;

async function unlockedLectureUrls(page: Page): Promise<string[]> {
  if (cachedLectureUrls) return cachedLectureUrls;

  // The href is on the <a> WRAPPING the card, not on the card: WeekCard and the
  // week page both render `<Link><Card data-testid=...></Link>` so that the whole
  // card is one click target. `:has(> …)` climbs to that anchor.
  await page.goto("/weeks");
  const weekHrefs = await page
    .locator('a:has(> [data-testid="week-card"][data-locked="false"])')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")).filter(Boolean) as string[]);

  const lectureUrls: string[] = [];
  for (const weekHref of weekHrefs) {
    await page.goto(weekHref);
    const hrefs = await page
      .locator('a:has(> [data-testid="lecture-card"])')
      .evaluateAll(
        (nodes) => nodes.map((n) => n.getAttribute("href")).filter(Boolean) as string[],
      );
    lectureUrls.push(...hrefs);
  }
  cachedLectureUrls = lectureUrls;
  return lectureUrls;
}

/**
 * The first mounted inline check across the unlocked lectures, or null.
 *
 * Returns null rather than failing so the caller can `test.skip` with a reason:
 * "no realtime quiz is authored yet" is a content gap, not a defect in this
 * stream, and reporting it as a failure would hide real regressions in noise.
 */
async function findCheck(page: Page): Promise<Locator | null> {
  for (const url of await unlockedLectureUrls(page)) {
    await openLecture(page, url);
    const check = page.getByTestId("realtime-check").first();
    if (await check.count()) return check;
  }
  return null;
}

interface GradeState {
  leaderboardTotals: string[];
  myTotal: string | null;
  weekCards: string[];
  dashboardText: string;
}

/**
 * Everything a grade could visibly move.
 *
 * Read through the UI on purpose. A direct database assertion would be stronger
 * but Playwright here has no database handle, and reading it through the pages the
 * cohort actually looks at means this also catches a leaderboard rebuild triggered
 * by some indirect route rather than by a direct scoring call.
 */
async function measureGradeState(page: Page): Promise<GradeState> {
  await page.goto("/leaderboard");
  await expectNoServerError(page);
  const leaderboardTotals = await page.getByTestId("lb-total").allTextContents();
  const myTotalLocator = page.getByTestId("lb-my-total");
  const myTotal = (await myTotalLocator.count()) ? await myTotalLocator.innerText() : null;

  await page.goto("/dashboard");
  await expectNoServerError(page);
  const dashboard = page.getByTestId("dashboard");
  const dashboardText = await dashboard.innerText();

  await page.goto("/weeks");
  const weekCards = await page
    .locator('[data-testid="week-card"]')
    .evaluateAll((nodes) =>
      nodes.map(
        (n) => `${n.getAttribute("data-week-number")}:${n.getAttribute("data-locked")}`,
      ),
    );

  return { leaderboardTotals, myTotal, weekCards, dashboardText };
}
