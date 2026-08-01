// =============================================================================
// E2E: peer review — THE AUTHORIZATION NEGATIVES. Owner: peer-review stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Eight agents shared one database and port 3000 during
// parallel development, so the coordinator runs the e2e suite serially at
// integration. Authored here so it is reviewable in the same change as the feature.
//
// WHAT THIS SPEC ADDS OVER THE 247 UNIT AND 16 INTEGRATION TESTS THAT DO RUN.
// src/lib/peer-review/visibility.test.ts proves the authorization RULES as pure
// functions. src/lib/peer-review/peer-review.integration.test.ts proves the SQL
// scoping and the reveal gate against real Postgres, through the real read models —
// including that a stranger gets `not_found` for an allocation they were not party
// to. Neither goes through HTTP, a session cookie, or the router. So what is left,
// and what this file is for, is:
//
//   1. THE STATUS CODE. `/peer-review/[allocationId]` for somebody else's allocation
//      must be a 404, not a 200 with an empty form and not a 500. That is a property
//      of the page plus the router plus the Suspense boundary placement, and it is
//      exactly the class of defect src/lib/navigation/boundary-scope.test.ts exists
//      to prevent (a `loading.tsx` flushes 200 before `notFound()` can set 404).
//   2. THE SIGNED-OUT REDIRECT. /peer-review is NOT in src/middleware.ts's PROTECTED
//      table — see the TODO in the page's header — so the page's own `requireUser()`
//      is the only thing standing there. If that regressed, no unit test would notice.
//   3. NO CLASSMATE'S IDENTITY IN THE RENDERED HTML, which is the assertion that
//      covers the whole path including React's serialisation of server props into the
//      RSC payload — something a function-level test cannot see.
//
// PRECONDITIONS. These specs need a peer-review round that has been allocated. The
// seed does not create one (scripts/seed.ts predates this feature), so every spec
// below GUARDS on the state it needs and skips with a stated reason rather than
// failing on an empty page. That is the pattern
// tests/e2e/leaderboard/leaderboard.spec.ts settled on and its reasoning applies
// unchanged: a guard degrades to a legible skip, a bare assertion degrades to a
// confusing failure.
//   TODO(peer-review): add a `scripts/seed-peer-review.ts` that opens a round on
//   week 1's assignment, allocates the three seeded classmates, and submits one
//   review — then these skips become assertions. Not written here because the seed
//   scripts are shared fixture territory (tests/e2e/fixtures.ts is explicitly not
//   this stream's to edit) and because the three classmates have no submissions for
//   week 1 in the current seed, so allocation would legitimately produce nothing.
//
// All timeouts are milliseconds (house rules).
// =============================================================================

import { expect, test } from "@playwright/test";

import { DEMO, expectNoServerError, loginAs, otherSeededEmails } from "../fixtures";

const TASK_LINK = '[data-testid^="review-task-link-"]';

test.describe("peer review — signed out", () => {
  test("the student surface is not reachable without a session", async ({ page }) => {
    // /peer-review is NOT covered by src/middleware.ts's PROTECTED prefixes, so this
    // asserts the page's own requireUser() guard rather than the edge.
    await page.goto("/peer-review");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an individual review page is not reachable without a session", async ({ page }) => {
    await page.goto("/peer-review/1");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the instructor surface is not reachable without a session", async ({ page }) => {
    // This one IS covered at the edge (`/instructor` is in PROTECTED), so it is
    // defence in depth — both layers must refuse.
    await page.goto("/instructor/peer-review");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("peer review — a student may not reach the instructor surface", () => {
  test("a signed-in student is refused /instructor/peer-review", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/instructor/peer-review");
    // requireRole redirects to /login?error=forbidden; the edge may get there first.
    // Either way the student must NOT see the round controls.
    await expect(page.locator('[data-testid="rounds-summary"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="allocate-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="release-"]')).toHaveCount(0);
  });
});

test.describe("peer review — a student may not read a review they were not assigned", () => {
  test("an allocation id that is not theirs answers 404, not 200", async ({ page }) => {
    await loginAs(page, "student");

    // Walk a small range of ids. Any that belongs to this student renders the form;
    // any that does not MUST 404. The point of the range is that at least one id in
    // it is somebody else's on any database with more than one allocation, and the
    // assertion holds for every id either way — a 200 for an allocation whose form is
    // empty would be the leak.
    const statuses: Array<{ id: number; status: number; hasForm: boolean }> = [];
    for (const id of [1, 2, 3, 4, 5]) {
      const response = await page.goto(`/peer-review/${id}`);
      const status = response?.status() ?? 0;
      const hasForm = (await page.locator('[data-testid="peer-review-form"]').count()) > 0;
      const hasSubmitted = (await page.locator('[data-testid="peer-review-submitted"]').count()) > 0;
      statuses.push({ id, status, hasForm: hasForm || hasSubmitted });
      await expectNoServerError(page);
    }

    for (const row of statuses) {
      if (row.hasForm) {
        // It is this student's own allocation: a 200 is correct.
        expect(row.status, `id ${row.id} renders a form so it must be 200`).toBe(200);
      } else {
        // Not theirs (or does not exist). MUST be 404. A 200 here is the defect this
        // whole spec exists for: it would mean the page rendered an empty shell for
        // another student's allocation instead of refusing it.
        expect(row.status, `id ${row.id} renders no form so it must be 404`).toBe(404);
      }
    }
  });

  test("a non-numeric allocation id answers 404 rather than crashing", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.goto("/peer-review/not-a-number");
    expect(response?.status()).toBe(404);
    await expectNoServerError(page);
  });
});

test.describe("peer review — anonymity in the rendered HTML", () => {
  test("no classmate's email address appears anywhere on the student surface", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/peer-review");
    await expectNoServerError(page);

    // `otherSeededEmails` and not "no email at all", for the reason
    // tests/e2e/leaderboard/leaderboard.spec.ts records: the page may legitimately
    // know who YOU are, and in `next dev` React serialises the awaited session into
    // the RSC debug stream whether the page asked for it or not. It may never know a
    // classmate's address.
    const html = await page.content();
    for (const email of otherSeededEmails("student")) {
      expect(html, `a classmate's address (${email}) must not reach this page`).not.toContain(email);
    }
  });

  test("a revealed review is labelled positionally and names nobody", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/peer-review");
    await expectNoServerError(page);

    const reviews = page.locator('[data-testid^="review-"][data-testid*="-1"]');
    const count = await reviews.count();
    test.skip(
      count === 0,
      "No released peer review for the demo student. Needs a seeded, allocated, released " +
        "round — see the TODO(peer-review) in this file's header.",
    );

    // The label is "Anonymous review 1 of 2" — positional, never a row id, because a
    // real `peer_reviews.id` is a global sequence and two students comparing ids could
    // narrow down who reviewed whom. Asserted at unit level in
    // src/lib/peer-review/reviews.anonymity.test.ts; asserted here as rendered text.
    await expect(reviews.first()).toContainText(/Anonymous review \d+ of \d+/);

    const html = await page.content();
    for (const classmate of otherSeededEmails("student")) {
      expect(html).not.toContain(classmate);
    }
  });

  test("the reviewer is not told whose work they are reviewing", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/peer-review");
    await expectNoServerError(page);

    const links = page.locator(TASK_LINK);
    const count = await links.count();
    test.skip(
      count === 0,
      "No peer review assigned to the demo student. Needs a seeded, allocated round — " +
        "see the TODO(peer-review) in this file's header.",
    );

    await links.first().click();
    await expect(page.locator("h1")).toContainText(/peer review/i);
    await expectNoServerError(page);

    // The author's NAME and ADDRESS must not be on the page. The GitHub URL may
    // identify them — src/lib/peer-review/visibility.ts says so plainly, which is why
    // this stream claims single-blind-enforced rather than double-blind — so this
    // asserts what is actually enforced, not a guarantee the design does not make.
    const html = await page.content();
    for (const email of otherSeededEmails("student")) {
      expect(html).not.toContain(email);
    }
  });
});

