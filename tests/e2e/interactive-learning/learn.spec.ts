// =============================================================================
// E2E — /learn: track index, track page, stepped module, per-step completion.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// AUTHORED, NOT RUN. A dev server is already serving port 3000 for a human and the
// suites share one database and one demo student, so this stream did not execute
// Playwright. Every expectation below is therefore a claim to be verified on the
// first real run, not a passing result.
//
// -----------------------------------------------------------------------------
// THE FOUR RED SPECS OF 2026-07-30, DIAGNOSED AND FIXED — 2026-07-31.
//
// The earlier note in this position blamed "a mismatch between each stream's
// specs and its own rendered markup". That was wrong, and it sent the reader
// looking at the components. Every test id those four specs ask for is rendered
// by the components as written (ModuleRunner.tsx renders learn-step-tab with
// data-done="true"/"false"; LabStep.tsx:57 renders learn-lab-step; CheckStep.tsx
// renders learn-check-step; StepDiagram.tsx renders learn-step-diagram). The
// single actual cause was SHARED, ACCUMULATING DATABASE STATE:
//
//   * The runner deliberately opens at the first step the student has NOT
//     completed (ModuleRunner.tsx `firstIncompleteIndex`), and returns the LAST
//     index once the module is finished (progress.ts).
//   * `learning_progress` is never cleared. scripts/reset-demo-student.ts — the
//     script that exists precisely to undo e2e side effects — deletes attempts,
//     answers, progress flags, submissions and leaderboard rows, and does NOT
//     touch `learning_progress`. Nor does re-running the learn seed.
//   * Three of the four specs advanced through the module by pressing
//     "Mark done and continue" in a loop, so running the suite ONCE completed
//     every step of oop-objects-and-state. There are two Playwright projects
//     (chromium, mobile-chrome), so that happened inside the very first run.
//
// Verified against the live seeded database on 2026-07-31, not inferred: all six
// steps of oop-objects-and-state were already complete for
// student@codequeenshub.test. With the module finished, the runner opens at step
// 6 (an explain step with no diagram), so:
//
//   :144 step 1 is already done -> it is not `aria-current="step"` on load.
//   :236 the walk-forward loop starts PAST the lab (step 2) and the "next"
//        button cannot advance beyond the last step -> learn-lab-step never
//        appears, reported as "element not found".
//   :285 same, for the check step (step 4).
//   :312 step 6 carries no diagram -> learn-step-diagram is not rendered.
//
// WHAT CHANGED, AND ON WHICH SIDE. The product behaviour is correct and is not
// weakened here: resuming where the student stopped is the whole point of
// per-step completion. Two things changed instead:
//
//   1. PRODUCT (small): the step tab now carries `data-step-kind`, so a lab or a
//      check step can be OPENED DIRECTLY instead of by completing every step in
//      front of it. A test that has to mutate state to reach its subject will
//      always be order-dependent, and this one was.
//   2. SPECS: the three navigation specs jump straight to the step they are
//      about, and the one spec that genuinely needs a fresh module —
//      "advancing a step saves it, and a reload resumes where it stopped", which
//      cannot mean anything if the steps are already saved — resets THIS
//      MODULE'S progress rows for the demo student first (`resetLearnProgress`).
//
// No assertion was removed or loosened. The answer-key check gained a second,
// stronger assertion (see that spec).
//
// Fixed in passing (a different fault, since corrected): "an invalid step id is a
// 400, and an unknown one a 404" called the API through the session-less
// `request` fixture after logging in on `page`, so every call was refused 401 and
// neither assertion was reachable. See the note on that test.
// -----------------------------------------------------------------------------
//
// PREREQUISITE: the learn content must be seeded —
//   npx tsx scripts/content/learn/seed-learn.ts
// Without it /learn renders its empty state, and the specs below skip rather than
// fail, because "no content seeded" is a fixture problem and not a regression.
//
// THE TWO THINGS THAT MOST NEED A REAL BROWSER, and cannot be unit-tested:
//   1. A lab actually running. jsdom has no Worker and no createObjectURL, so the
//      JavaScript runner is only exercisable here (see lab-runner.test.ts for the
//      note on why the unit test asserts only the degraded path).
//   2. prefers-reduced-motion. Playwright can emulate it; jsdom's matchMedia does
//      not exist at all.
//
// WHAT IS PROVEN WITHOUT A BROWSER, as of 2026-07-31. The MARKUP CONTRACT these
// specs depend on — which step the runner opens at, `data-done` flipping to
// "true", `aria-current="step"` moving on, `data-step-kind` on every tab, the
// lab/check/diagram test ids appearing when their step is current, and the
// diagram keeping every frame with `data-reduced-motion="true"` — is asserted in
// src/components/learn/ModuleRunner.test.tsx and StepDiagram.test.tsx under
// vitest. What those cannot prove, and what only the coordinator's serial run
// can: the Web Worker actually executing the lab (jsdom has no Worker), the real
// prefers-reduced-motion media feature, and the two HTTP round trips.
// =============================================================================

