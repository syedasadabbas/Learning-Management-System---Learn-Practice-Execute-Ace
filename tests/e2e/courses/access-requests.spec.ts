// =============================================================================
// E2E — multiple courses and the access-request flow.
// Owner: courses / access-requests stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Six agents share one dev server on port 3000 and one
// mutable seeded database; running these in parallel with the other streams'
// specs would produce results that mean nothing. The coordinator runs the whole
// suite serially at integration.
//
// PRECONDITION — RUN THIS FIRST, ONCE, BEFORE THE SUITE:
//
//     npx tsx scripts/seed-course-access.ts
//
// It adds two extra courses (the seed is single-course, so without them there is
// nothing to request) and CLEARS any existing request rows for them, so the
// pending -> decided transitions below actually occur. The first test asserts
// the precondition explicitly and fails with that command in the message —
// a missing seed must read as "you did not seed", never as "the feature is
// broken".
//
// THIS SPEC MUTATES ONLY `course_access_requests`, and only rows belonging to the
// demo student and the two extra courses. It takes no quiz, so it cannot consume
// one of the demo student's three attempts, and it does not touch the cohort's
// own course, so no other stream's week/lock/progress assertions are affected.
//
// THE NEGATIVE PATHS ARE ORDERED DELIBERATELY. Each direct-URL refusal is
// asserted at the point in the lifecycle where it matters — before any request
// exists, while one is pending, and after a decline — because "a student cannot
// reach the course before approval" is three different states, and a suite that
// only checks the first would pass against a build that treats `pending` as
// access. Hiding a link is not access control, so every one of these navigates
// by URL rather than by clicking.
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { expectNoServerError, loginAs } from "../fixtures";

/** Titles must match scripts/seed-course-access.ts EXTRA_COURSES. */
const APPROVE_COURSE = "Advanced React Patterns";
const DECLINE_COURSE = "Data Engineering Foundations";

const SEED_HINT =
  "Run `npx tsx scripts/seed-course-access.ts` before this suite — the shared seed is single-course.";

/**
 * The catalog card for a course, located by its visible title rather than by a
 * hardcoded id. Course ids are serial values reassigned by every reseed, so an
 * id in a spec is a test that breaks on a database refresh — the same reasoning
 * `lectures.topic_key` exists for (src/db/schema.ts:172).
 */
function cardFor(page: Page, title: string) {
  return page
    .locator('[data-testid^="course-card-"]')
    .filter({ has: page.getByText(title, { exact: false }) })
    .first();
}

/** The numeric course id, read off the card, so direct-URL tests need no guess. */
async function courseIdFor(page: Page, title: string): Promise<string> {
  const testId = await cardFor(page, title).getAttribute("data-testid");
  const id = testId?.replace("course-card-", "");
  expect(id, `could not resolve the id of "${title}". ${SEED_HINT}`).toBeTruthy();
  return id!;
}

// ===========================================================================
test.describe("course catalog — what a student sees before asking", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("the catalog lists the cohort course as open and the extra courses as not enrolled", async ({
    page,
  }) => {
    await page.goto("/courses");
    await expectNoServerError(page);

    await expect(page.getByTestId("course-catalog")).toBeVisible();

    // The precondition check. Asserted here, in the first test, so a missing
    // seed produces one clear failure instead of eight confusing ones.
    const cards = page.locator('[data-testid^="course-card-"]');
    await expect(cards, SEED_HINT).toHaveCount(3);

    // Exactly one course is open, and it is the cohort's own — the backwards
    // compatibility property the whole design rests on. If this ever reports 0,
    // every existing student has silently lost their course.
    await expect(page.locator('[data-access-state="open"]')).toHaveCount(1);
  });

  test("the open course offers no Request button — there is nothing to grant", async ({
    page,
  }) => {
    await page.goto("/courses");
    const open = page.locator('[data-access-state="open"]').first();
    await expect(open).toHaveAttribute("data-can-request", "false");
  });

  test("an un-enrolled course shows a Request button and no link to its content", async ({
    page,
  }) => {
    await page.goto("/courses");
    const card = cardFor(page, APPROVE_COURSE);
    await expect(card).toHaveAttribute("data-access-state", "none");
    await expect(card).toHaveAttribute("data-can-request", "true");

    // A locked course renders NO anchor at all, the rule WeekCard.tsx follows
    // for a locked week (docs/SUBJECT_SECTIONS.md:105).
    const id = await courseIdFor(page, APPROVE_COURSE);
    await expect(page.getByTestId(`open-course-${id}`)).toHaveCount(0);
    await expect(page.getByTestId(`request-access-${id}`)).toBeVisible();
  });

  test("DIRECT URL to a course with no request is refused before any content is read", async ({
    page,
  }) => {
    await page.goto("/courses");
    const id = await courseIdFor(page, APPROVE_COURSE);

    await page.goto(`/courses/${id}`);
    await expectNoServerError(page);

    await expect(page.getByTestId("course-access-denied")).toHaveAttribute(
      "data-denial",
      "request_required",
    );
    // The week outline must not render on the denied branch at all.
    await expect(page.getByTestId("course-week-outline")).toHaveCount(0);
    await expect(page.getByTestId("course-detail")).toHaveCount(0);
  });

  test("a course id that does not exist is refused with the same wording as one that does", async ({
    page,
  }) => {
    // Probing must not enumerate. Both denials use DENIAL_MESSAGE.not_found.
    for (const bad of ["999999", "0", "-1", "abc"]) {
      await page.goto(`/courses/${bad}`);
      await expect(page.getByTestId("course-access-denied")).toHaveAttribute(
        "data-denial",
        "not_found",
      );
    }
  });
});

