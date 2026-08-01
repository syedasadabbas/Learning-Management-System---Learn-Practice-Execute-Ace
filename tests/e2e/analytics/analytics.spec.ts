// =============================================================================
// ADVANCED ANALYTICS — e2e. Phase 2 feature 7.
// -----------------------------------------------------------------------------
// NOT RUN BY THE AUTHORING AGENT. Eight agents shared one database and one port
// while this was written, so running Playwright would have raced every other
// suite. Everything asserted here is therefore UNVERIFIED BY EXECUTION and the
// coordinator runs it. What IS verified: the 32 vitest cases over the pure modules
// (src/lib/analytics/*.test.ts, run and green), the SQL itself against live Neon
// via scripts/perf-probe.ts, `npx tsc --noEmit` and `npx eslint`. See CHANGELOG.log.
//
// THE THREE PROPERTIES THIS FILE EXISTS FOR
//
// 1. AUTHORIZATION, NEGATIVELY. Analytics is cohort-wide data. A student must not
//    reach either page. The negative is asserted twice on purpose: at the edge
//    (src/middleware.ts rejects the /instructor and /admin prefixes) and against
//    the API, because middleware's own header says it is defence in depth and not
//    the only control. An instructor is additionally refused the ADMIN page —
//    ROLES_SATISFYING.admin is ["admin"] alone — which is the assertion that would
//    catch someone "simplifying" requireRole("admin") to requireRole("instructor").
//
// 2. ONE SURFACE, NOT TWO. The roadmap proposed /instructor/analytics-v2. It does
//    not exist, and a test asserts it does not: two analytics pages over one
//    cohort is the failure mode this feature was explicitly told to avoid, and the
//    cheapest way for it to reappear is somebody adding the route the document
//    asks for. The same section must render on BOTH shipped pages.
//
// 3. PRIVACY. Names appear (an alert list nobody can act on is not a feature);
//    addresses do not. The canary follows the form
//    tests/e2e/leaderboard/leaderboard.spec.ts argued for at length and does NOT
//    use the old `page.content()`-contains-the-shared-domain shape: in `next dev`
//    React's flight server serialises awaited values into the RSC payload as debug
//    info, so the VIEWER'S OWN address is in the markup of any page whose layout
//    awaits requireUser() — a dev-only debug artifact, not a leak. So:
//      * each OTHER seeded address is checked against the served markup (a
//        classmate's address in the payload is a real failure: no server component
//        on this page awaits it), and
//      * "no address at all" is checked against innerText, which excludes
//        <script> and is what a person can actually read.
// =============================================================================

import { expect, test } from "@playwright/test";

import {
  DEMO,
  SEEDED,
  expectNoServerError,
  loginAs,
  otherSeededEmails,
} from "../fixtures";

const INSTRUCTOR_PAGE = "/instructor/analytics";
const ADMIN_PAGE = "/admin/analytics";
const ADVANCED_API = "/api/instructor/analytics/advanced";

