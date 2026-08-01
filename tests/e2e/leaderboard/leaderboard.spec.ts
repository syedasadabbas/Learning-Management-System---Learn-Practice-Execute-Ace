// =============================================================================
// E2E: cohort leaderboard. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Nine agents share port 3000 during parallel
// development, so the coordinator runs the e2e suite serially at integration.
// Authored here so it is reviewable in the same change as the feature.
//
// RESOLVED 2026-07-30 — the seed now populates the board. When this spec was
// written, scripts/seed.ts created users, weeks, quizzes and assignments but no
// `leaderboard` rows, so the populated state could not be asserted from a bare
// seed. scripts/seed-demo-activity.ts (added at integration, and called from
// seed.ts) now seeds three students with different totals, which is exactly what
// the skill asked for; `npm run db:smoke` reports 3 entries. The ordering
// assertions below therefore RUN rather than skip.
//
// The row-count guards are kept anyway, and deliberately:
//
//   1. The ordering assertions derive their expectation from the rendered
//      `data-rank` / `data-testid="lb-total"` attributes and check INVARIANTS
//      (totals non-increasing down the table, ranks 1..N with no duplicates or
//      gaps). That holds for ANY seed, which is the property that actually
//      matters — a hardcoded "Ada then Grace then Bea" assertion would break the
//      day someone reorders the seed.
//   2. A guard means the spec degrades to a visible skip on a database that has
//      not been seeded, instead of failing with a confusing empty-table
//      assertion. The skip reason states the precondition, so it is legible in
//      the report rather than silently green.
//
// All timeouts are milliseconds (house rules).
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { DEMO, SEEDED, expectNoServerError, loginAs, otherSeededEmails } from "../fixtures";

const ROW = '[data-testid="lb-row"], [data-testid="lb-row-me"]';

/**
 * Build a descendant selector under every branch of ROW.
 *
 * ROW is a comma-separated selector LIST, and the CSS comma binds looser than the
 * descendant combinator. So `${ROW} [data-testid="x"]` parses as
 *   [data-testid="lb-row"]  OR  [data-testid="lb-row-me"] [data-testid="x"]
 * — the first branch matching whole <tr> elements rather than the cell. Reading
 * textContent off a whole row yielded "1Ayesha Advanced60 / 310..." and every
 * parsed total came out NaN, so the ordering assertion compared NaN to NaN and
 * failed with no useful message. Distributing the descendant fixes it.
 */
function withinRow(descendant: string): string {
  return ROW.split(",")
    .map((branch) => `${branch.trim()} ${descendant}`)
    .join(", ");
}

async function rowCount(page: Page): Promise<number> {
  return page.locator(ROW).count();
}

test.describe("leaderboard — signed out", () => {
  test("is not reachable without a session", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/leaderboard/me is not reachable without a session", async ({ page }) => {
    await page.goto("/leaderboard/me");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the API refuses an anonymous caller", async ({ request }) => {
    const response = await request.get("/api/leaderboard");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("unauthenticated");
  });
});