// ===========================================================================
test.describe("a student cannot reach the admin decision surface", () => {
  test("the admin queue redirects a student to a forbidden login", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/admin/course-requests");
    // Both the edge (middleware "/admin" -> admin) and requireRole("admin") in
    // the page refuse this; either is sufficient and the observable result is
    // the same redirect.
    await expect(page).toHaveURL(/\/login\?.*error=forbidden/);
    await expect(page.getByTestId("access-request-list")).toHaveCount(0);
  });

  test("an INSTRUCTOR is also refused — approval is admin-only", async ({ page }) => {
    // ROLES_SATISFYING.instructor is ["instructor","admin"], so the (staff)
    // layout admits an instructor; the page's own requireRole("admin") is what
    // turns them away. If this test starts failing, someone has re-levelled
    // COURSE_APPROVAL_AUTH — a reviewable decision, not a silent one.
    await loginAs(page, "instructor");
    await page.goto("/admin/course-requests");
    await expect(page).toHaveURL(/\/login\?.*error=forbidden/);
  });
});

// ===========================================================================
test.describe("request -> approve -> access", () => {
  test("a student files a request and sees it as pending", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/courses");

    const id = await courseIdFor(page, APPROVE_COURSE);
    await page.getByTestId(`request-access-${id}`).click();
    await page.getByTestId(`request-message-${id}`).fill("I have finished the HTML track.");
    await page.getByTestId(`submit-request-${id}`).click();

    // The action revalidates /courses, so the server sends back the real row —
    // this asserts the DATABASE state, not an optimistic client override.
    await expect(cardFor(page, APPROVE_COURSE)).toHaveAttribute(
      "data-access-state",
      "pending",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId(`course-status-${id}`)).toContainText(/admin/i);
  });

  test("A PENDING REQUEST IS NOT ACCESS — the direct URL is still refused", async ({
    page,
  }) => {
    // The single most important assertion in this file. A build that treats
    // `pending` as access passes every other test here.
    await loginAs(page, "student");
    await page.goto("/courses");
    const id = await courseIdFor(page, APPROVE_COURSE);

    await page.goto(`/courses/${id}`);
    await expect(page.getByTestId("course-access-denied")).toHaveAttribute(
      "data-denial",
      "pending",
    );
    await expect(page.getByTestId("course-week-outline")).toHaveCount(0);
  });

  test("the request appears on the admin queue with the student named", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/course-requests");
    await expectNoServerError(page);

    const list = page.getByTestId("access-request-list").first();
    await expect(list).toBeVisible();
    await expect(list).toContainText(APPROVE_COURSE);
    await expect(list).toContainText("I have finished the HTML track.");
  });

  test("an admin approves it", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/course-requests");

    const row = page
      .locator('[data-testid^="access-request-"][data-status="pending"]')
      .filter({ has: page.getByText(APPROVE_COURSE, { exact: false }) })
      .first();
    const testId = await row.getAttribute("data-testid");
    const requestId = testId!.replace("access-request-", "");

    await page.getByTestId(`approve-request-${requestId}`).click();
    await expect(row).toHaveAttribute("data-status", "approved", { timeout: 15_000 });
  });

  test("the student now sees Enrolled and CAN open the course", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/courses");

    const card = cardFor(page, APPROVE_COURSE);
    await expect(card).toHaveAttribute("data-access-state", "approved");

    const id = await courseIdFor(page, APPROVE_COURSE);
    await page.getByTestId(`open-course-${id}`).click();

    await expect(page).toHaveURL(new RegExp(`/courses/${id}$`));
    await expect(page.getByTestId("course-detail")).toBeVisible();
    await expect(page.getByTestId("access-via")).toContainText(/approved/i);
    await expect(page.getByTestId("course-access-denied")).toHaveCount(0);
  });

  test("re-requesting an approved course is refused rather than resetting it to pending", async ({
    page,
  }) => {
    // The `setWhere status <> 'approved'` fence in upsertRequest. Without it a
    // student could revoke their own access by clicking Request again.
    await loginAs(page, "student");
    await page.goto("/courses");
    const id = await courseIdFor(page, APPROVE_COURSE);
    // The button is not rendered at all for an approved course, which is the
    // observable half of the rule; the server-side half is unit-tested in
    // src/lib/courses/policy.test.ts ("refuses a student who already has access").
    await expect(page.getByTestId(`request-access-${id}`)).toHaveCount(0);
    await expect(cardFor(page, APPROVE_COURSE)).toHaveAttribute("data-can-request", "false");
  });
});