// ---------------------------------------------------------------------------
// 1. Authorization — the negatives first.
// ---------------------------------------------------------------------------
test.describe("analytics authorization", () => {
  test("a student cannot reach /instructor/analytics", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto(INSTRUCTOR_PAGE);

    // The edge redirects to /login with ?error=forbidden (see deny() in
    // src/middleware.ts). Asserting the destination rather than a status code
    // because a page navigation follows the redirect.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("advanced-analytics")).toHaveCount(0);
    await expect(page.getByTestId("analytics-risk-alerts")).toHaveCount(0);
  });

  test("a student cannot reach /admin/analytics", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto(ADMIN_PAGE);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("advanced-analytics")).toHaveCount(0);
  });

  test("an INSTRUCTOR cannot reach the admin analytics page", async ({ page }) => {
    // ROLES_SATISFYING.admin is ["admin"] alone. This is the assertion that
    // catches requireRole("admin") being loosened to requireRole("instructor").
    await loginAs(page, "instructor");
    await page.goto(ADMIN_PAGE);
    await expect(page).toHaveURL(/\/login/);
  });

  test("a student is refused the advanced analytics API with an error envelope", async ({
    page,
    request,
  }) => {
    await loginAs(page, "student");
    const response = await page.request.get(ADVANCED_API);
    expect(response.status()).toBe(403);

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("forbidden");
    // The refusal must not leak the data it is refusing.
    expect(body).not.toHaveProperty("data");

    // And anonymously: 401, never 200. `request` carries no session cookie.
    const anon = await request.get(ADVANCED_API);
    expect([401, 403]).toContain(anon.status());
    expect(anon.status()).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 2. One surface, not two.
// ---------------------------------------------------------------------------
test.describe("analytics is one surface", () => {
  test("the roadmap's analytics-v2 route was deliberately NOT created", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    const response = await page.goto("/instructor/analytics-v2");
    expect(response?.status()).toBe(404);
  });

  test("the advanced section renders on the instructor page", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    await expectNoServerError(page);

    // The four pre-existing panels must still be there: this is an extension.
    await expect(page.getByTestId("analytics-progress-chart")).toBeVisible();
    await expect(page.getByTestId("advanced-analytics")).toBeVisible();
    await expect(page.getByTestId("analytics-engagement")).toBeVisible();
    await expect(page.getByTestId("analytics-heatmap")).toBeVisible();
    await expect(page.getByTestId("analytics-risk-alerts")).toBeVisible();
    await expect(page.getByTestId("analytics-grade-distribution")).toBeVisible();
    await expect(page.getByTestId("analytics-problem-difficulty")).toBeVisible();
  });

  test("the SAME section renders on the admin page", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(ADMIN_PAGE);
    await expectNoServerError(page);
    await expect(page.getByTestId("advanced-analytics")).toBeVisible();
    await expect(page.getByTestId("analytics-heatmap")).toBeVisible();
    await expect(page.getByTestId("analytics-risk-alerts")).toBeVisible();
  });

  test("the completion chart shows one row per seeded week, agreeing with the table above it", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    // Chart and table are two renderings of one array, so the count is the seed's
    // week count and not a number this test invents.
    for (let week = 1; week <= SEEDED.weekCount; week += 1) {
      await expect(page.getByTestId(`progress-week-${week}`)).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Privacy.
// ---------------------------------------------------------------------------
test.describe("analytics privacy", () => {
  test("no other seeded account's email address appears in the markup", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    const html = await page.content();
    for (const email of otherSeededEmails("instructor")) {
      expect(html, `${email} must not appear in the analytics markup`).not.toContain(
        email,
      );
    }
  });

  test("no email address is rendered as visible text — not even the viewer's own", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    const visibleText = await page.locator("body").innerText();
    // The shared domain is the right unit for visible text: innerText excludes
    // <script>, so the dev-only RSC debug payload cannot produce a false positive
    // here. This is the assertion that catches an address in a table cell.
    expect(visibleText).not.toContain("@codequeenshub.test");
    expect(visibleText).not.toContain(DEMO.instructor.email);
  });

  test("the advanced API response carries no email field at all", async ({ page }) => {
    await loginAs(page, "instructor");
    const response = await page.request.get(ADVANCED_API);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    for (const row of body.data.risk ?? []) {
      expect(row).not.toHaveProperty("email");
      // Named on purpose: an alert nobody can act on is not an alert.
      expect(typeof row.name).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The zero-denominator contract, and the performance claim.
// ---------------------------------------------------------------------------
test.describe("analytics correctness and cost", () => {
  test("nothing on the page renders NaN, Infinity or undefined", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("undefined");
  });

  test("the heatmap draws the full 7x6 grid, quiet cells included", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    const heatmap = page.getByTestId("analytics-heatmap");
    const total = Number(await heatmap.getAttribute("data-total"));

    // An empty cohort shows a stated empty state instead of a grid; both are
    // correct, so the assertion branches on the fact rather than assuming seeded
    // activity that another agent's reset script may have cleared.
    if (total > 0) {
      await expect(page.getByTestId("heat-1-0")).toBeVisible();
      await expect(page.getByTestId("heat-7-5")).toBeVisible();
      // 7 ISO days x 6 four-hour blocks.
      expect(await page.locator("[data-testid^='heat-']").count()).toBe(42);
    } else {
      await expect(page.getByTestId("heatmap-empty")).toBeVisible();
    }
  });

  test("the grade distribution states its unscored students rather than counting them as F", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    const caption = page.getByTestId("grade-distribution-caption");
    await expect(caption).toBeVisible();
    // Either a real count or the explicit empty state — never a silent F bar.
    const fBar = page.getByTestId("grade-bar-F");
    if ((await fBar.count()) > 0) {
      const fCount = Number(await fBar.getAttribute("data-count"));
      expect(Number.isFinite(fCount)).toBe(true);
    } else {
      await expect(page.getByTestId("grade-distribution-empty")).toBeVisible();
    }
  });

  test("the page states its own cost, and it is one round trip", async ({ page }) => {
    // The performance claim, asserted rather than left in a comment: the section
    // header reports the statement count it used. Measured server-side at 255 ms
    // for both analytics read models in one wave against live Neon
    // (scripts/perf-probe.ts, baseline warm round trip 248 ms).
    await loginAs(page, "instructor");
    await page.goto(INSTRUCTOR_PAGE);
    const header = page.getByTestId("advanced-analytics");
    await expect(header).toContainText(/in 1 database round trip/);
  });

  test("the advanced API reports queryCount 1", async ({ page }) => {
    await loginAs(page, "instructor");
    const body = await (await page.request.get(ADVANCED_API)).json();
    expect(body.data.queryCount).toBe(1);
    // computeMs is milliseconds (metric, house rule) and must be a real number,
    // not a placeholder.
    expect(typeof body.data.computeMs).toBe("number");
    expect(body.data.computeMs).toBeGreaterThanOrEqual(0);
    // 14 gap-free days, quiet days present at zero.
    expect(body.data.daily.length).toBe(14);
    expect(body.data.heatmap.cells.length).toBe(42);
  });

  test("an admin can scope the whole section to one cohort", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`${ADMIN_PAGE}?cohort=1`);
    await expectNoServerError(page);
    await expect(page.getByTestId("advanced-analytics")).toBeVisible();

    // A nonsense cohort must fall back to the all-cohorts view, not 500.
    await page.goto(`${ADMIN_PAGE}?cohort=not-a-number`);
    await expectNoServerError(page);
    await expect(page.getByTestId("advanced-analytics")).toBeVisible();
  });
});
