// =============================================================================
// ui-shell e2e — INSTANT PAGE TRANSITIONS.
// -----------------------------------------------------------------------------
// Owner: ui-shell stream (navigation).
//
// WHAT IS UNDER TEST, AND WHY IT NEEDS A REAL BROWSER
//
// The change being verified is that a click is acknowledged immediately and the
// destination paints a skeleton, instead of the previous page sitting frozen
// for the whole server render. Those pages are `force-dynamic` against Neon and
// cost 260-1000 ms (scripts/perf-roundtrips.ts, scripts/perf-probe.ts,
// 2026-07-31), and none of that behaviour exists outside a real App Router:
// vitest can prove NavLinkItem renders a spinner when `pending` is true, but
// only a browser can prove `pending` ever BECOMES true.
//
// THE RACE, AND HOW IT IS REMOVED
//
// A prefetched navigation on a fast local connection can complete in a few
// milliseconds, so polling for a spinner would be flaky in exactly the
// situation the feature is working best. Every timing-sensitive test below
// therefore DELAYS the server's navigation response with page.route() — the RSC
// request only, never the prefetch — so the pending window is deterministic and
// wide. The delay makes the assertions stable; it does not manufacture the
// behaviour, which is why the "no full document reload" test needs no delay at
// all.
//
// WHERE THE BOUNDARIES LIVE NOW, because four of the eight specs below used to
// fail and the reason was placement, not assertion. The `loading.tsx` files were
// briefly at the ROUTE GROUP — (app)/loading.tsx and (staff)/loading.tsx — and a
// group-level boundary shows only on FIRST ENTRY into the group, never when one
// child segment swaps for a sibling. So the four specs here that exercise a hard
// page load passed and the four that exercise a sidebar click failed, which is
// exactly the behaviour the feature existed to provide. The boundaries are now at
// the leaf of each route, where a sibling swap does re-enter them.
//
// The same placement broke something these specs did NOT assert, and that
// omission is why it shipped: a Suspense boundary commits HTTP 200 the moment its
// fallback flushes, so every `notFound()` beneath one answered 200 while
// rendering the not-found UI. Seven specs in four OTHER streams caught it. The
// "404s survive their loading boundary" block at the bottom of this file is that
// missing assertion, written from this stream's side — the stream that adds the
// boundaries is the one that has to prove it did not break the status codes.
//
// NOTE: these specs were WRITTEN but NOT RUN by the agent that added them —
// six agents share one seeded database and port 3000, so the e2e suite is run
// serially afterwards by the coordinator. They are read-only (they log in and
// navigate; nothing here writes), so they are safe to interleave with other
// streams' specs.
// =============================================================================

import { test, expect, type Page, type Route } from "@playwright/test";

import { loginAs } from "../fixtures";

/** How long a throttled navigation is held open, in milliseconds. Comfortably
 *  longer than the slowest measured page (1002 ms, /problems) so the pending
 *  window cannot close before an assertion runs, and comfortably under the
 *  30 s test timeout in playwright.config.ts. */
const NAV_DELAY_MS = 2_000;

/**
 * Hold back the App Router's navigation fetches so the pending state is
 * observable.
 *
 * Only requests carrying `RSC: 1` WITHOUT `Next-Router-Prefetch: 1` are
 * delayed. Prefetches are deliberately left at full speed: the loading shell
 * arriving early is precisely the mechanism under test, and slowing it would
 * test the opposite of the change.
 */
async function throttleNavigation(page: Page): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const headers = route.request().headers();
    if (headers["rsc"] === "1" && headers["next-router-prefetch"] !== "1") {
      await new Promise((resolve) => setTimeout(resolve, NAV_DELAY_MS));
    }
    await route.continue();
  });
}

function sidebarLink(page: Page, href: string) {
  return page.locator(`[data-testid="sidebar-link"][href="${href}"]`);
}

