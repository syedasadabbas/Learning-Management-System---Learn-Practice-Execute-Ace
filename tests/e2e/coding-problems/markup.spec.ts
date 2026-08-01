// =============================================================================
// E2E — HTML/CSS editor and grading, and the compiled-language Run gate.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Six agents share one dev server, one port and one seeded
// database during this wave; concurrent Playwright runs corrupt each other. The
// parent session runs the suites serially at integration. Everything below is
// therefore WRITTEN BUT UNVERIFIED — said plainly here rather than implied by a
// green unit suite.
//
// PREREQUISITE, and it is the same hard one problems.spec.ts states:
//
//     npx tsx scripts/content/problems/seed-problems.ts
//
// The markup problems changed shape in that catalogue (execution "none" -> "browser",
// plus test rows that did not exist before) and the `c` track is entirely new, so a
// database seeded before 2026-07-31 will fail nearly every test in this file. The
// first test asserts the new shape so that failure is reported once, clearly.
//
// WHAT ONLY A REAL BROWSER CAN PROVE, and therefore what is here:
//   1. Sandpack actually mounts and previews. It needs an iframe, a service worker
//      and a bundler client; jsdom has none of them, which is why the component test
//      (src/components/problems/MarkupWorkbench.test.tsx) mocks the editor.
//   2. The draft round trip is real. The component test mocks localStorage's
//      wrapper; only a browser proves that typing into CodeMirror ends up in
//      localStorage and that Submit sends THOSE bytes.
//   3. Hidden requirements are absent from the shipped page. A hidden requirement
//      like `declares .card | margin-inline: auto` IS the answer, so this is the
//      same barrier problems.spec.ts asserts for hidden test inputs, applied to a
//      new kind of answer key.
//   4. Grading a markup submit needs no network. Every other Submit in this suite
//      has to tolerate a `backend_unavailable` branch; this one must not have it.
// =============================================================================

import { expect, test, type Page, type Response } from "@playwright/test";

import { loginAs } from "../fixtures";

/**
 * Content facts scripts/content/problems/{html,css,c}.ts guarantee. If the
 * catalogue changes, change these too.
 */