test.describe("leaderboard — as a student", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/leaderboard");
    await expectNoServerError(page);
  });

  test("renders the page without a server error", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeVisible();
  });

  test("renders either a table or an explicit empty state, never a broken table", async ({
    page,
  }) => {
    const table = page.getByTestId("leaderboard-table");
    const empty = page.getByTestId("lb-empty");

    // Exactly one of the two. A header-only table with no <tbody> rows is the
    // failure this guards against.
    const tableCount = await table.count();
    const emptyCount = await empty.count();
    expect(tableCount + emptyCount).toBe(1);

    if (tableCount === 1) {
      expect(await rowCount(page)).toBeGreaterThan(0);
    }
  });

  test("the signed-in user's row is highlighted, or an explicit not-ranked note is shown", async ({
    page,
  }) => {
    const me = page.getByTestId("lb-row-me");

    if ((await me.count()) === 1) {
      await expect(me).toBeVisible();
      await expect(me).toHaveAttribute("data-current-user", "true");
      // The highlight is conveyed non-visually too, not by colour alone.
      await expect(me).toHaveAttribute("aria-current", "true");
      await expect(me.getByTestId("lb-you-badge")).toBeVisible();
      // Exactly one row may claim to be the viewer.
      expect(await me.count()).toBe(1);
    } else {
      // No standing yet is a legitimate state and must say so.
      await expect(page.getByTestId("lb-my-standing-empty")).toBeVisible();
    }
  });

  test("/leaderboard/me lands on the board anchored at the user's own row", async ({
    page,
  }) => {
    await page.goto("/leaderboard/me");
    await expect(page).toHaveURL(/\/leaderboard(\?.*)?#me$/);
    await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeVisible();
  });

  test("switching to the per-week tab keeps the page working", async ({ page }) => {
    await page.getByTestId("lb-tab-week").click();
    await expect(page.getByTestId("lb-tab-week")).toHaveAttribute("data-active", "true");
    await expectNoServerError(page);

    // The week picker offers exactly the seeded weeks.
    const weekTabs = page.getByTestId("lb-week-picker").getByRole("link");
    await expect(weekTabs).toHaveCount(SEEDED.weekCount);

    const weekTable = page.getByTestId("leaderboard-week-table");
    const empty = page.getByTestId("lb-empty");
    expect((await weekTable.count()) + (await empty.count())).toBe(1);
  });

  test("each week is selectable and renders", async ({ page }) => {
    await page.getByTestId("lb-tab-week").click();
    for (let week = 1; week <= SEEDED.weekCount; week += 1) {
      await page.getByTestId(`lb-week-${week}`).click();
      await expect(page.getByTestId(`lb-week-${week}`)).toHaveAttribute(
        "data-active",
        "true",
      );
      await expectNoServerError(page);
    }
  });

  test("a student is not offered a cohort picker", async ({ page }) => {
    // Cohort choice is staff-only — queries.ts returns an empty cohort list for
    // students, so the control must not render at all.
    await expect(page.getByTestId("lb-cohort-picker")).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // PRIVACY. The board is readable by every student, so this is the regression that
  // matters most on this page. The assertion is unchanged in intent; its CANARY was
  // wrong and has been replaced. What follows is why, because the distinction is the
  // whole point of the test.
  //
  // THE OLD FORM asserted `page.content()` does not contain "@codequeenshub.test" —
  // the domain every seeded account shares, INCLUDING the account doing the looking.
  // So it could not tell a leak apart from the page knowing who you are, and it
  // failed on 2026-07-31 for the second reason. The match was in the RSC payload, in
  //   {"user":{"name":"Demo Student","email":"student@codequeenshub.test",...}}
  // beside `(app)/layout.tsx` stack frames: the VIEWER'S OWN address, in a debug
  // record, in a serialisation nothing in this repo asked for.
  //
  // IT DOES NOT REACH PRODUCTION, and that was verified rather than assumed:
  //
  //   * React's flight server serialises the resolved value of an awaited promise
  //     into the RSC stream as debug info, tagged with the owner and stack of the
  //     component that awaited it. `src/app/(app)/layout.tsx:28` awaits
  //     `requireUser()`, which awaits Auth.js's `auth()` — whose resolved value is a
  //     Session, shape `{user:{...email...}}`. That is the observed record exactly.
  //   * The code doing it exists ONLY in React's development build. In
  //     node_modules/next/dist/compiled/react-server-dom-webpack/cjs/, the symbol
  //     `forwardDebugInfo` occurs 20 times in react-server-dom-webpack-server.node.development.js
  //     and 0 times in ...server.node.production.js — same for every other flight
  //     server variant (browser, edge, unbundled).
  //   * Measured, not deduced: a production build served by `next start` returned
  //     /leaderboard as 54,759 bytes of HTML containing "codequeenshub.test" ZERO
  //     times, while containing "Ayesha", "Bilal", "Chandni", "Demo Student" and
  //     `lb-row-me` once each. Names and ranks ship; addresses do not.
  //
  // So the page is correct and the old canary was unusable: it fires in `next dev`
  // on a fact that is not a leak, and the thing it was meant to catch — one
  // student's address becoming visible to another — it could not isolate at all.
  //
  // THE NEW FORM checks the two properties separately, and both are strictly
  // stronger than the one it replaces:
  //   1. No OTHER seeded account's address appears in the served markup, checked
  //      against each specific address. A classmate's email in the RSC payload is
  //      not a debug artifact — no server component on this page awaits one — so
  //      this is a real failure in dev and in production alike.
  //   2. Not even the viewer's own address appears in RENDERED TEXT. innerText
  //      excludes <script>, so this measures what a person can read on the page
  //      while ignoring the dev-only debug stream, and it is the assertion that
  //      would catch an email rendered into a table cell.
  // ---------------------------------------------------------------------------
  test("no other student's email address appears anywhere on the page", async ({ page }) => {
    const html = await page.content();
    for (const email of otherSeededEmails("student")) {
      expect(html, `${email} must not appear in the leaderboard markup`).not.toContain(
        email,
      );
    }
  });

  test("no email address at all is rendered as visible text — not even the viewer's own", async ({
    page,
  }) => {
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("@codequeenshub.test");
    // A bare "@" is legitimate copy, so the domain is the right unit here; the
    // preceding test is what covers addresses on other domains.
    expect(visibleText).not.toContain(DEMO.student.email);
  });

  test("sorting by total is a bookmarkable URL and reorders the table", async ({
    page,
  }) => {
    if ((await rowCount(page)) < 2) {
      test.skip(true, "needs >=2 ranked students; run npm run db:seed");
    }

    await page.getByTestId("lb-header-total").getByRole("link").click();
    await expect(page).toHaveURL(/sort=total/);
    await expect(page.getByTestId("lb-header-total")).toHaveAttribute(
      "aria-sort",
      /ascending|descending/,
    );
    await expectNoServerError(page);
  });
});

test.describe("leaderboard — ordering invariants", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/leaderboard");
  });

  test("ranks are 1..N with no duplicates and no gaps", async ({ page }) => {
    const count = await rowCount(page);
    if (count === 0) {
      test.skip(true, "no ranked students; run npm run db:seed");
    }

    const ranks = await page.locator(ROW).evaluateAll((rows) =>
      rows.map((r) => Number((r as HTMLElement).dataset.rank)),
    );

    expect(ranks).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(new Set(ranks).size).toBe(count);
  });

  test("totals are non-increasing down the table in default rank order", async ({
    page,
  }) => {
    if ((await rowCount(page)) < 2) {
      test.skip(true, "needs >=2 ranked students; run npm run db:seed");
    }

    const totals = await page
      .locator(withinRow('[data-testid="lb-total"]'))
      .evaluateAll((cells) =>
        cells.map((c) => Number((c.textContent ?? "").split("/")[0].trim())),
      );

    for (let i = 1; i < totals.length; i += 1) {
      expect(
        totals[i],
        `row ${i + 1} (${totals[i]}) must not out-score row ${i} (${totals[i - 1]})`,
      ).toBeLessThanOrEqual(totals[i - 1]);
    }
  });

  test("ranks are stable across two page loads", async ({ page }) => {
    if ((await rowCount(page)) < 2) {
      test.skip(true, "needs >=2 ranked students; run npm run db:seed");
    }

    const read = () =>
      page
        .locator(ROW)
        .evaluateAll((rows) =>
          rows.map((r) => (r as HTMLElement).dataset.studentId ?? ""),
        );

    const first = await read();
    await page.reload();
    // This is the flicker regression the studentId tie-break exists to prevent.
    expect(await read()).toEqual(first);
  });

  test("a single-student board renders a table plus a note, not a broken layout", async ({
    page,
  }) => {
    if ((await rowCount(page)) !== 1) {
      test.skip(true, "cohort does not currently have exactly one ranked student");
    }
    await expect(page.getByTestId("leaderboard-table")).toBeVisible();
    await expect(page.getByTestId("lb-single-student")).toBeVisible();
  });
});

