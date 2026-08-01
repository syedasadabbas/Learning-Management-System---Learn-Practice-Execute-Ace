// =============================================================================
// PENALTIES + ATTENDANCE E2E — owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM: nine agents share port 3000, so the coordinator runs
// the suite serially at integration. Authored to be runnable as-is.
//
// Runs against the REAL seeded database (see playwright.config.ts). What is under
// test is database state — an attendance row that updates on re-tick, and a
// participation figure derived from it — which is exactly what a mock could not
// prove.
//
// ACCUMULATING ROWS: recording attendance writes/updates rows for the seeded demo
// student and never deletes them. That is deliberate (the same reasoning as the
// auth spec): a spec that cleans up after itself cannot prove the write landed.
// The unique index on (studentId, lectureId) means repeat runs update one row
// rather than growing the table.
//
// Timeouts are in milliseconds (metric units, per house rules).
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { expectNoServerError, loginAs, SEEDED } from "../fixtures";

/** Attendance is instructor-only, so every test signs in as staff first. */
async function gotoAttendance(page: Page): Promise<void> {
  await loginAs(page, "instructor");
  await page.goto("/attendance");
  await expectNoServerError(page);
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
}

test.describe("instructor attendance marking", () => {
  test("the attendance page lists a week picker and a grid", async ({ page }) => {
    await gotoAttendance(page);

    // The seed guarantees four weeks.
    for (let week = 1; week <= SEEDED.weekCount; week += 1) {
      await expect(page.getByTestId(`attendance-week-${week}`)).toBeVisible();
    }
    await expect(page.getByTestId("attendance-table")).toBeVisible();
  });

  test("ticking a lecture records attendance, and re-ticking updates it", async ({ page }) => {
    await gotoAttendance(page);

    const firstBox = page.getByTestId("attendance-table").locator('input[type="checkbox"]').first();
    await expect(firstBox).toBeVisible();

    const wasChecked = await firstBox.isChecked();

    // ---- Mark -------------------------------------------------------------
    await firstBox.setChecked(!wasChecked);
    await expect(firstBox).toBeChecked({ checked: !wasChecked });

    // The write is a server action; the row must survive a full reload.
    await page.reload();
    const reloaded = page
      .getByTestId("attendance-table")
      .locator('input[type="checkbox"]')
      .first();
    await expect(reloaded).toBeChecked({ checked: !wasChecked });

    // ---- Re-mark the SAME (student, lecture): must update, not 500 --------
    await reloaded.setChecked(wasChecked);
    await expect(reloaded).toBeChecked({ checked: wasChecked });
    await expectNoServerError(page);

    await page.reload();
    await expect(
      page.getByTestId("attendance-table").locator('input[type="checkbox"]').first(),
    ).toBeChecked({ checked: wasChecked });
  });

  test("participation reflects the 80% attendance minimum", async ({ page }) => {
    await gotoAttendance(page);

    const table = page.getByTestId("attendance-table");
    const firstRow = table.locator("tbody tr").first();
    const boxes = firstRow.locator('input[type="checkbox"]');
    const lectureCount = await boxes.count();
    test.skip(lectureCount === 0, "Seeded week has no lectures to mark.");

    const participation = firstRow.locator('[data-testid^="participation-"]');

    // ---- Full attendance: participation must be above zero ----------------
    //
    // Each toggle fires a server action. `setChecked` resolves when the DOM
    // reflects the click, NOT when the write has committed — so ticking three
    // boxes and reloading immediately raced: only 2 of 3 rows landed, attendance
    // came out at 67% (below the 80% minimum) and participation was legitimately
    // 0. That read as a product bug and was a test bug. Wait for each write.
    for (let i = 0; i < lectureCount; i += 1) {
      await boxes.nth(i).setChecked(true);
      await page.waitForLoadState("networkidle");
    }

    // Parsed numerically, NOT via not.toContainText("0/10").
    //
    // That substring assertion could never pass: full marks render "10/10", and
    // "10/10" CONTAINS "0/10". So zero failed it (correctly) and a perfect score
    // failed it too (incorrectly), which is what happened here — the server was
    // returning points: 10 while the test insisted it had not.
    //
    // toPass retries the reload as well as the assertion, so a write still in
    // flight is tolerated without a fixed sleep.
    await expect(async () => {
      await page.reload();
      const text = await page
        .getByTestId("attendance-table")
        .locator("tbody tr")
        .first()
        .locator('[data-testid^="participation-"]')
        .innerText();
      const points = Number(text.trim().split("/")[0]);
      expect(points, `participation cell read "${text}"`).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });

    // ---- Drop below 80%: participation must fall to zero ------------------
    // Clearing every box is unambiguously below the minimum whatever the
    // lecture count, so the assertion does not depend on the seed's arithmetic.
    const rowAfterReload = page.getByTestId("attendance-table").locator("tbody tr").first();
    const boxesAfter = rowAfterReload.locator('input[type="checkbox"]');
    for (let i = 0; i < lectureCount; i += 1) {
      await boxesAfter.nth(i).setChecked(false);
      await page.waitForLoadState("networkidle");
    }
    // Also leaves the row cleared, so a re-run starts from a known state.
    // Parsed numerically for the same reason as above.
    await expect(async () => {
      await page.reload();
      const text = await page
        .getByTestId("attendance-table")
        .locator("tbody tr")
        .first()
        .locator('[data-testid^="participation-"]')
        .innerText();
      const points = Number(text.trim().split("/")[0]);
      expect(points, `participation cell read "${text}"`).toBe(0);
    }).toPass({ timeout: 20_000 });

    void participation;
  });

  test("a student cannot reach the attendance page", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/attendance");

    // requireRole("instructor") redirects a signed-in non-staff user to
    // /login?error=forbidden.
    await expect(page).toHaveURL(/error=forbidden/, { timeout: 15_000 });
  });
});

test.describe("student notices", () => {
  // TODO(test): the student-facing notices page is NOT owned by this stream.
  // `(app)/me/**` belongs to progress-tracking and the frozen ROUTES map has no
  // penalty endpoint, so this stream ships the view as the `PenaltyList`
  // component plus `penaltySummary()` / `issuePenaltyAction()` server functions.
  // Once whichever stream owns `(app)/me` mounts PenaltyList at /me/notices,
  // replace this placeholder with: instructor issues a warning via
  // issuePenaltyAction -> student loads /me/notices -> the warning is listed with
  // its severity badge -> instructor clears it -> the student sees it struck
  // through and it no longer counts toward escalation.
  // Flagged to the coordinator; blocker is cross-stream page ownership, not logic.
  test.fixme("instructor issues a warning and the student sees it", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/me/notices");
    await expect(page.getByTestId("penalty-list")).toBeVisible();
  });
});