// ===========================================================================
test.describe("request -> decline -> a visible, explained refusal", () => {
  test("a student requests the second extra course", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/courses");

    const id = await courseIdFor(page, DECLINE_COURSE);
    await page.getByTestId(`request-access-${id}`).click();
    await page.getByTestId(`submit-request-${id}`).click();

    await expect(cardFor(page, DECLINE_COURSE)).toHaveAttribute(
      "data-access-state",
      "pending",
      { timeout: 15_000 },
    );
  });

  test("an admin declines it with a note", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/course-requests");

    const row = page
      .locator('[data-testid^="access-request-"][data-status="pending"]')
      .filter({ has: page.getByText(DECLINE_COURSE, { exact: false }) })
      .first();
    const requestId = (await row.getAttribute("data-testid"))!.replace("access-request-", "");

    await page.getByTestId(`decision-note-${requestId}`).fill("Finish the current course first.");
    await page.getByTestId(`reject-request-${requestId}`).click();
    await expect(row).toHaveAttribute("data-status", "rejected", { timeout: 15_000 });
  });

  test("the student sees Declined, the reason, and still cannot open it", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/courses");

    const card = cardFor(page, DECLINE_COURSE);
    await expect(card).toHaveAttribute("data-access-state", "rejected");

    const id = await courseIdFor(page, DECLINE_COURSE);
    await expect(page.getByTestId(`course-decision-note-${id}`)).toContainText(
      "Finish the current course first.",
    );

    // A DECLINED REQUEST IS NOT ACCESS, and the refusal says which of the two
    // "no" states it is — a rejection that reads as pending leaves a student
    // waiting forever for an answer they already got.
    await page.goto(`/courses/${id}`);
    await expect(page.getByTestId("course-access-denied")).toHaveAttribute(
      "data-denial",
      "rejected",
    );
    await expect(page.getByTestId("denial-note")).toContainText(
      "Finish the current course first.",
    );
    await expect(page.getByTestId("course-week-outline")).toHaveCount(0);
  });

  test("a declined student may re-apply", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/courses");
    const id = await courseIdFor(page, DECLINE_COURSE);
    // A rejection is not a lifetime ban; the alternative is an email to an admin
    // that leaves no record on the queue.
    await expect(page.getByTestId(`request-access-${id}`)).toContainText(/again/i);
  });
});

// ===========================================================================
test.describe("staff", () => {
  test("an instructor reads every course without filing a request", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/courses");
    await expectNoServerError(page);

    await expect(page.getByTestId("staff-catalog-note")).toBeVisible();

    const id = await courseIdFor(page, APPROVE_COURSE);
    await page.goto(`/courses/${id}`);
    await expect(page.getByTestId("course-detail")).toBeVisible();
    await expect(page.getByTestId("access-via")).toContainText(/staff/i);
  });

  test("staff access does not extend to a course that does not exist", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/courses/999999");
    await expect(page.getByTestId("course-access-denied")).toHaveAttribute(
      "data-denial",
      "not_found",
    );
  });
});

// ===========================================================================
test.describe("anonymous", () => {
  test("both course surfaces redirect a signed-out visitor to login", async ({ page }) => {
    // Middleware's /courses prefix row. Asserted because a page added under an
    // unlisted prefix slips through the matcher entirely (src/middleware.ts:24).
    await page.goto("/courses");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/courses/1");
    await expect(page).toHaveURL(/\/login/);
  });
});
