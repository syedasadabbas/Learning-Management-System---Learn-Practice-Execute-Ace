// =============================================================================
// E2E — coding problems: practice bank, interview bank, level ladder.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Nine streams share one dev server and one port during
// this wave, and three agents' Playwright runs killed that server last wave. The
// coordinator runs the suites serially at integration.
//
// PREREQUISITE, and it is a hard one: the problem bank is seeded SEPARATELY from
// the course content, by
//
//     npx tsx scripts/content/problems/seed-problems.ts
//
// (there is no npm script yet — package.json is outside this stream's allowlist).
// Without it /problems renders its "no problems have been published yet" empty
// state and everything below fails. The first test asserts the bank is seeded so
// that failure is reported once, clearly, instead of as fifteen mysterious
// timeouts.
//
// WHAT ONLY A REAL BROWSER CAN PROVE, and therefore what is asserted here:
//   1. The hidden tests are not in the page and not in the API response. The unit
//      test (src/lib/problems/payload.test.ts) proves the BUILDER drops them; only
//      an e2e can prove the shipped page agrees.
//   2. The in-browser runner actually runs — a Web Worker, a Blob URL and a
//      `new Function` compile, none of which exist in jsdom.
//   3. Completion is derived: a passing SUBMIT flips the solved badge, and a
//      passing RUN does not.
//   4. The level ladder locks a level in the real rendered page, and a locked
//      problem explains itself instead of 404-ing.
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { loginAs } from "../fixtures";

/**
 * Content facts the problem seeder guarantees. These must match
 * scripts/content/problems/**. If the catalogue changes, change these too — the
 * same contract tests/e2e/fixtures.ts has with scripts/seed.ts.
 */
const SEEDED = {
  /** A beginner JavaScript practice problem that runs in the browser. */
  jsBeginner: "js-sum-of-a-line",
  /** A beginner JavaScript INTERVIEW problem — the other bank, same machinery. */
  jsInterview: "js-largest-gap",
  /** An advanced JavaScript practice problem, used for the lock assertions. */
  jsAdvanced: "js-lru-hit-rate",
  /** A CSS problem: execution "none", so reference-solution-only. */
  cssReferenceOnly: "css-predictable-box-sizing",
  /** Verbatim input of a HIDDEN test on jsBeginner. Must never reach the browser. */
  hiddenTestInput: "1 2 3 4 5 6 7 8 9 10",
  /** Name of a hidden test on jsBeginner. */
  hiddenTestName: "ten numbers",
  /** A correct program for jsBeginner, in the portable form the starter uses. */
  jsSolution: [
    'const stdin = typeof readAll === "function" ? readAll() : require("fs").readFileSync(0, "utf8");',
    "const nums = stdin.trim().split(/\\s+/).filter(Boolean).map(Number);",
    "let total = 0;",
    "for (const n of nums) total += n;",
    "console.log(total);",
  ].join("\n"),
} as const;

/** Pyodide/worker cold start plus a server grade. Generous on purpose. */
const RUN_TIMEOUT_MS = 45_000;
const SLOW_TEST_MS = 120_000;