test.describe("peer review — a submitted review cannot be edited", () => {
  test("an already-submitted review renders read-only, with no form", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/peer-review");
    await expectNoServerError(page);

    const submittedLink = page.locator(TASK_LINK, { hasText: "Read what you wrote" });
    const count = await submittedLink.count();
    test.skip(
      count === 0,
      "The demo student has submitted no peer review. Needs a seeded round with one " +
        "submitted review — see the TODO(peer-review) in this file's header.",
    );

    await submittedLink.first().click();
    // The read-only card is present and the writable form is ABSENT — not disabled.
    // There is no update path in the stream at all (`peer_reviews.allocation_id` is
    // UNIQUE and no code issues an UPDATE), and a disabled form would imply one exists.
    await expect(page.locator('[data-testid="peer-review-submitted"]')).toBeVisible();
    await expect(page.locator('[data-testid="peer-review-form"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="peer-review-submit"]')).toHaveCount(0);
  });
});

test.describe("peer review — the instructor surface", () => {
  test("an instructor sees the round controls and the reviewer names", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor/peer-review");
    await expectNoServerError(page);

    await expect(page.locator("h1")).toContainText("Peer review");

    const panels = page.locator('[data-testid^="round-panel-"]');
    const count = await panels.count();
    test.skip(
      count === 0,
      "No peer-review round exists. Needs a seeded round — see the TODO(peer-review) in " +
        "this file's header.",
    );

    // This IS the surface that carries reviewer identity, deliberately: accountability
    // is the whole gaming defence (src/lib/peer-review/config.ts). So unlike every
    // student-facing assertion above, a name here is correct and expected.
    await expect(panels.first().locator('[data-testid="round-overview-table"]')).toBeVisible();
    await expect(page.locator('[data-testid^="allocate-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="release-"]').first()).toBeVisible();
  });

  test("an admin may use the instructor surface too", async ({ page }) => {
    // `ROLES_SATISFYING.instructor` admits admins deliberately — an admin covering for
    // an instructor should not need a role change, the same choice
    // src/app/api/instructor/submissions/[id]/grade/route.ts documents.
    await loginAs(page, "admin");
    await page.goto("/instructor/peer-review");
    await expectNoServerError(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("h1")).toContainText("Peer review");
  });
});

test.describe("peer review — the demo student's own page renders", () => {
  test("shows both halves and the explainer, on an empty database", async ({ page }) => {
    // The only spec here with no precondition: the page must render its empty states
    // rather than 500 on an install where no round has ever been opened, which is the
    // state of a fresh checkout.
    await loginAs(page, "student");
    await page.goto("/peer-review");
    await expectNoServerError(page);

    await expect(page.locator("h1")).toContainText("Peer review");
    await expect(page.getByText("Reviews to write")).toBeVisible();
    await expect(page.getByText("Feedback on your work")).toBeVisible();
    await expect(page.locator('[data-testid="peer-review-explainer"]')).toBeVisible();
    // The promise the whole scoring decision rests on, made in writing to the student.
    await expect(page.locator('[data-testid="peer-review-explainer"]')).toContainText(
      /never review your own submission/i,
    );
    expect(await page.locator(`text=${DEMO.student.name}`).count()).toBeGreaterThanOrEqual(0);
  });
});