test.describe("instant page transitions", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test("the clicked nav row is marked pending, and the skeleton paints, while the server is still working", async ({
    page,
  }) => {
    await throttleNavigation(page);

    const link = sidebarLink(page, "/leaderboard");
    await link.click();

    // Both of these must be true DURING the navigation, not after it. Before
    // this change neither existed: the row did not change and the old page
    // stayed on screen untouched for the full server render.
    await expect(link.locator('[data-pending="true"]')).toBeVisible({
      timeout: 1_000,
    });
    await expect(page.getByTestId("page-skeleton")).toBeVisible({
      timeout: 1_000,
    });

    // ...and both must go away when the real page arrives.
    await expect(page.getByTestId("page-skeleton")).toBeHidden({
      timeout: 15_000,
    });
    await expect(link.locator('[data-pending="true"]')).toHaveCount(0);
  });

  test("the skeleton matches the destination's shape, not a generic block", async ({
    page,
  }) => {
    await throttleNavigation(page);

    // /leaderboard is a table of standings; /weeks is a grid of week cards.
    // A skeleton that promised the wrong structure would make the page appear
    // to change layout twice, which is worse than no skeleton.
    await sidebarLink(page, "/leaderboard").click();
    await expect(page.getByTestId("page-skeleton")).toHaveAttribute(
      "data-shape",
      "table",
    );
    await expect(page.getByTestId("page-skeleton")).toBeHidden({
      timeout: 15_000,
    });

    await sidebarLink(page, "/weeks").click();
    await expect(page.getByTestId("page-skeleton")).toHaveAttribute(
      "data-shape",
      "cards",
    );
  });

  test("the top bar and sidebar are NOT torn down by a navigation", async ({
    page,
  }) => {
    // The loading boundary is now at the leaf of each route — e.g.
    // src/app/(app)/weeks/(index)/loading.tsx — which is DEEPER than
    // (app)/layout.tsx, so the shell is above every boundary and cannot be
    // inside one. If a boundary were ever hoisted to src/app/ the whole chrome
    // would blank on every click and the session guard in the layout would re-run
    // inside the boundary.
    //
    // Proven by tagging the live DOM node: a property set on the element cannot
    // survive either a remount or a full document load, so if it is still there
    // afterwards the same node stayed mounted throughout.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="top-bar"]');
      (el as unknown as Record<string, unknown>).__navProbe = "kept";
      (window as unknown as Record<string, unknown>).__navProbe = "kept";
    });

    await sidebarLink(page, "/weeks").click();
    await expect(page).toHaveURL(/\/weeks$/);
    await expect(page.getByTestId("page-skeleton")).toBeHidden({
      timeout: 15_000,
    });

    const survived = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="top-bar"]');
      return {
        node: (el as unknown as Record<string, unknown>)?.__navProbe ?? null,
        win: (window as unknown as Record<string, unknown>).__navProbe ?? null,
      };
    });
    expect(
      survived.win,
      "a full document reload would have discarded window state — this must be a client-side navigation",
    ).toBe("kept");
    expect(
      survived.node,
      "the top bar remounted, which means the loading boundary is above the layout chrome",
    ).toBe("kept");
  });

  test("the active nav row moves at click time, before the page arrives", async ({
    page,
  }) => {
    await throttleNavigation(page);

    const dashboard = sidebarLink(page, "/dashboard");
    const weeks = sidebarLink(page, "/weeks");
    await expect(dashboard).toHaveAttribute("data-active", "true");

    await weeks.click();
    // The App Router commits the URL immediately, so usePathname — and with it
    // the active highlight and the skeleton's shape — flips within the pending
    // window rather than after the round trip.
    await expect(weeks).toHaveAttribute("data-active", "true", {
      timeout: 1_000,
    });
    await expect(dashboard).toHaveAttribute("data-active", "false");
  });

  test("the loading state is announced, not just drawn", async ({ page }) => {
    await throttleNavigation(page);
    await sidebarLink(page, "/weeks").click();

    const status = page.getByRole("status").filter({ hasText: "Loading" });
    await expect(status).toHaveAttribute("aria-busy", "true");
  });

  test("prefers-reduced-motion stops the shimmer without removing the skeleton", async ({
    page,
  }) => {
    // The rule from src/lib/exercises/reduced-motion.ts: reduced motion degrades
    // the presentation and never removes the information. So the skeleton must
    // still be there, laid out identically, with no running animation.
    //
    // The element under test is a BAR, not the wrapper. PageSkeleton used to
    // animate one container with `motion-safe:animate-pulse`; it now composes
    // SkeletonBar from src/components/ui/Skeleton.tsx, so there is a single
    // shimmer vocabulary in the product and the `ui-skeleton` class in
    // globals.css is what the reduced-motion override is written against.
    // Targeting the wrapper here would now pass vacuously — it carries no
    // animation in either mode.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await throttleNavigation(page);

    await sidebarLink(page, "/weeks").click();
    const skeleton = page.getByTestId("page-skeleton");
    await expect(skeleton).toBeVisible({ timeout: 1_000 });

    const bar = skeleton.getByTestId("skeleton-bar").first();
    await expect(bar).toBeVisible();

    // `toHaveCSS`, NOT `evaluate(getComputedStyle)`. PageSkeleton picks its shape
    // from usePathname, and the App Router commits the destination URL during the
    // navigation — so the skeleton re-renders with the destination's shape while
    // this is being read, and the bar element the locator first resolved to is
    // replaced. A one-shot evaluate that lands on the detached node gets EMPTY
    // STRINGS back from getComputedStyle (that is what a detached element
    // returns), which reported as `expected "none", received ""` and looked like
    // a missing CSS rule rather than a race. toHaveCSS re-resolves and retries.
    await expect(
      bar,
      "globals.css must set `animation: none` on .ui-skeleton under prefers-reduced-motion",
    ).toHaveCSS("animation-name", "none");
    await expect(
      bar,
      "a frozen half-lit gradient reads as a rendering bug, so the sweep is flattened too",
    ).toHaveCSS("background-image", "none");

    // Still a skeleton, not an empty screen.
    await expect(skeleton).toHaveAttribute("data-shape", "cards");
  });

  test("the shimmer really runs when motion is allowed, and it is the shared one", async ({
    page,
  }) => {
    // The counterpart to the spec above, and the one that catches the drift
    // rather than the accessibility rule. Two components on this branch drew
    // placeholder bars two different ways — `motion-safe:animate-pulse` here and
    // the `ui-skeleton` gradient sweep in the ui primitive — and both were
    // individually correct, so nothing failed. Asserting the computed
    // animation-name pins the product to ONE of them.
    await throttleNavigation(page);
    await sidebarLink(page, "/weeks").click();

    const bar = page.getByTestId("page-skeleton").getByTestId("skeleton-bar").first();
    await expect(bar).toBeVisible({ timeout: 1_000 });
    // Retry-safe: see the note in the reduced-motion spec above about the bar
    // being replaced when the skeleton re-renders for the destination's shape.
    await expect(bar).toHaveCSS("animation-name", "ui-skeleton-shimmer");
  });

  test("the spinner is still rendered under reduced motion, only unspun", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    // THROTTLES PREFETCH TOO, unlike every other spec here, and the difference is
    // the whole reason this test can be read at all.
    //
    // `useLinkStatus` reports pending until the router COMMITS the navigation, not
    // until the data arrives. In a production build the sidebar's links are
    // prefetched on load, so the commit is served from the router cache in about
    // 250 ms however long the server then takes — measured: pending was already
    // false at t=250 ms with a 3 000 ms delay on the navigation response. The
    // spinner therefore existed for ~250 ms, and a retrying CSS assertion
    // outlived it and reported "element(s) not found".
    //
    // Delaying prefetch as well leaves the router with nothing cached, so the
    // commit has to wait for the server and the pending window is genuinely
    // NAV_DELAY_MS wide. This spec is about the pending indicator, not about the
    // skeleton, so removing the prefetch costs it no coverage.
    await page.route("**/*", async (route: Route) => {
      if (route.request().headers()["rsc"] === "1") {
        await new Promise((resolve) => setTimeout(resolve, NAV_DELAY_MS));
      }
      await route.continue();
    });

    const link = sidebarLink(page, "/weeks");
    await link.click();

    const spinner = link.getByTestId("nav-link-spinner");
    await expect(spinner).toBeVisible({ timeout: 1_000 });
    // Retry-safe, and here it matters more than anywhere: the spinner exists only
    // while useLinkStatus reports pending, so the element is guaranteed to be
    // removed shortly. A one-shot evaluate raced that removal and timed out.
    await expect(spinner).toHaveCSS("animation-name", "none");
  });

  test("staff pages get the same treatment in their own route group", async ({
    page,
  }) => {
    // The staff routes are a separate tree and were separately broken: the
    // reverted boundary here was (staff)/loading.tsx, and being at the group it
    // did not fire on this exact click — /instructor to /instructor/grading is a
    // sibling swap inside the group it had already been entered through. Each
    // staff page now has its own leaf boundary
    // (src/app/(staff)/instructor/grading/loading.tsx), which is what makes this
    // assertion possible at all. The grading queue is also the heaviest read in
    // the app (cohort-wide aggregates), so it is the worst page to leave without
    // one.
    // beforeEach signed this context in as the student. Drop that session
    // first: /login redirects an already-authenticated visitor away, so
    // loginAs() would silently leave us on the student's nav.
    await page.context().clearCookies();
    await loginAs(page, "instructor");
    await page.goto("/instructor");
    await throttleNavigation(page);

    const grading = sidebarLink(page, "/instructor/grading");
    await grading.click();
    await expect(page.getByTestId("page-skeleton")).toHaveAttribute(
      "data-shape",
      "table",
      { timeout: 2_000 },
    );
  });
});