async function openProblem(page: Page, bank: "problems" | "interview", slug: string) {
  await page.goto(`/${bank}/${slug}`);
  await expect(page.getByTestId("problem-view")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test.describe("access control", () => {
  test("both banks require a session", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/problems");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/interview");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the API refuses an anonymous caller on all three routes", async ({ request }) => {
    // ROUTE_AUTH marks every /api/problems path "student"; middleware rejects at the
    // edge and each handler re-checks. Anonymous must never see a problem body.
    for (const path of [
      "/api/problems",
      `/api/problems/${SEEDED.jsBeginner}`,
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
    }
    const attempt = await request.post(`/api/problems/${SEEDED.jsBeginner}/attempt`, {
      data: { code: "console.log(1)" },
    });
    expect(attempt.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The list surface
// ---------------------------------------------------------------------------

test.describe("problem list", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("the bank is seeded", async ({ page }) => {
    // Asserted first and on its own: every other test depends on it, and this way
    // an unseeded database produces one clear failure instead of fifteen timeouts.
    await page.goto("/problems");
    await expect(page.getByTestId("problems-page")).toBeVisible();
    await expect(
      page.getByText("No problems have been published yet"),
      "run: npx tsx scripts/content/problems/seed-problems.ts",
    ).toHaveCount(0);
    await expect(page.getByTestId("problem-row").first()).toBeVisible();
  });

  test("lists all eight tracks as filters", async ({ page }) => {
    // EIGHT since 2026-07-31: `c` was added (src/lib/problems/types.ts). The chips
    // are rendered from `availableTracks`, i.e. tracks that actually have published
    // rows, so this count ALSO asserts that scripts/content/problems/c.ts was seeded.
    // If it fails at 7 with the other assertions passing, re-run the problem seeder.
    await page.goto("/problems");
    const options = page.getByTestId("track-filter-option");
    await expect(options).toHaveCount(8);
    for (const track of [
      "javascript",
      "python",
      "html",
      "css",
      "c",
      "cpp",
      "sql",
      "agentic-ai",
    ]) {
      await expect(page.locator(`[data-testid="track-filter-option"][data-track="${track}"]`)).toBeVisible();
    }
  });

  test("filtering by track and level narrows the list through the URL", async ({ page }) => {
    await page.goto("/problems?track=javascript&level=beginner");
    const rows = page.getByTestId("problem-row");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    // Every row on a filtered page belongs to the filter. The filter is a server
    // -side WHERE, so a stray row would mean the query, not the UI, is wrong.
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText("beginner");
    }
    await expect(page.locator('[data-testid="problem-row"][data-slug="' + SEEDED.jsBeginner + '"]')).toBeVisible();
  });

  test("an unrecognised filter shows the unfiltered list rather than an error", async ({ page }) => {
    // The PAGE ignores a bad query value; the API route rejects it. Both are
    // deliberate — see parseFilters in src/components/problems/BankPages.tsx.
    await page.goto("/problems?track=cobol&level=wizard");
    await expect(page.getByTestId("problem-row").first()).toBeVisible();
    await expect(page.getByTestId("track-filter-all")).toBeVisible();
  });

  test("the two banks show different problems", async ({ page }) => {
    await page.goto("/problems?track=javascript");
    await expect(page.locator(`[data-slug="${SEEDED.jsBeginner}"]`)).toBeVisible();
    await expect(page.locator(`[data-slug="${SEEDED.jsInterview}"]`)).toHaveCount(0);

    await page.goto("/interview?track=javascript");
    await expect(page.locator(`[data-slug="${SEEDED.jsInterview}"]`)).toBeVisible();
    await expect(page.locator(`[data-slug="${SEEDED.jsBeginner}"]`)).toHaveCount(0);
  });

  test("a problem's slug is not valid in the other bank", async ({ page }) => {
    // /interview/js-sum-of-a-line must not quietly render the practice problem: the
    // ladders are scoped per bank, so it would show the wrong lock state.
    const response = await page.goto(`/interview/${SEEDED.jsBeginner}`);
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The hidden-test barrier — the assertion this stream exists to make
// ---------------------------------------------------------------------------

test.describe("hidden tests never reach the browser", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("no hidden test's input or name appears anywhere in the page", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);

    const html = await page.content();
    expect(html).not.toContain(SEEDED.hiddenTestInput);
    expect(html).not.toContain(SEEDED.hiddenTestName);

    // The COUNT is shown, deliberately: a student needs to know more tests exist.
    await expect(page.getByTestId("problem-submit")).toContainText(/Submit for all \d+ tests/);
  });

  test("no hidden test appears in the API response body either", async ({ page }) => {
    // The page could be clean while the JSON the client fetched is not.
    const response = await page.request.get(`/api/problems/${SEEDED.jsBeginner}`);
    expect(response.status()).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(SEEDED.hiddenTestInput);
    expect(raw).not.toContain(SEEDED.hiddenTestName);
    // The key itself is absent, not merely false — a `hidden` key in the payload
    // would mean rows are shipped and filtered in the UI.
    expect(raw).not.toContain('"hidden"');
    expect(raw).toContain('"hiddenTestCount"');
  });

  test("the reference solution is withheld from an unsolved runnable problem", async ({ page }) => {
    const response = await page.request.get(`/api/problems/${SEEDED.jsAdvanced}`);
    const body = await response.json();
    if (body.ok) {
      // Only meaningful while the demo student has not solved it. When they have,
      // revealing it is correct — so assert the rule, not the absence.
      //
      // qa-hardening: `solved` is asserted to BE a boolean first. The old form
      // branched on `solved === false` and asserted nothing at all whenever the
      // field was renamed, dropped or non-boolean — which is precisely the drift
      // that would let `referenceSolution` start shipping unnoticed.
      expect(typeof body.data.solved, "solved must be a boolean").toBe("boolean");
      if (body.data.solved === false) {
        expect(Object.keys(body.data)).not.toContain("referenceSolution");
      } else {
        // Already solved: the worked answer is allowed, and the payload must say so
        // rather than silently omitting the flag this branch relies on.
        expect(body.data.solved).toBe(true);
      }
    } else {
      // 403 level_locked is also a pass for this assertion: nothing was revealed.
      expect(body.code).toBe("level_locked");
    }
  });
});

// ---------------------------------------------------------------------------
// The problem view and the in-browser runner
// ---------------------------------------------------------------------------

test.describe("solving a problem", () => {
  test.setTimeout(SLOW_TEST_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("shows the statement, the examples, the editor and both actions", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    await expect(page.getByTestId("problem-statement")).toBeVisible();
    await expect(page.getByTestId("problem-example").first()).toBeVisible();
    await expect(page.getByTestId("problem-editor")).toBeVisible();
    await expect(page.getByTestId("problem-run")).toBeEnabled();
    await expect(page.getByTestId("problem-submit")).toBeEnabled();
  });

  test("reveals hints one at a time, not all at once", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    await expect(page.getByTestId("problem-hint")).toHaveCount(0);
    await page.getByTestId("problem-hint-reveal").click();
    await expect(page.getByTestId("problem-hint")).toHaveCount(1);
    await page.getByTestId("problem-hint-reveal").click();
    await expect(page.getByTestId("problem-hint")).toHaveCount(2);
  });

  test("Run executes in the browser and passes the visible examples", async ({ page }) => {
    // Proves the Web Worker path really works: a Blob worker plus a `new Function`
    // compile, neither of which exists in jsdom.
    await openProblem(page, "problems", SEEDED.jsBeginner);
    await page.getByTestId("problem-editor").fill(SEEDED.jsSolution);
    await page.getByTestId("problem-run").click();

    const results = page.getByTestId("problem-run-results");
    await expect(results).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    const rows = page.getByTestId("problem-run-result");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText("pass");
    }
  });

  test("Run records nothing — only a submit can", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    const before = await page.request.get(`/api/problems/${SEEDED.jsBeginner}`);
    const attemptsBefore = (await before.json()).data.attempts.length as number;

    await page.getByTestId("problem-editor").fill(SEEDED.jsSolution);
    await page.getByTestId("problem-run").click();
    await expect(page.getByTestId("problem-run-results")).toBeVisible({ timeout: RUN_TIMEOUT_MS });

    const after = await page.request.get(`/api/problems/${SEEDED.jsBeginner}`);
    const attemptsAfter = (await after.json()).data.attempts.length as number;
    // A browser result is advisory by the execution stream's contract, so it must
    // not become a row. If it did, a forged pass count would become a "solved".
    expect(attemptsAfter).toBe(attemptsBefore);
  });

  test("a wrong answer fails the examples and shows the diff", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    await page.getByTestId("problem-editor").fill('console.log("nope");');
    await page.getByTestId("problem-run").click();
    await expect(page.getByTestId("problem-run-results")).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    await expect(page.getByTestId("problem-run-result").first()).toContainText("fail");
    await expect(page.getByText("You printed").first()).toBeVisible();
  });

  test("Reset restores the starter code", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    const editor = page.getByTestId("problem-editor");
    const starter = await editor.inputValue();
    await editor.fill("THROWAWAY");
    await expect(page.getByTestId("problem-reset")).toBeEnabled();
    await page.getByTestId("problem-reset").click();
    await expect(editor).toHaveValue(starter);
  });

  test("Submit grades on the server, or says plainly that it could not", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    await page.getByTestId("problem-editor").fill(SEEDED.jsSolution);
    await page.getByTestId("problem-submit").click();

    // Two acceptable outcomes, and the point of the assertion is that they are
    // DISTINGUISHABLE. Grading goes through the shared free Piston instance, so
    // `rate_limited` and `backend_unavailable` are real and must not be dressed up
    // as a wrong answer.
    const graded = page.getByTestId("problem-submit-result");
    const deferred = page.getByTestId("problem-submit-deferred");
    await expect(graded.or(deferred)).toBeVisible({ timeout: RUN_TIMEOUT_MS });

    if (await deferred.count()) {
      await expect(deferred).toContainText(/does not count as a failed attempt/i);
      // TODO(test): this branch means Piston was unreachable from the test runner.
      // The graded path below is the one that proves the derivation; if CI takes
      // this branch consistently, point PISTON_URL at a self-hosted instance
      // (FREE_STACK.md) rather than deleting the assertion.
      return;
    }

    await expect(graded).toContainText("All tests passed");
    // Completion is DERIVED: the badge appears because a passing attempt row now
    // exists, not because anything was flagged.
    await page.reload();
    await expect(page.getByTestId("problem-solved-badge")).toBeVisible();
    await expect(page.getByTestId("problem-attempts")).toBeVisible();

    // ...and the reference solution is now admitted, because it is a worked answer
    // rather than a spoiler.
    await expect(page.getByTestId("problem-reference-solution")).toBeVisible();

    // The list agrees with the problem page — both read the same derivation.
    await page.goto("/problems?track=javascript&level=beginner");
    await expect(
      page.locator(`[data-testid="problem-row"][data-slug="${SEEDED.jsBeginner}"]`),
    ).toHaveAttribute("data-solved", "true");
  });

  test("an empty editor cannot be submitted", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.jsBeginner);
    await page.getByTestId("problem-editor").fill("");
    await expect(page.getByTestId("problem-submit")).toBeDisabled();
    await expect(page.getByTestId("problem-run")).toBeDisabled();
  });

  test("the API refuses a submit with no code", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.post(`/api/problems/${SEEDED.jsBeginner}/attempt`, {
      data: { passedCount: 4, totalCount: 4 },
    });
    // The client cannot report a result. Only `code` is accepted, and without it
    // there is nothing to grade.
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe("missing_code");
  });
});