const SEEDED = {
  /** A GRADED HTML problem: editor, requirements, real Submit. */
  htmlGraded: "html-valid-document-skeleton",
  /** A GRADED CSS problem whose starter is a two-file bundle. */
  cssGraded: "css-centre-a-block",
  /** A markup problem that is still reference-only: judgement, not structure. */
  markupJudgement: "css-predictable-box-sizing",
  /** A C problem. Compiled, so `execution: "piston"` and no browser backend. */
  cProblem: "c-sum-of-a-line",
  /** A C++ problem, the other compiled track. */
  cppProblem: "cpp-sum-of-a-line",
  /**
   * A HIDDEN requirement on `htmlGraded`, in the form the database stores
   * (scripts/content/problems/html.ts:151). Must never reach the browser: it
   * names the attribute value the grade depends on.
   *
   * NOT the bare value `width=device-width, initial-scale=1`, which is what this
   * was and which made the assertion below UNPASSABLE. That string is in the
   * LMS's own root-layout viewport meta, so `page.content()` contains it on every
   * page in the app whether or not anything leaked. The test reported a leak
   * against a collision with our own <head>.
   *
   * The `attr meta content=` prefix is the grammar's, so this whole string only
   * appears if a raw requirement is dumped.
   */
  hiddenRequirement: "attr meta content=width=device-width, initial-scale=1",
  /** Name of a hidden test on `htmlGraded`. */
  hiddenRequirementName: "the viewport is actually configured",
  /**
   * The PROSE the requirements panel would render this hidden requirement as, if
   * it ever rendered it. The visible ones come out as `a <meta> element sets
   * charset to "utf-8"`, so the hidden one would read `... sets content to ...`.
   *
   * Needed as a separate canary because `hiddenRequirement` above only catches a
   * RAW dump of the grammar. A leak through the normal rendering path would be
   * phrased, not raw, and would slip past it. No page in the app contains this
   * phrase otherwise — the app's own meta tag is attribute syntax
   * (`content="..."`), never the words "sets content to".
   */
  hiddenRequirementProse: "sets content to",
  /** A complete correct answer to `htmlGraded`. */
  htmlSolution: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cohort notes</title>
  </head>
  <body>
    <h1>Cohort notes</h1>
    <p>Written down before I forget it.</p>
  </body>
</html>`,
} as const;

/** Sandpack's static template boots an iframe and a worker. Generous on purpose. */
const EDITOR_TIMEOUT_MS = 45_000;
const SLOW_TEST_MS = 120_000;

async function openProblem(page: Page, slug: string) {
  await page.goto(`/problems/${slug}`);
  await expect(page.getByTestId("problem-view")).toBeVisible();
}

/**
 * Type a whole document into the Sandpack editor.
 *
 * CodeMirror is a contenteditable, not a textarea, so `fill()` does not apply. The
 * sequence is: focus the editor, select all, type. `insertText` is used rather than
 * `type()` because CodeMirror's auto-close-brackets would otherwise turn every `<`
 * into `<>` and every typed `"` into `""`, and the document that arrives would not
 * be the document this test wrote.
 */
async function replaceEditorContents(page: Page, source: string) {
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(source);
  // The draft is written on a debounce (PREVIEW_DEBOUNCE_MS in
  // src/lib/exercises/reduced-motion.ts). Submit reads localStorage, so the write
  // has to have happened. Waiting on the KEY rather than on a fixed sleep keeps this
  // honest if the debounce is ever retuned.
  await page.waitForFunction(
    () =>
      Object.keys(window.localStorage).some((key) =>
        key.startsWith("lms:exercise-draft:v1:problem:"),
      ),
    undefined,
    { timeout: EDITOR_TIMEOUT_MS },
  );
}

// ---------------------------------------------------------------------------
// The catalogue is seeded in its new shape
// ---------------------------------------------------------------------------

test.describe("the markup catalogue", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("the graded markup problems are seeded as executable", async ({ page }) => {
    // Asserted first and on its own: every other test in this file depends on it, and
    // a database seeded before this change would otherwise produce a dozen confusing
    // failures instead of one clear one.
    const response = await page.request.get(`/api/problems/${SEEDED.htmlGraded}`);
    expect(
      response.status(),
      "re-run: npx tsx scripts/content/problems/seed-problems.ts",
    ).toBe(200);
    const body = await response.json();
    expect(body.data.execution, "html problems must no longer be execution:none").toBe("browser");
    expect(body.data.hiddenTestCount).toBeGreaterThan(0);
    expect(body.data.visibleTests.length).toBeGreaterThan(0);
  });

  test("the C track is seeded and served", async ({ page }) => {
    const response = await page.request.get(`/api/problems/${SEEDED.cProblem}`);
    // 200 and not 403: c-sum-of-a-line is a BEGINNER problem, and beginner is always
    // unlocked (src/lib/problems/progression.ts). A 403 here would mean the ladder
    // regressed rather than that this student is behind, so it is a failure and not a
    // skip.
    expect(
      response.status(),
      "re-run: npx tsx scripts/content/problems/seed-problems.ts",
    ).toBe(200);
    const body = await response.json();
    expect(body.data.track).toBe("c");
    expect(body.data.language).toBe("c");
    // Compiled: the practice loop cannot be local, so this must be a piston row.
    expect(body.data.execution).toBe("piston");
  });
});

// ---------------------------------------------------------------------------
// The answer-key barrier, applied to requirements
// ---------------------------------------------------------------------------