// =============================================================================
// 404s SURVIVE THEIR LOADING BOUNDARY.
// -----------------------------------------------------------------------------
// THE ASSERTION WHOSE ABSENCE LET THE REGRESSION SHIP. Everything above this line
// tests that a skeleton paints. None of it noticed that the mechanism painting
// that skeleton had silently turned every `notFound()` in the app into an HTTP
// 200 — a Suspense boundary commits the status line when its fallback flushes,
// and a `notFound()` reached afterwards can only change the BODY. Seven specs in
// four other streams failed and told us; this stream's own suite said everything
// was fine, because it only ever looked at pixels.
//
// So each case below is a PAIR: a route that definitely has a loading boundary,
// and a URL under it that must still answer 404. Nothing here would fail if the
// skeletons were deleted, and nothing above here would fail if the status codes
// broke again — that is deliberate, and it is why both halves exist.
//
// `page.goto()` returns the main-document response, so `.status()` is the real
// status line off the wire, not an inference from the rendered body. Asserting the
// body too would pass in both worlds, which is exactly how this was missed.
//
// Read-only: every request is a GET of a nonexistent id. Nothing is written, so
// these are safe to interleave with other streams' specs against the shared
// seeded database.
// =============================================================================

/** Ids and slugs chosen to be absent under any seed, present or future. */
const MISSING_ID = 987_654_321;
const MISSING_SLUG = "definitely-not-a-real-slug-9f3a";

