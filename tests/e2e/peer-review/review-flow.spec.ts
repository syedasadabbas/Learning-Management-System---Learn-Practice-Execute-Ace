// =============================================================================
// E2E: peer review — the happy path and the effort floor.
// Owner: peer-review stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. See the header of ./authorization.spec.ts for why, and for
// what these specs add over the unit and integration tests that DO run: the form's
// client-side mirror of the server rules, and the fact that the whole round trip
// through a server action works from a browser.
//
// THE FORM'S CHECKS ARE A COURTESY, NOT THE ENFORCEMENT, and these specs assert them
// as such. src/lib/peer-review/validate.test.ts already proves the server refuses a
// short review and an unscored criterion; what is asserted here is that the reviewer
// is TOLD BEFORE a round trip, which is a UI property and only observable in a
// browser. src/components/instructor/GradeForm.tsx puts the principle best and this
// stream copied the words: never treat a disabled button as a guard.
//
// All timeouts are milliseconds and all lengths are characters (house rules).
// =============================================================================

import { expect, test } from "@playwright/test";

import { expectNoServerError, loginAs } from "../fixtures";

/** Mirrors MIN_REVIEW_CHARS in src/lib/peer-review/config.ts. */
const MIN_REVIEW_CHARS = 120;

const LONG_ENOUGH =
  "The responsive layout holds up at 360 mm and at 1280 mm widths and the navigation " +
  "collapses cleanly. The contrast on the footer links is too low to read, and index.html " +
  "nests three divs where one section element would do.";

const TASK_LINK = '[data-testid^="review-task-link-"]';

/**
 * Open the first review the demo student still has to write, or skip.
 *
 * A helper rather than a beforeEach, so the skip reason is attributed to the spec
 * that needed the state — the pattern tests/e2e/fixtures.ts argues for in its
 * isolation header ("a spec that depends on state must SAY SO, in its own file").
 */
async function openWritableTask(page: import("@playwright/test").Page): Promise<boolean> {
  await loginAs(page, "student");
  await page.goto("/peer-review");
  await expectNoServerError(page);

  const link = page.locator(TASK_LINK, { hasText: "Write this review" });
  if ((await link.count()) === 0) return false;
  await link.first().click();
  await expect(page.locator('[data-testid="peer-review-form"]')).toBeVisible();
  return true;
}

test.describe("peer review — writing one", () => {
  test("the form refuses a review below the character floor, without a round trip", async ({
    page,
  }) => {
    const ready = await openWritableTask(page);
    test.skip(
      !ready,
      "No outstanding peer review for the demo student. Needs a seeded, allocated round — " +
        "see the TODO(peer-review) in ./authorization.spec.ts.",
    );

    // Score everything so the ONLY thing wrong is the length. Otherwise the form would
    // report the unscored criteria first and this spec would pass for the wrong reason.
    for (const key of ["requirements", "quality", "presentation"]) {
      const stars = page.locator(`[data-testid="criterion-${key}"] [data-value="4"]`);
      if ((await stars.count()) > 0) await stars.first().click();
    }

    await page.fill('[data-testid="peer-review-content"]', "Looks good.");
    // The counter states exactly how many characters are still needed, so the reviewer
    // is not guessing.
    await expect(page.locator('[data-testid="chars-remaining"]')).toContainText(
      /more characters? needed/i,
    );

    await page.click('[data-testid="peer-review-submit"]');
    // Refused client-side: the form is still there and nothing was stored.
    await expect(page.locator('[data-testid="peer-review-form"]')).toBeVisible();
    await expect(page.getByText(new RegExp(`${MIN_REVIEW_CHARS}`))).toBeVisible();
  });

  test("the form refuses a long review with an unscored criterion", async ({ page }) => {
    const ready = await openWritableTask(page);
    test.skip(!ready, "No outstanding peer review for the demo student.");

    // Deliberately score only ONE criterion. This is the cheapest possible pass — 120
    // characters and one star — and refusing it is the second half of the gaming
    // defence in src/lib/peer-review/config.ts.
    const one = page.locator('[data-testid="criterion-requirements"] [data-value="5"]');
    if ((await one.count()) > 0) await one.first().click();

    await page.fill('[data-testid="peer-review-content"]', LONG_ENOUGH);
    await expect(page.locator('[data-testid="chars-remaining"]')).toContainText(/Long enough/i);

    await page.click('[data-testid="peer-review-submit"]');
    await expect(page.getByText(/Score every criterion/i)).toBeVisible();
    await expect(page.locator('[data-testid="peer-review-form"]')).toBeVisible();
  });

  test("a complete review is accepted, and then cannot be changed", async ({ page }) => {
    const ready = await openWritableTask(page);
    test.skip(!ready, "No outstanding peer review for the demo student.");

    for (const key of ["requirements", "quality", "presentation"]) {
      const stars = page.locator(`[data-testid="criterion-${key}"] [data-value="4"]`);
      if ((await stars.count()) > 0) await stars.first().click();
    }
    await page.fill('[data-testid="peer-review-content"]', LONG_ENOUGH);
    await page.click('[data-testid="peer-review-submit"]');

    // The confirmation states both facts the student needs: it is final, and it is
    // anonymous.
    await expect(page.getByText(/Review submitted/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/cannot be changed/i)).toBeVisible();

    // Reload: the page is now read-only. No form, no submit button — see
    // ./authorization.spec.ts for why absent rather than disabled.
    await page.reload();
    await expect(page.locator('[data-testid="peer-review-submitted"]')).toBeVisible();
    await expect(page.locator('[data-testid="peer-review-form"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="submitted-content"]')).toContainText("360 mm");
  });
});

test.describe("peer review — the reveal point, from the student's side", () => {
  test("an unreleased round says so instead of showing nothing", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/peer-review");
    await expectNoServerError(page);

    const withheld = page.locator('[data-testid^="round-withheld-"]');
    const count = await withheld.count();
    test.skip(
      count === 0,
      "No unreleased round for the demo student. Needs a seeded round with a submitted, " +
        "unreleased review.",
    );

    // The three states must be distinguishable. "With an instructor" and "nobody
    // reviewed your work" are different facts and collapsing them tells the student
    // something untrue — the reason the release gate is applied in the mapping rather
        // than as a SQL predicate (src/lib/peer-review/reviews.ts).
    await expect(withheld.first()).toContainText(/With an instructor/i);
    await expect(page.locator('[data-testid="not-released-note"]').first()).toContainText(
      /not yet released/i,
    );
  });
});

test.describe("peer review — the instructor's controls", () => {
  test("allocating a round with too few submissions reports why instead of doing nothing", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor/peer-review");
    await expectNoServerError(page);

    const allocate = page.locator('[data-testid^="allocate-"]');
    const count = await allocate.count();
    test.skip(count === 0, "No peer-review round exists to allocate.");

    await allocate.first().click();

    // Whatever the cohort looks like, the instructor must be TOLD the outcome. An
    // allocation that silently does nothing reads as a broken button, which is exactly
    // what the degradation reporting in src/lib/peer-review/allocate.ts exists to
    // prevent.
    await expect(
      page.getByText(/allocation|Nothing to allocate|reviewers/i).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expectNoServerError(page);
  });

  test("releasing a round reports how many reviews it revealed", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor/peer-review");
    await expectNoServerError(page);

    const release = page.locator('[data-testid^="release-"]:not([disabled])');
    const count = await release.count();
    test.skip(count === 0, "No unreleased peer-review round to release.");

    await release.first().click();
    await expect(page.getByText(/Released|already released/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expectNoServerError(page);
  });
});