// ---------------------------------------------------------------------------
// Reference-only problems
// ---------------------------------------------------------------------------
// REWRITTEN 2026-07-31. The old heading here read "HTML and CSS have no runtime"
// and the tests asserted that a CSS problem had NO editor. Both statements were
// descriptions of the gap the product owner reported. HTML and CSS still have no
// runtime — that has not changed and cannot — but they now get an editor with a
// live preview regardless, and the ones whose requirement is a checkable structure
// also get a graded Submit. See markup.spec.ts in this directory for those.
//
// What survives here is the case that is still genuinely reference-only: a markup
// problem whose requirement is a judgement. `css-predictable-box-sizing` is one, and
// it keeps `execution: "none"`.
// ---------------------------------------------------------------------------

test.describe("reference-only problems", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a judgement-shaped CSS problem offers a worked answer and no Submit", async ({ page }) => {
    await openProblem(page, "problems", SEEDED.cssReferenceOnly);
    await expect(page.getByTestId("problem-reference-only")).toBeVisible();
    await expect(page.getByTestId("problem-reference-solution")).toBeVisible();
    // A Submit that could only ever refuse is worse than no button at all — the same
    // reasoning that hides Run for C++ during a Piston outage.
    await expect(page.getByTestId("problem-run")).toHaveCount(0);
    await expect(page.getByTestId("problem-submit")).toHaveCount(0);
    await expect(page.getByTestId("problem-check")).toHaveCount(0);
    // ...but it DOES now get an editor. This is the assertion that inverts: the old
    // version of this test required `problem-editor` to be absent and treated that
    // as correct.
    await expect(page.getByTestId("problem-markup-editor")).toBeVisible();
  });

  test("submitting one is refused with an explanation, not a zero score", async ({ page }) => {
    const response = await page.request.post(`/api/problems/${SEEDED.cssReferenceOnly}/attempt`, {
      data: { code: ".card { }" },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.graded).toBe(false);
    expect(body.data.reason).toBe("not_executable");
  });

  test("the CSS ladder now gates, because part of the track IS gradeable", async ({ page }) => {
    // BEHAVIOUR CHANGE, asserted rather than discovered. Until 2026-07-31 the whole
    // CSS track was `execution: "none"`, so its unlock requirement was zero at every
    // level and every chip read data-locked="false" — which the old version of this
    // test asserted. Three CSS problems are now graded, so the ladder behaves like
    // the JavaScript one: beginner is always open, and the levels above it depend on
    // solving what is below. src/lib/problems/progression.ts is the single rule.
    await page.goto("/problems?track=css");
    const chips = page.getByTestId("level-filter-option");
    const count = await chips.count();
    expect(count, "the CSS track must render its level filter chips").toBeGreaterThan(0);

    const beginner = page.locator('[data-testid="level-filter-option"][data-level="beginner"]');
    await expect(beginner).toHaveAttribute("data-locked", "false");

    // Intermediate is locked or not depending on what this student has solved; both
    // are valid, so what is asserted is that the attribute EXISTS and is a boolean
    // string. Asserting "locked" outright would fail for a student who has solved it,
    // and asserting "unlocked" is what this test used to do wrongly.
    const intermediate = page.locator(
      '[data-testid="level-filter-option"][data-level="intermediate"]',
    );
    expect(["true", "false"]).toContain(await intermediate.getAttribute("data-locked"));
  });
});