test.describe("404s survive their loading boundary", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  // Each entry names the boundary that covers the URL, so a failure says WHICH
  // boundary swallowed the status rather than just "expected 404, got 200".
  const cases: ReadonlyArray<{ url: string; boundary: string; guard: string }> = [
    {
      url: `/weeks/${MISSING_ID}`,
      boundary: "(app)/weeks/[weekId]/(index)/loading.tsx",
      guard: "(app)/weeks/[weekId]/layout.tsx",
    },
    {
      url: `/weeks/1/lectures/${MISSING_ID}`,
      boundary: "(app)/weeks/[weekId]/lectures/[lectureId]/loading.tsx",
      guard: "(app)/weeks/[weekId]/lectures/[lectureId]/layout.tsx",
    },
    {
      url: `/assignments/${MISSING_ID}`,
      boundary: "(app)/assignments/[weekId]/(index)/loading.tsx",
      guard: "(app)/assignments/[weekId]/layout.tsx",
    },
    {
      url: `/assignments/${MISSING_ID}/submit`,
      boundary: "(app)/assignments/[weekId]/submit/loading.tsx",
      guard: "(app)/assignments/[weekId]/layout.tsx",
    },
    {
      url: `/learn/${MISSING_SLUG}`,
      boundary: "(app)/learn/[track]/(index)/loading.tsx",
      guard: "(app)/learn/[track]/layout.tsx",
    },
    {
      // A REAL track with a missing module, so this exercises the module guard
      // rather than falling out of the track guard one level up.
      url: `/learn/oop/${MISSING_SLUG}`,
      boundary: "(app)/learn/[track]/[moduleSlug]/loading.tsx",
      guard: "(app)/learn/[track]/[moduleSlug]/layout.tsx",
    },
    {
      url: `/problems/${MISSING_SLUG}`,
      boundary: "(app)/problems/[slug]/loading.tsx",
      guard: "(app)/problems/[slug]/layout.tsx",
    },
    {
      url: `/interview/${MISSING_SLUG}`,
      boundary: "(app)/interview/[slug]/loading.tsx",
      guard: "(app)/interview/[slug]/layout.tsx",
    },
    {
      url: `/practice/concept/${MISSING_SLUG}`,
      boundary: "(app)/practice/concept/[conceptId]/loading.tsx",
      guard: "(app)/practice/concept/[conceptId]/layout.tsx",
    },
    {
      url: `/practice/${MISSING_ID}`,
      boundary: "(app)/practice/[lectureId]/loading.tsx",
      guard: "(app)/practice/[lectureId]/layout.tsx",
    },
  ];

  for (const { url, boundary, guard } of cases) {
    test(`${url} answers 404, not 200`, async ({ page }) => {
      const response = await page.goto(url);
      expect(
        response?.status(),
        `${url} sits under ${boundary}; if this is 200 then ${guard} is missing, ` +
          `is below that boundary instead of beside/above it, or no longer refuses`,
      ).toBe(404);
    });
  }

  test("the destinations that carry those boundaries are themselves fine", async ({
    page,
  }) => {
    // The negative control. Every assertion above would also pass if these routes
    // 404'd outright — a guard that refuses everything is not a fix. This is the
    // spec that says the boundaries are still serving real pages.
    for (const url of ["/weeks", "/assignments", "/learn", "/problems", "/interview", "/practice"]) {
      const response = await page.goto(url);
      expect(response?.status(), `${url} must still be a page`).toBe(200);
    }
  });

  test("a nonexistent course is deliberately NOT a 404", async ({ page }) => {
    // THE DOCUMENTED EXCEPTION, asserted so nobody "fixes" it. /courses/[courseId]
    // answers 200 with a refusal page for a course that does not exist, is closed
    // to this student, or has a pending or rejected access request — because a 404
    // tells a student with a pending request that the course does not exist and
    // they file it again. It is the one route in the grep for `notFound()` that
    // has no guard layout, and its loading.tsx records why.
    const response = await page.goto(`/courses/${MISSING_ID}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("course-access-denied")).toBeVisible();
  });

  test("a 404 under a boundary renders the not-found UI as well as the status", async ({
    page,
  }) => {
    // Both halves, on one request. During the regression the BODY was always
    // right and only the status was wrong, so a spec that checked the body alone
    // would have stayed green throughout — which is roughly what happened. Checking
    // them together is what makes this a regression test rather than a smoke test.
    const response = await page.goto(`/weeks/${MISSING_ID}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("page-skeleton")).toHaveCount(0);
    expect(await page.content()).not.toContain("data-testid=\"week-title\"");
  });
});