test.describe("hidden requirements never reach the browser", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("no hidden requirement's text or name appears in the page", async ({ page }) => {
    await openProblem(page, SEEDED.htmlGraded);
    const html = await page.content();
    expect(html, "a raw hidden requirement was dumped into the page").not.toContain(
      SEEDED.hiddenRequirement,
    );
    expect(html, "a hidden requirement's NAME reached the page").not.toContain(
      SEEDED.hiddenRequirementName,
    );
    expect(html, "a hidden requirement was rendered as prose").not.toContain(
      SEEDED.hiddenRequirementProse,
    );
    // The COUNT is shown, deliberately, exactly as it is for executed problems.
    await expect(page.getByTestId("problem-submit")).toContainText(
      /Submit for all \d+ requirements/,
    );
  });

  test("no hidden requirement appears in the API response either", async ({ page }) => {
    const response = await page.request.get(`/api/problems/${SEEDED.htmlGraded}`);
    const raw = await response.text();
    expect(raw).not.toContain(SEEDED.hiddenRequirement);
    expect(raw).not.toContain(SEEDED.hiddenRequirementName);
    expect(raw).not.toContain(SEEDED.hiddenRequirementProse);
    expect(raw).not.toContain('"hidden"');
    expect(raw).toContain('"hiddenTestCount"');
  });

  test("the worked answer is withheld until the problem is solved", async ({ page }) => {
    // This is a REGRESSION RISK created by this change: these problems used to be
    // `execution: "none"`, which `mayRevealSolution` treats as "show the answer, there
    // is nothing else". Now that they are gradeable, the answer must be withheld like
    // any other unsolved problem's — otherwise the change quietly published an answer
    // key for six problems.
    const response = await page.request.get(`/api/problems/${SEEDED.htmlGraded}`);
    const body = await response.json();
    expect(typeof body.data.solved, "solved must be a boolean").toBe("boolean");
    if (body.data.solved === false) {
      expect(Object.keys(body.data)).not.toContain("referenceSolution");
    } else {
      expect(body.data.solved).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The editor and the live preview
// ---------------------------------------------------------------------------

test.describe("editing an HTML problem", () => {
  test.setTimeout(SLOW_TEST_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("shows the statement, the requirements, the editor and a live preview", async ({ page }) => {
    await openProblem(page, SEEDED.htmlGraded);
    await expect(page.getByTestId("problem-statement")).toBeVisible();
    await expect(page.getByTestId("problem-requirements")).toBeVisible();
    await expect(page.getByTestId("problem-requirement").first()).toBeVisible();
    await expect(page.getByTestId("live-editor")).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    // The preview iframe is the half that could not exist before this change.
    await expect(page.locator("iframe").first()).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(page.getByTestId("problem-submit")).toBeEnabled();
  });

  test("a CSS problem opens with both the scaffold and the stylesheet as tabs", async ({ page }) => {
    // The bundle format's whole purpose: a CSS problem with no HTML would preview a
    // blank frame. Two tabs is the visible proof the split happened.
    await openProblem(page, SEEDED.cssGraded);
    const editor = page.getByTestId("live-editor");
    await expect(editor).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(editor).toContainText("Editing 2 files");
  });

  test("the file delimiters are not shown to the student", async ({ page }) => {
    // They exist only because starter_code is one column. Seeing `/* file: ... */` in
    // the editor would teach a syntax this platform invented.
    await openProblem(page, SEEDED.cssGraded);
    await expect(page.getByTestId("live-editor")).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(page.getByTestId("live-editor")).not.toContainText("file: /styles.css");
  });

  test("Check reports the shown requirements and records nothing", async ({ page }) => {
    await openProblem(page, SEEDED.htmlGraded);
    const before = await page.request.get(`/api/problems/${SEEDED.htmlGraded}`);
    const attemptsBefore = (await before.json()).data.attempts.length as number;

    await replaceEditorContents(page, SEEDED.htmlSolution);
    await page.getByTestId("problem-check").click();

    const results = page.getByTestId("problem-check-results");
    await expect(results).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    const lines = page.getByTestId("problem-check-line");
    const count = await lines.count();
    expect(count, "the check must list the requirements it looked at").toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(lines.nth(i)).toContainText("met:");
    }

    const after = await page.request.get(`/api/problems/${SEEDED.htmlGraded}`);
    expect((await after.json()).data.attempts.length).toBe(attemptsBefore);
  });

  test("an unsatisfied requirement is named, not just counted", async ({ page }) => {
    await openProblem(page, SEEDED.htmlGraded);
    await replaceEditorContents(page, "<html><body><p>nothing else</p></body></html>");
    await page.getByTestId("problem-check").click();
    const results = page.getByTestId("problem-check-results");
    await expect(results).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    // The feedback a student can act on: which requirement, in words.
    await expect(results).toContainText(/lang attribute/i);
  });
});

// ---------------------------------------------------------------------------
// Submitting markup
// ---------------------------------------------------------------------------

test.describe("submitting an HTML problem", () => {
  test.setTimeout(SLOW_TEST_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a correct answer is graded, recorded, and marks the problem solved", async ({ page }) => {
    await openProblem(page, SEEDED.htmlGraded);
    await replaceEditorContents(page, SEEDED.htmlSolution);
    await page.getByTestId("problem-submit").click();

    // NOTE THE ABSENCE. Every other Submit assertion in this suite has to accept a
    // `problem-submit-deferred` outcome, because grading reaches the shared free
    // Piston instance. Markup grading is a pure function in the server process, so
    // there is no infrastructure branch to tolerate — and asserting the graded panel
    // unconditionally is the point.
    const graded = page.getByTestId("problem-submit-result");
    await expect(graded).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(graded).toContainText("All requirements passed");

    // Completion is DERIVED from the attempt row, as everywhere else.
    await page.reload();
    await expect(page.getByTestId("problem-solved-badge")).toBeVisible();
    await expect(page.getByTestId("problem-attempts")).toBeVisible();
    // ...and only now is the worked answer admitted.
    await expect(page.getByTestId("problem-reference-solution")).toBeVisible();

    await page.goto("/problems?track=html&level=beginner");
    await expect(
      page.locator(`[data-testid="problem-row"][data-slug="${SEEDED.htmlGraded}"]`),
    ).toHaveAttribute("data-solved", "true");
  });

  test("a wrong answer fails without revealing which hidden requirement", async ({ page }) => {
    await openProblem(page, SEEDED.htmlGraded);
    await replaceEditorContents(page, "<html><head></head><body><h1>x</h1></body></html>");
    await page.getByTestId("problem-submit").click();

    const graded = page.getByTestId("problem-submit-result");
    await expect(graded).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(graded).toContainText("Some requirements failed");
    // The hidden ones are reported as pass/fail and nothing more. Printing the
    // requirement would hand over the answer the grade depends on.
    await expect(graded).toContainText("hidden requirement");
    const afterGrading = await page.content();
    expect(afterGrading).not.toContain(SEEDED.hiddenRequirement);
    expect(afterGrading).not.toContain(SEEDED.hiddenRequirementName);
    expect(afterGrading).not.toContain(SEEDED.hiddenRequirementProse);
  });

  test("the API grades a bundle posted directly, and needs no runtime to do it", async ({ page }) => {
    // Proves the server path independently of the editor: the same submission the UI
    // would send, sent by hand. If this passes while the UI test fails, the bug is in
    // the draft round trip and not in the grader.
    const response = await page.request.post(`/api/problems/${SEEDED.htmlGraded}/attempt`, {
      data: { code: SEEDED.htmlSolution },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.graded, "markup grading must never defer to infrastructure").toBe(true);
    expect(body.data.passed).toBe(true);
    // Milliseconds, like every other attempt (house rule: metric units).
    expect(typeof body.data.runtimeMs).toBe("number");
  });

  test("an attempt on a markup problem records that nothing was executed", async ({ page }) => {
    await page.request.post(`/api/problems/${SEEDED.htmlGraded}/attempt`, {
      data: { code: SEEDED.htmlSolution },
    });
    const response = await page.request.get(`/api/problems/${SEEDED.htmlGraded}`);
    const body = await response.json();
    expect(body.data.attempts.length).toBeGreaterThan(0);
    // "none", not "piston": no Piston call happened, and a record that claimed one
    // would be a fabricated fact in the instructor views that read this column.
    expect(body.data.attempts[0].execution).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// ITEM 3 — the compiled-language Run gate
// ---------------------------------------------------------------------------

test.describe("compiled languages and the Run gate", () => {
  test.setTimeout(SLOW_TEST_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a C problem never claims to run in the browser", async ({ page }) => {
    // The label bug this change fixed. C has `browserBackend: null`, so a Run goes to
    // Piston whatever the row says; telling the student it is local is simply false,
    // and it matters because it is the difference between "free and unlimited" and
    // "one of six calls in your ten-second budget".
    const response = await page.goto(`/problems/${SEEDED.cProblem}`);
    expect(response?.status()).toBeLessThan(400);
    if (await page.getByTestId("problem-locked-page").count()) {
      test.skip(true, "the C beginner level is locked for this student");
    }

    const location = page.getByTestId("problem-run-location");
    if (await location.count()) {
      await expect(location).toContainText("runs on the server");
      await expect(location).not.toContainText("runs in your browser");
    } else {
      // No editor at all means Piston was unreachable and the page degraded, which is
      // the OTHER correct outcome — assert that shape rather than skipping.
      await expect(page.getByTestId("problem-reference-only")).toBeVisible();
      await expect(page.getByTestId("problem-run")).toHaveCount(0);
    }
  });

  test("a compiled problem shows either both actions or neither, never a dead Run", async ({ page }) => {
    // THE INVARIANT, for both compiled tracks. There is no state in which a compiled
    // problem offers a Run button that cannot reach a runtime: either Piston is
    // reachable and both actions are live, or it is not and the page is the statement
    // plus the worked answer with no buttons. Whichever branch CI lands in, the
    // assertion holds — which is what makes this testable without being able to take
    // Piston down.
    for (const slug of [SEEDED.cProblem, SEEDED.cppProblem]) {
      const response = await page.goto(`/problems/${slug}`);
      expect(response?.status(), slug).toBeLessThan(400);
      if (await page.getByTestId("problem-locked-page").count()) continue;

      const runCount = await page.getByTestId("problem-run").count();
      const submitCount = await page.getByTestId("problem-submit").count();
      expect(runCount, `${slug}: Run and Submit must appear together`).toBe(submitCount);

      if (runCount === 0) {
        // Degraded. The worked answer must be there instead — a statement with no way
        // to attempt it and nothing to learn from would be the worst of both.
        await expect(page.getByTestId("problem-reference-only"), slug).toBeVisible();
        await expect(page.getByTestId("problem-reference-solution"), slug).toBeVisible();
      }
    }
  });

  test("the C track's beginner level is open, like every other track's", async ({ page }) => {
    await page.goto("/problems?track=c");
    await expect(page.getByTestId("problem-row").first()).toBeVisible();
    await expect(
      page.locator('[data-testid="level-filter-option"][data-level="beginner"]'),
    ).toHaveAttribute("data-locked", "false");
  });
});

// ---------------------------------------------------------------------------
// Two things this stream measured off the page, asserted back on it.
// ---------------------------------------------------------------------------
// Both blocks below are WRITTEN BUT UNVERIFIED, per the file header: this stream
// does not run Playwright. Each says what it should print if it fails.

test.describe("the Sandpack bundle is not on the critical path", () => {
  test.setTimeout(SLOW_TEST_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  /**
   * The JavaScript a page actually pulled down, in bytes.
   *
   * THIS MEASURED 2 kB AGAINST A 129 kB ROUTE, and each of the three reasons is
   * worth writing down because every one of them fails QUIETLY — an
   * under-reporting budget is worse than a wrong one, since a small number sits
   * comfortably under the ceiling and the test goes on passing while measuring
   * nothing.
   *
   *   1. THE LOAD WAS NOT COLD. The previous version of this comment claimed
   *      "Playwright gives each test a fresh context, so on first navigation
   *      nothing is warm". True of the context, false of THIS navigation, which is
   *      the third: `beforeEach` calls `loginAs`, which loads /login and then an
   *      authenticated page, and that already fetched the webpack runtime,
   *      main-app, the framework chunk and the (app) layout's chunks — most of the
   *      route's First Load JS. Chromium then serves them from its own cache and
   *      Playwright reports no body for a memory-cache hit, so what was left to
   *      count was the route-specific remainder alone.
   *   2. `content-length` IS ABSENT. `next start` serves these chunks compressed
   *      and chunked, so the header this used to sum does not exist and
   *      `Number(undefined ?? 0)` contributed 0 for nearly every file. That is why
   *      disabling the cache appeared to change nothing and briefly seemed to
   *      exonerate reason 1 — the number could not move while the summand was 0.
   *   3. DECODED, NOT ENCODED, BYTES. The figure this budget is compared against is
   *      `next build`'s First Load JS, which is UNCOMPRESSED.
   *      `sizes().responseBodySize` is the on-the-wire size, so summing it
   *      under-reports by the compression ratio (it measured 7 kB). `body()` gives
   *      the decoded length, which is the same unit as the build table — the only
   *      unit in which these thresholds can be checked against anything.
   *
   * Keyed by URL so a chunk requested twice counts once, and the listener is
   * removed in `finally` because it is per-call and would otherwise keep counting
   * into any later navigation in the same test.
   */
  async function scriptBytesFor(page: Page, path: string): Promise<number> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

    const seen = new Map<string, number>();
    const pending: Promise<unknown>[] = [];
    editorChunks = [];

    const onResponse = (response: Response) => {
      // pathname, NOT the raw URL: `next dev` appends ?v=<timestamp> to script
      // URLs, so endsWith(".js") on the full URL drops nearly all of them — and
      // `next dev` is what playwright.config.ts runs when CI is unset, i.e. the
      // default for anyone running this spec locally.
      const { pathname } = new URL(response.url());
      if (!pathname.startsWith("/_next/static/") || !pathname.endsWith(".js")) return;
      if (response.status() !== 200 || seen.has(response.url())) return;
      seen.set(response.url(), 0);
      pending.push(
        response
          .body()
          .then((buffer) => {
            seen.set(response.url(), buffer.byteLength);
            if (EDITOR_MARKER.test(buffer.toString("utf8"))) {
              editorChunks.push(response.url().split("/").pop() ?? response.url());
            }
          })
          .catch(() => undefined),
      );
    };

    page.on("response", onResponse);
    try {
      await page.goto(path);
      await expect(page.getByTestId("problem-view")).toBeVisible();
      // Next hydrates and only then resolves any dynamic() boundary. Without
      // settling here a deferred chunk could land after the measurement, and this
      // test would pass for the wrong reason.
      await page.waitForLoadState("networkidle");
      await Promise.all(pending);
    } finally {
      page.off("response", onResponse);
      await cdp.detach().catch(() => undefined);
    }

    // Exposed for the vacuity guard: a count in single figures means the cache was
    // still warm, which is the exact failure above and is invisible in a byte total.
    chunkCount = seen.size;
    return [...seen.values()].reduce((total, n) => total + n, 0);
  }

  /** Number of distinct chunks the last measurement saw. See the note above. */
  let chunkCount = 0;

  /**
   * Basenames of chunks whose BODY mentioned the editor, collected by the run
   * above. This, not a byte total, is what the claim in this block rests on.
   */
  let editorChunks: string[] = [];

  /** Marker for the editor bundle, matched against chunk contents. */
  const EDITOR_MARKER = /sandpack|codemirror/i;

  // ---------------------------------------------------------------------------
  // WHY THIS ASSERTS ON CHUNK IDENTITY AND NOT ON A BYTE BUDGET.
  //
  // It used to assert `totalScriptKB < 250`, with 250 chosen because `npm run
  // build` reported 353 kB First Load JS for /problems/[slug] before
  // LazyMarkupWorkbench.tsx existed and 129 kB after. Those numbers cannot be
  // compared with anything this test can measure, because FIRST LOAD JS IS
  // GZIPPED, while a browser measurement is either encoded (compressed, and then
  // comparable to no figure in this codebase) or decoded (comparable to the files
  // on disk, but roughly three times the build's number). Measured: the page entry
  // for /(app)/problems/[slug]/page is 11 chunks totalling 423 kB on disk, and a
  // correct cold-load decoded sum came to 442 kB. So NO correct byte measurement
  // could satisfy a 250 kB ceiling — the assertion was unpassable, and the
  // "passes" it used to report came from a measurement reading 2 kB.
  //
  // A byte total is confounded by something outside this feature as well: Next
  // prefetches the links in the viewport and the sidebar carries fourteen, so a
  // cold load legitimately pulls other routes' chunks too.
  //
  // The CLAIM is not about weight. It is "a JavaScript problem does not download
  // the editor it cannot use" — a statement about WHICH chunks arrive, assertable
  // directly, in no units, immune to both compression and prefetch: no chunk whose
  // body mentions Sandpack or CodeMirror may be fetched. Cross-checked against
  // .next/app-build-manifest.json, where that page entry lists ZERO
  // sandpack-bearing chunks, so the deferral this block guards does work — which
  // the old assertion could not have established either way.
  // ---------------------------------------------------------------------------

  test("a JavaScript problem does not download the editor it cannot use", async ({ page }) => {
    // The C problem stands in for "any problem on the non-markup branch": it
    // renders ProblemWorkbench, which is a textarea and a fetch.
    const kB = Math.round((await scriptBytesFor(page, `/problems/${SEEDED.cProblem}`)) / 1000);

    // Vacuity guard, on the CHUNK COUNT rather than on bytes. A warm cache reports
    // a handful of chunks and a small total, which satisfies any ceiling — that is
    // precisely how this test came to measure 2 kB and call it a pass.
    expect(
      chunkCount,
      `only ${chunkCount} chunk(s) were seen (${kB} kB) — the cache was still warm, so ` +
        "this measured almost nothing. Check Network.setCacheDisabled in the helper.",
    ).toBeGreaterThan(10);

    // THE CLAIM ITSELF.
    expect(
      editorChunks,
      `a JavaScript problem downloaded the editor bundle: ${editorChunks.join(", ")}. ` +
        "Check that ProblemView imports LazyMarkupWorkbench and not MarkupWorkbench.",
    ).toEqual([]);

    // The behavioural half of the same claim: no editor, and none arrives later.
    await expect(page.locator(".cm-content")).toHaveCount(0);
  });

  test("a markup problem still gets the editor, just later", async ({ page }) => {
    // The other side of the claim. Deferring a chunk is only correct if the chunk
    // still arrives; a placeholder that never resolved would look exactly like a
    // commendably fast page in the test above.
    // MEASURED, not merely opened. This used to call openProblem and so asserted
    // only that the lazy boundary RESOLVES — it would have passed identically with
    // the static import restored, leaving the whole block proving nothing about
    // deferral. Going through scriptBytesFor means the editor chunk asserted
    // present here is the same artefact the test above asserts is absent: one
    // measurement, two directions.
    await scriptBytesFor(page, `/problems/${SEEDED.cssGraded}`);
    expect(
      editorChunks.length,
      "a markup problem must still download the editor — deferring a chunk is only " +
        "correct if the chunk then arrives",
    ).toBeGreaterThan(0);

    await expect(page.getByTestId("live-editor")).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    // The sized placeholder must not still be on screen once the real thing is.
    await expect(page.getByTestId("problem-markup-editor-loading")).toHaveCount(0);
  });
});

test.describe("tab state survives the workbench's own re-renders", () => {
  test.setTimeout(SLOW_TEST_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  /**
   * The product owner's report, on the page where it is most plausible.
   *
   * MarkupWorkbench is a CLIENT component holding five pieces of state, so unlike
   * /practice — a server component throughout — this page genuinely re-renders
   * above a mounted editor. That made it the prime suspect for "we click to open
   * js code, it opens and then switches back to html page, and does not keep the
   * changes."
   *
   * It is not the cause. MarkupWorkbench.tsx:114 memoises the exercise, so the
   * editor is handed the same object across those re-renders, and this test passes
   * with and without the LiveEditor fix. It is a GUARD, and the only place the
   * claim is checked against a real browser driving a real Sandpack. The mechanism
   * itself is proven in src/components/exercises/LiveEditor.tabstate.test.tsx,
   * which can supply the trigger directly and fails with
   * `expected '/index.html' to be '/app.js'` when the memoisation is reverted.
   */
  test("the second tab stays open when Check re-renders the workbench", async ({ page }) => {
    // The CSS problem's starter is a two-file bundle, so it has two tabs.
    await openProblem(page, SEEDED.cssGraded);
    const editor = page.getByTestId("live-editor");
    await expect(editor).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });

    const tabs = editor.locator(".sp-tab-button");
    const tabCount = await tabs.count();
    expect(tabCount, "a one-tab exercise would make this vacuous").toBeGreaterThan(1);

    const second = tabs.nth(tabCount - 1);
    const secondName = (await second.textContent())?.trim() ?? "";
    await second.click();
    await expect(second).toHaveAttribute("data-active", "true");

    const code = editor.locator(".cm-content").first();
    const marker = `checkstate${Date.now()}`;
    await code.click();
    await page.keyboard.press("ControlOrMeta+End");
    // insertText, not type(), for the reason replaceEditorContents documents:
    // CodeMirror's auto-close-brackets would rewrite what this test typed.
    await page.keyboard.insertText(`\n/* ${marker} */`);
    await expect(code).toContainText(marker);

    // The trigger: Check sets two pieces of state and mounts a results Card below
    // the editor, so the whole workbench re-renders with the editor still mounted.
    await page.getByTestId("problem-check").click();
    await expect(page.getByTestId("problem-check-results")).toBeVisible({
      timeout: EDITOR_TIMEOUT_MS,
    });

    await expect(
      second,
      `tab "${secondName}" must still be open — snapping back to /index.html IS the report`,
    ).toHaveAttribute("data-active", "true");
    await expect(code, "the edit must survive the re-render").toContainText(marker);
  });

  test("the second tab stays open when a hint is revealed", async ({ page }) => {
    // The lightest re-render available: one counter and one <li>. Worth its own
    // test rather than folding into the case above, because if the memoisation
    // ever goes this is the cheapest interaction that would expose it.
    await openProblem(page, SEEDED.cssGraded);
    const editor = page.getByTestId("live-editor");
    await expect(editor).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });

    const hintReveal = page.getByTestId("problem-hint-reveal");
    // Stated rather than silently skipped: a content change that dropped the hints
    // would otherwise turn this into a test that can only pass.
    test.skip((await hintReveal.count()) === 0, `${SEEDED.cssGraded} has no hints to reveal`);

    const tabs = editor.locator(".sp-tab-button");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);
    const second = tabs.nth(tabCount - 1);
    await second.click();
    await expect(second).toHaveAttribute("data-active", "true");

    await hintReveal.click();
    await expect(page.getByTestId("problem-hint").first()).toBeVisible();

    await expect(second, "revealing a hint must not close the student's tab").toHaveAttribute(
      "data-active",
      "true",
    );
  });
});