// ---------------------------------------------------------------------------
// The level ladder
// ---------------------------------------------------------------------------

test.describe("level progression", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a locked level is marked as such in the rendered page", async ({ page }) => {
    await page.goto("/problems?track=javascript");
    const advanced = page.locator('[data-testid="level-filter-option"][data-level="advanced"]');
    await expect(advanced).toBeVisible();

    const locked = (await advanced.getAttribute("data-locked")) === "true";
    if (!locked) {
      // The demo student has already solved enough to open it. That is a valid
      // state, not a failure — reset with `npm run db:reset-demo` to see the lock.
      test.skip(true, "advanced is already unlocked for the demo student");
    }
    // The padlock must carry a reason. A padlock with no reason is a dead end.
    await expect(page.getByTitle(/more at the level below/i).first()).toBeVisible();
  });

  test("a locked problem explains itself instead of 404-ing", async ({ page }) => {
    const response = await page.goto(`/problems/${SEEDED.jsAdvanced}`);
    expect(response?.status()).toBeLessThan(400);
    const lockedPage = page.getByTestId("problem-locked-page");
    const view = page.getByTestId("problem-view");
    await expect(lockedPage.or(view)).toBeVisible();
    if (await lockedPage.count()) {
      await expect(lockedPage).toContainText(/is not open yet/i);
      await expect(lockedPage).toContainText(/to unlock it/i);
    }
  });

  test("the API refuses a locked problem with 403 and a reason, not a 404", async ({ page }) => {
    const response = await page.request.get(`/api/problems/${SEEDED.jsAdvanced}`);
    if (response.status() === 403) {
      const body = await response.json();
      expect(body.code).toBe("level_locked");
      expect(body.error).toMatch(/level below/i);
    } else {
      // Unlocked for this student; nothing to assert beyond a well-formed body.
      expect(response.status()).toBe(200);
      expect((await response.json()).ok).toBe(true);
    }
  });

  test("an unknown slug 404s in both banks", async ({ page }) => {
    for (const bank of ["problems", "interview"]) {
      const response = await page.goto(`/${bank}/not-a-real-problem`);
      expect(response?.status(), bank).toBe(404);
    }
  });
});