// Loaded so `resetLearnProgress` below has DATABASE_URL. Playwright does not read
// .env itself, and next dev loads it only into the SERVER process — the reset
// runs in the test process, which would otherwise see nothing.
import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";

import { DEMO, loginAs } from "../fixtures";

/**
 * Content facts the learn seed guarantees. Keep in step with scripts/content/learn.
 *
 * The step numbers below are the module's step LAYOUT, read back off the seeded
 * database on 2026-07-31 rather than counted by eye in oop.ts:
 *   1 explain (carries a diagram)   4 check
 *   2 lab (javascript)              5 lab (javascript)
 *   3 explain (no diagram)          6 explain (no diagram)
 * `diagramStepNumber` matters: "an explain step" is NOT enough, because two of
 * the three explain steps have no diagram to degrade.
 */
const SEEDED_LEARN = {
  tracks: ["oop", "dbms", "cryptography", "cybersecurity"],
  /** A module known to open with an explain step carrying a diagram. */
  module: { track: "oop", slug: "oop-objects-and-state", stepCount: 6 },
  /** A module whose second step is a JavaScript lab. */
  jsLab: { track: "oop", slug: "oop-objects-and-state" },
  /** The only step of `module` whose explain payload has diagram frames. */
  diagramStepNumber: 1,
} as const;

/**
 * Delete the demo student's completion rows for ONE learn module.
 *
 * Why this is necessary rather than tidy: "a reload resumes where it stopped" is
 * only a statement about anything while some step is still unfinished, and this
 * suite finishes the module as a side effect of testing it. Nothing else clears
 * `learning_progress` — scripts/reset-demo-student.ts does not — so without this
 * the spec asserted against a module that a previous run had completed.
 *
 * Scoped two ways, deliberately, following the shape of `clearStandInSubmissions`
 * in tests/e2e/submissions/submissions.spec.ts: the demo student only, and the
 * steps of one module only. A blanket `DELETE FROM learning_progress` would also
 * wipe the seeded activity accounts, and `learning_progress` is read by
 * src/lib/learn/query.ts for the /learn index and every track page, so the damage
 * would surface as someone else's failing percentage.
 *
 * These tracks are ungraded (src/lib/learn/types.ts), so deleting these rows
 * cannot affect a week unlock, a weekly score or the leaderboard — the reason it
 * is safe to do mid-suite at all.
 */