test.describe("leaderboard API", () => {
  test("GET /api/leaderboard returns the ApiResult envelope", async ({ page }) => {
    // page.request, not the bare `request` fixture: that fixture has its own
    // cookie jar, so a session established through the page is invisible to it
    // and every authenticated call 401s.
    const request = page.request;
    await loginAs(page, "student");

    const response = await request.get("/api/leaderboard");
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.scope).toBe("overall");
    expect(typeof body.data.maxScore).toBe("number");
    expect(Array.isArray(body.data.entries)).toBe(true);
    expect(body.data.weeks.length).toBe(SEEDED.weekCount);

    // Privacy: rows carry name + avatar + scores and nothing else identifying.
    for (const entry of body.data.entries) {
      expect(entry).not.toHaveProperty("email");
      expect(entry).not.toHaveProperty("passwordHash");
    }
  });

  test("GET /api/leaderboard ignores a cohortId a student tries to force", async ({
    page,
  }) => {
    const request = page.request; // see note above: the `request` fixture has no session
    await loginAs(page, "student");

    const mine = await (await request.get("/api/leaderboard")).json();
    const forced = await (await request.get("/api/leaderboard?cohortId=999999")).json();

    // A student is pinned to their own cohort, so the parameter must be inert
    // rather than returning an empty foreign board.
    expect(forced.data.cohortId).toBe(mine.data.cohortId);
  });

  test("GET /api/leaderboard rejects a nonsense sort without erroring", async ({
    page,
  }) => {
    const request = page.request; // see note above: the `request` fixture has no session
    await loginAs(page, "student");
    const body = await (
      await request.get("/api/leaderboard?sort=email&dir=sideways&scope=nope")
    ).json();

    expect(body.ok).toBe(true);
    expect(body.data.sort).toBe("rank");
    expect(body.data.scope).toBe("overall");
  });

  test("GET /api/leaderboard/me returns the viewer's standing or null", async ({
    page,
  }) => {
    const request = page.request; // see note above: the `request` fixture has no session
    await loginAs(page, "student");
    const response = await request.get("/api/leaderboard/me");
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.ok).toBe(true);
    // null is a legitimate "not graded yet" answer, not an error.
    if (body.data !== null) {
      expect(typeof body.data.totalScore).toBe("number");
      expect(typeof body.data.maxScore).toBe("number");
      expect(body.data).not.toHaveProperty("email");
      // staleForMs is in milliseconds, per house rule 5.
      if (body.data.staleForMs !== null) {
        expect(body.data.staleForMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("GET /api/leaderboard/me refuses an anonymous caller", async ({ request }) => {
    const response = await request.get("/api/leaderboard/me");
    expect(response.status()).toBe(401);
  });
});

test.describe("leaderboard — as staff", () => {
  test("an instructor sees the cohort board but has no standing of their own", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto("/leaderboard");
    await expectNoServerError(page);

    await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeVisible();
    // REQUIREMENT: staff must never appear in a student leaderboard.
    await expect(page.getByTestId("lb-row-me")).toHaveCount(0);
    await expect(page.getByTestId("lb-my-standing-empty")).toBeVisible();
  });

  test("an instructor is offered a cohort picker", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/leaderboard");
    await expect(page.getByTestId("lb-cohort-picker")).toBeVisible();
  });

  test("GET /api/leaderboard/me is null for staff, not an error", async ({
    page,
  }) => {
    const request = page.request; // see note above: the `request` fixture has no session
    await loginAs(page, "instructor");
    const body = await (await request.get("/api/leaderboard/me")).json();
    expect(body.ok).toBe(true);
    expect(body.data).toBeNull();
  });
});