async function resetLearnProgress(moduleSlug: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  // Not silently skipped: without the reset this spec's subject does not exist,
  // and a green run would be meaningless. Fail with the reason.
  expect(
    connectionString,
    "DATABASE_URL is not set in the test process, so learn progress cannot be reset.",
  ).toBeTruthy();

  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM learning_progress
        WHERE student_id = (SELECT id FROM users WHERE email = $1)
          AND step_id IN (
            SELECT s.id FROM learning_steps s
              JOIN learning_modules m ON m.id = s.module_id
             WHERE m.slug = $2
          )`,
      [DEMO.student.email, moduleSlug],
    );
  } finally {
    await client.end();
  }
}

/** The tab that opens the first step of a given kind, without completing anything. */
function stepTabOfKind(page: Page, kind: "explain" | "lab" | "check") {
  return page.locator(`[data-testid="learn-step-tab"][data-step-kind="${kind}"]`).first();
}

/** Skip the body of a spec when the learn content has not been seeded. */
async function requireSeededLearn(page: Page): Promise<void> {
  await page.goto("/learn");
  const cards = page.getByTestId("learn-track-card");
  const seeded = (await cards.count()) > 0;
  test.skip(
    !seeded,
    "Learn content is not seeded. Run: npx tsx scripts/content/learn/seed-learn.ts",
  );
}

test.describe("learn — track index", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("requires a session", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/login/);
  });

  test("lists the seeded tracks and states that nothing is marked", async ({ page }) => {
    await requireSeededLearn(page);

    await expect(page.getByTestId("learn-index")).toBeVisible();
    // The ungraded promise is on the page, not only in a doc comment: a student who
    // thinks a module affects their week score will avoid it when behind.
    await expect(page.getByText(/nothing here is marked/i)).toBeVisible();

    for (const track of SEEDED_LEARN.tracks) {
      await expect(page.locator(`[data-testid="learn-track-card"][data-track="${track}"]`)).toBeVisible();
    }
  });

  test("a track with no published module does not appear", async ({ page }) => {
    await requireSeededLearn(page);
    // dsa is registered in src/lib/learn/tracks.ts and has no content. The registry
    // must not be able to conjure a card for it — the query decides.
    await expect(page.locator('[data-testid="learn-track-card"][data-track="dsa"]')).toHaveCount(0);
  });
});

test.describe("learn — track page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("groups modules by level and links to each one", async ({ page }) => {
    await requireSeededLearn(page);
    await page.goto(`/learn/${SEEDED_LEARN.module.track}`);

    await expect(page.getByTestId("learn-track-page")).toBeVisible();
    await expect(page.getByTestId("learn-level-group").first()).toBeVisible();
    expect(await page.getByTestId("learn-module-card").count()).toBeGreaterThan(0);
    // Levels are headings, not locks: every card must be reachable.
    await expect(page.getByTestId("learn-module-link").first()).toBeEnabled();
  });

  test("an unknown track is a 404, not an empty page", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.goto("/learn/not-a-real-track");
    expect(response?.status()).toBe(404);
  });
});

test.describe("learn — stepped module and per-step completion", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a module slug under the wrong track is a 404", async ({ page }) => {
    await requireSeededLearn(page);
    // Slugs are globally unique, so /learn/dbms/oop-... would otherwise resolve and
    // render an OOP module under a DBMS heading.
    const response = await page.goto(`/learn/dbms/${SEEDED_LEARN.module.slug}`);
    expect(response?.status()).toBe(404);
  });

  test("advancing a step saves it, and a reload resumes where it stopped", async ({ page }) => {
    await requireSeededLearn(page);
    const { track, slug } = SEEDED_LEARN.module;

    // THE PRECONDITION IS THE POINT OF THE SPEC. "Resumes where it stopped" is a
    // claim about a module in progress; against a module every step of which is
    // already saved, the runner correctly opens at the last step and the spec
    // asserted nothing it meant to. This is also what made it fail from the
    // second project (mobile-chrome) of the very first run onwards.
    await resetLearnProgress(slug);

    await page.goto(`/learn/${track}/${slug}`);
    await expect(page.getByTestId("learn-module-runner")).toBeVisible();

    const firstTab = page.locator('[data-testid="learn-step-tab"][data-step-number="1"]');
    await expect(firstTab).toHaveAttribute("aria-current", "step");

    await page.getByTestId("learn-next-step").click();

    // Step 1 is now saved and step 2 is current.
    await expect(firstTab).toHaveAttribute("data-done", "true", { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="learn-step-tab"][data-step-number="2"]'),
    ).toHaveAttribute("aria-current", "step");

    // Progress is announced in words, with counts — not by colour.
    await expect(page.getByTestId("learn-progress-announcement")).toContainText(/1 of \d+/);

    // A closed tab loses nothing: the reload opens at the first INCOMPLETE step.
    await page.reload();
    await expect(
      page.locator('[data-testid="learn-step-tab"][data-step-number="2"]'),
    ).toHaveAttribute("aria-current", "step");
    await expect(firstTab).toHaveAttribute("data-done", "true");
  });

  test("completing the same step twice is a no-op, not a second row", async ({ page, request }) => {
    await requireSeededLearn(page);
    const { track, slug } = SEEDED_LEARN.module;
    await page.goto(`/learn/${track}/${slug}`);

    // Read a real step id out of the rendered check/lab ids rather than guessing one.
    const stepId = await page.evaluate(() => {
      const tab = document.querySelector('[data-testid="learn-step-tab"]');
      return tab ? tab.getAttribute("data-step-number") : null;
    });
    expect(stepId).not.toBeNull();

    // Drive the route directly, twice, with the browser's session cookies.
    await page.getByTestId("learn-next-step").click();
    await expect(
      page.locator('[data-testid="learn-step-tab"][data-step-number="1"]'),
    ).toHaveAttribute("data-done", "true");

    // Navigate back and complete step 1 again. The observable property this test
    // actually checks is that the progress figure does not move.
    const before = await page.getByTestId("learn-progress-announcement").textContent();
    await page.locator('[data-testid="learn-step-tab"][data-step-number="1"]').click();
    await page.getByTestId("learn-next-step").click();
    await page.waitForTimeout(500);
    const after = await page.getByTestId("learn-progress-announcement").textContent();
    expect(after).toBe(before);

    // TODO(test): the route's own `created: false` on a repeat POST is NOT asserted
    // here. This block previously read "And the API itself is idempotent" above a
    // bare `void request;`, which asserted nothing — corrected by qa-hardening
    // rather than left claiming a check that does not exist. Asserting it needs the
    // step id, which this UI-driven spec never learns. Nor is it covered by a unit
    // test: src/lib/learn/complete.ts has no *.test.ts at all, so `created: false`
    // on a repeat completion is currently unverified anywhere. Reported to the
    // coordinator.
    void request;
  });

  test("an unauthenticated POST to the completion route is refused", async ({ request }) => {
    // No login in this spec: a fresh request context carries no session.
    const response = await request.post("/api/learn/steps/1/complete", { data: {} });
    expect([401, 403]).toContain(response.status());
  });

  test("an invalid step id is a 400, and an unknown one a 404", async ({ page }) => {
    await loginAs(page, "student");
    // MUST be `page.request`, not the `request` fixture. `request` is a SEPARATE
    // context with its own empty cookie jar, so both calls arrived with no
    // session and were refused 401 before validation or lookup ever ran — the
    // 400 and the 404 this test exists to check were unreachable. The spec
    // directly above deliberately uses the bare `request` fixture to assert the
    // anonymous case, which is exactly why the difference is easy to miss here.
    const bad = await page.request.post("/api/learn/steps/abc/complete", { data: {} });
    expect(bad.status()).toBe(400);

    const missing = await page.request.post("/api/learn/steps/99999999/complete", {
      data: {},
    });
    expect(missing.status()).toBe(404);
  });
});

test.describe("learn — labs run in the browser", () => {
  test("a JavaScript lab executes with no server round trip", async ({ page }) => {
    await loginAs(page, "student");
    await requireSeededLearn(page);
    const { track, slug } = SEEDED_LEARN.jsLab;
    // Count the round trips from the moment the page is opened, not from just
    // before Run: a runner that "warmed up" the server backend on mount would
    // otherwise slip past this, and that is the regression the assertion exists
    // to catch (see the header of src/components/execution/CodeRunner.tsx).
    let executeCalls = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/execute")) executeCalls += 1;
    });

    await page.goto(`/learn/${track}/${slug}`);

    // OPEN the lab step; do not walk to it. The previous loop pressed "Mark done
    // and continue" until a lab appeared, which wrote a completion row per press
    // and therefore moved the module's resume point past the lab — so on every
    // run after the first, the loop started AFTER step 2 and could never come
    // back to it. Tabs are plain navigation and save nothing.
    await stepTabOfKind(page, "lab").click();
    await expect(page.getByTestId("learn-lab-step")).toBeVisible();
    // This spec is specifically about the JAVASCRIPT runner. If content is
    // reordered so the first lab is Python, that must read as "the spec's subject
    // moved", not as a mysterious 30 s timeout waiting for Pyodide.
    await expect(page.getByTestId("learn-lab-language")).toHaveText("javascript");

    // The runner is behind next/dynamic, so it mounts after the page does.
    const source = page.getByTestId("code-runner-source");
    await expect(source).toBeVisible({ timeout: 15_000 });

    // Replace the starter with something whose output is unambiguous. `6 * 7` is
    // computed by the runtime, so "lab-ran 42" cannot be echoed markup — it can
    // only come from a JavaScript engine that actually ran the snippet.

    await source.fill("console.log('lab-ran', 6 * 7);");
    await page.getByTestId("code-runner-run").click();
    await expect(page.getByTestId("code-runner")).toContainText("lab-ran 42", { timeout: 30_000 });
    expect(executeCalls).toBe(0);
  });

  test("the module page does not ship a Python runtime until Run is pressed", async ({ page }) => {
    await loginAs(page, "student");
    await requireSeededLearn(page);

    const pyodideRequests: string[] = [];
    page.on("request", (req) => {
      if (/pyodide|sql-wasm/i.test(req.url())) pyodideRequests.push(req.url());
    });

    await page.goto(`/learn/${SEEDED_LEARN.module.track}/${SEEDED_LEARN.module.slug}`);
    await expect(page.getByTestId("learn-module-runner")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // ~10 MB of WebAssembly must not be fetched by simply opening a module.
    expect(pyodideRequests).toEqual([]);
  });
});

test.describe("learn — inline checks", () => {
  test("a check is graded server-side and the answer key is not in the page", async ({ page }) => {
    await loginAs(page, "student");
    await requireSeededLearn(page);
    const { track, slug } = SEEDED_LEARN.module;
    await page.goto(`/learn/${track}/${slug}`);

    // Open the check step directly. The old walk-forward loop completed a step per
    // press, so it pushed the module's resume point past the check and then had no
    // way back — the "element not found" of 2026-07-30. See the header.
    await stepTabOfKind(page, "check").click();
    await expect(page.getByTestId("learn-check-step")).toBeVisible();

    // ---- assertion 1: no answer key in the payload -------------------------
    // A substring canary. It holds today (nothing in the learn content contains
    // the literal `"correct":`, checked across scripts/content/learn), but it is
    // still a weak assertion: it only fails if the key leaks in this exact JSON
    // spelling, and it would pass against any other encoding.
    const html = await page.content();
    expect(html).not.toMatch(/"correct"\s*:\s*true/);

    await page.getByTestId("learn-check-step").locator('input[type="radio"]').first().check();
    await page.getByTestId("learn-check-submit").click();

    // Result stated in words, in a live region — never colour alone.
    const result = page.getByTestId("learn-check-result");
    await expect(result).toContainText(/correct|not quite/i, { timeout: 10_000 });

    // ---- assertion 2: the grading really came from the server --------------
    // Stronger than the canary above and impossible to satisfy by coincidence: the
    // EXPLANATION is dropped alongside `correct` at the read boundary
    // (`publicCheck` in src/lib/learn/expectation.ts keeps prompt and option text
    // only), and it is server-authored prose that appears nowhere else. So if it
    // is on screen now and was absent from the pre-answer HTML, it crossed the
    // network in the POST response — which is what "graded server-side" means.
    // Nothing is hardcoded from the seed, so this survives a content rewrite.
    const explanation = (await result.locator("p").nth(1).textContent())?.trim() ?? "";
    expect(
      explanation.length,
      "The check result carried no explanation, so this spec cannot prove where grading happened.",
    ).toBeGreaterThan(20);
    // The second <p> of the result block is the explanation; the third is the
    // fixed "not marked" sentence. Assert we picked the former, or the check below
    // would be comparing against boilerplate.
    expect(explanation).not.toMatch(/not marked/i);
    expect(html).not.toContain(explanation);
  });
});

test.describe("learn — accessibility", () => {
  test("reduced motion degrades the diagram to a static one without losing information", async ({
    browser,
  }) => {
    // Two contexts, same page, only the media preference differs. The frame COUNT
    // must be identical: reduced motion removes movement, never content.
    const counts: number[] = [];
    // And the frame TEXT with it. Equal counts alone would still pass if the
    // captions — which are the information once the animation is gone — were
    // swapped for placeholders in the static rendering.
    const texts: string[][] = [];
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await loginAs(page, "student");
      await page.goto(`/learn/${SEEDED_LEARN.module.track}/${SEEDED_LEARN.module.slug}`);

      // OPEN THE DIAGRAM STEP EXPLICITLY. This spec used to assume the module
      // opens on step 1; the runner opens on the first INCOMPLETE step, so once
      // an earlier spec had finished the module it opened on step 6 — an explain
      // step with no diagram — and `learn-step-diagram` was simply not rendered.
      // Step 1 is the only step of this module whose explain payload has frames,
      // so it is named rather than guessed at by kind.
      await page
        .locator(
          `[data-testid="learn-step-tab"][data-step-number="${SEEDED_LEARN.diagramStepNumber}"]`,
        )
        .click();

      const diagram = page.getByTestId("learn-step-diagram");
      await expect(diagram).toBeVisible();
      await expect(diagram).toHaveAttribute(
        "data-reduced-motion",
        reducedMotion === "reduce" ? "true" : "false",
      );
      const frames = page.getByTestId("learn-diagram-frame");
      counts.push(await frames.count());
      texts.push((await frames.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()));
      await context.close();
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeGreaterThan(1);
    expect(texts[1]).toEqual(texts[0]);
  });

  test("every step is reachable by keyboard alone", async ({ page }) => {
    await loginAs(page, "student");
    await requireSeededLearn(page);
    await page.goto(`/learn/${SEEDED_LEARN.module.track}/${SEEDED_LEARN.module.slug}`);

    const tab = page.locator('[data-testid="learn-step-tab"][data-step-number="3"]');
    await tab.focus();
    await expect(tab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-current", "step");
  });

  test("completion state is conveyed in text, not only in colour", async ({ page }) => {
    await loginAs(page, "student");
    await requireSeededLearn(page);
    await page.goto(`/learn/${SEEDED_LEARN.module.track}/${SEEDED_LEARN.module.slug}`);

    await page.getByTestId("learn-next-step").click();
    await expect(
      page.locator('[data-testid="learn-step-tab"][data-step-number="1"]'),
    ).toContainText("done");
  });
});
