// =============================================================================
// E2E — interactive exercises (live editor + animated explainers)
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// NOT RUN BY THIS STREAM. Nine streams share one dev server and one port during
// this wave, so the coordinator runs the e2e suites serially at integration.
// Everything below is written against the shared fixtures in tests/e2e/fixtures.ts
// and the seeded content in scripts/seed-content.ts — no invented data.
//
// What only a real browser can prove, and therefore what is asserted here:
//   1. Sandpack actually mounts (it needs iframes, postMessage and a service
//      worker; in jsdom it cannot, which is why the component tests mock it).
//   2. Typing into the editor changes the PREVIEW IFRAME's DOM — i.e. the preview
//      is live, with no run button.
//   3. Reset-to-starter restores the seeded code.
//   4. The explainer mounts, steps, and degrades to a static diagram under
//      prefers-reduced-motion (a real media-feature emulation, not a stub).
// =============================================================================

import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAs } from "../fixtures";

/** Sandpack boots a bundler client and an iframe; allow for a slow first mount. */
const EDITOR_TIMEOUT_MS = 30_000;
/**
 * Per-test budget for the live-editor cases, in ms.
 *
 * These tests reach a THIRD-PARTY ORIGIN. Sandpack's `static` template renders
 * its preview inside an iframe served from
 * https://preview.sandpack-static-server.codesandbox.io — not from this app — so
 * a live-preview assertion depends on public internet egress to codesandbox.io
 * and on that service's latency. A slow first mount is normal, not a defect.
 *
 * The budget must exceed EDITOR_TIMEOUT_MS above. With the config default of
 * 30 s (playwright.config.ts) they were EQUAL, so a slow mount blew the test
 * budget before any expect could report which assertion was waiting: the run
 * showed a bare 30 s timeout. Observed for real — first attempt 30.1 s, retry #1
 * 30.3 s, retry #2 3.3 s once the remote assets were warm.
 */
const EDITOR_TEST_TIMEOUT_MS = 90_000;
/** The editor debounces edits before reloading the preview (PREVIEW_DEBOUNCE_MS). */
const PREVIEW_SETTLE_MS = 1_500;

/**
 * Open the first lecture that offers a live exercise. Deliberately discovered
 * through the UI rather than hardcoded: lecture ids are serial values reassigned
 * on every reseed, so a hardcoded /practice/3 breaks silently.
 */
async function openFirstExerciseLecture(page: Page): Promise<void> {
  await page.goto("/practice");
  await expect(page.getByTestId("practice-page")).toBeVisible();
  const open = page.getByTestId("practice-open-link").first();
  await expect(open).toBeVisible();
  await open.click();
  await expect(page.getByTestId("lecture-practice-page")).toBeVisible();
}

/**
 * Open a practice lecture carrying an exercise with MORE THAN ONE file, and
 * return that specific editor.
 *
 * The tab-state bug is only observable with multiple tabs, and only two of the
 * four seeded exercises qualify (scripts/seed-content.ts): "centre a card with
 * Flexbox" (/index.html + /styles.css) and "a working counter" (/index.html +
 * /app.js) — the latter being the product owner's own example of the failure.
 * `openFirstExerciseLecture` lands on a single-file week-1 exercise, against
 * which every assertion here would be vacuous.
 *
 * Discovers the lecture through the UI rather than hardcoding an id, for the
 * same reason `openFirstExerciseLecture` does: ids are serial and are reassigned
 * on every reseed.
 *
 * Two things this has to get right, both learned by getting them wrong:
 *
 *   - It must click `practice-open-link`, not the first link in the card. The
 *     card also renders a link per concept explainer, and those come out of
 *     `getByRole("link")` too — following one lands on /practice/concept/… ,
 *     which has no lecture editor at all.
 *   - It must SCROLL each editor into view before waiting for it. LiveEditor
 *     passes `initMode: "lazy"`, so Sandpack does not mount until the element
 *     is intersecting; a lecture's second exercise sits below the fold and its
 *     `.cm-content` never appears while the page stays at the top.
 *
 * Returns the editor rather than just navigating, because the multi-file
 * exercise is not necessarily the first one on the page — `.first()` in the
 * caller would silently re-test a single-file editor.
 */
async function openMultiFileExercise(page: Page): Promise<Locator> {
  await page.goto("/practice");
  await expect(page.getByTestId("practice-page")).toBeVisible();
  const lectureHrefs = await page
    .getByTestId("practice-open-link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

  for (const href of lectureHrefs) {
    await page.goto(href);
    await expect(page.getByTestId("lecture-practice-page")).toBeVisible();

    // The exercise list is code-split behind next/dynamic with `ssr: false`
    // (src/components/exercises/LazyExerciseList.tsx), so the server HTML carries
    // only the "Loading the live editor…" placeholder. Counting editors as soon
    // as the page is visible found ZERO on every lecture and made this helper
    // report "no multi-file exercise exists" — wait for the chunk to render.
    await page.getByTestId("exercise-list").waitFor({ timeout: EDITOR_TIMEOUT_MS });

    const editors = page.getByTestId("live-editor");
    const editorCount = await editors.count();
    for (let i = 0; i < editorCount; i++) {
      const editor = editors.nth(i);
      await editor.scrollIntoViewIfNeeded();
      await editor
        .locator(".cm-content")
        .first()
        .waitFor({ state: "visible", timeout: EDITOR_TIMEOUT_MS });
      if ((await editor.locator(".sp-tab-button").count()) > 1) return editor;
    }
  }

  throw new Error(
    `No multi-file practice exercise was reachable across ${lectureHrefs.length} ` +
      "practice lecture(s). Two of the four seeded exercises are multi-file " +
      "(Flexbox in week 2, the counter in week 3); if those weeks stopped being " +
      "listed on /practice, this scenario has lost its coverage.",
  );
}

test.describe("practice index", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("lists the seeded live exercises grouped by week", async ({ page }) => {
    await page.goto("/practice");
    await expect(page.getByRole("heading", { name: "Practice", level: 1 })).toBeVisible();
    // scripts/seed-content.ts seeds four sandpack exercises across weeks 1-3.
    await expect(page.getByTestId("practice-lecture-card")).toHaveCount(4);
    await expect(page.getByTestId("concept-index").getByRole("listitem")).toHaveCount(3);
  });

  test("requires a session", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/practice");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("live editor", () => {
  // Applies to the beforeEach as well as each test body.
  test.setTimeout(EDITOR_TEST_TIMEOUT_MS);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
    await openFirstExerciseLecture(page);
  });

  test("mounts an editor and a live preview", async ({ page }) => {
    const editor = page.getByTestId("live-editor").first();
    await expect(editor).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    // CodeMirror renders a textbox; the preview is an iframe.
    await expect(editor.locator(".cm-content").first()).toBeVisible({
      timeout: EDITOR_TIMEOUT_MS,
    });
    await expect(editor.locator("iframe").first()).toBeAttached({
      timeout: EDITOR_TIMEOUT_MS,
    });
  });

  // TODO(interactive-exercises): FAILS on the first real run (2026-07-30,
  // production build). The Sandpack preview iframe never receives the typed
  // document: locating #marker inside
  // [data-testid="live-editor"] iframe times out with "element(s) not found".
  // No server or database is involved — Sandpack fetches its bundler from a CDN,
  // so the likely causes are (a) the bundler being unreachable from the machine
  // running the suite, or (b) the preview never being handed the edited files.
  // Distinguish by watching the network panel for the CDN request before
  // changing any assertion here. Left failing rather than skipped: the live
  // preview is this stream's headline feature and a green skip would hide that
  // it is currently unverified end-to-end.
  test("typing HTML updates the preview iframe without a run step", async ({ page }) => {
    const editor = page.getByTestId("live-editor").first();
    const code = editor.locator(".cm-content").first();
    await expect(code).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });

    const marker = `live-preview-${Date.now()}`;
    await code.click();
    // Land inside <body>: the seeded skeletons put a TODO comment there.
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`<p id="marker">${marker}</p>`);

    const preview = editor.frameLocator("iframe").first();
    await expect(preview.locator("#marker")).toHaveText(marker, {
      timeout: EDITOR_TIMEOUT_MS,
    });
  });

  test("reset to starter code discards the student's edits", async ({ page }) => {
    const editor = page.getByTestId("live-editor").first();
    const code = editor.locator(".cm-content").first();
    await expect(code).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });

    await code.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("<p>THROWAWAY</p>");
    await expect(code).toContainText("THROWAWAY");

    const reset = page.getByTestId("exercise-reset").first();
    await reset.click(); // arms
    await expect(reset).toContainText(/discards your edits/i);
    await reset.click(); // confirms

    await expect(code).not.toContainText("THROWAWAY", { timeout: EDITOR_TIMEOUT_MS });
    await expect(code).toContainText("DOCTYPE");
  });

  test("explains a syntax error instead of showing a blank frame", async ({ page }) => {
    const editor = page.getByTestId("live-editor").first();
    const code = editor.locator(".cm-content").first();
    await expect(code).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });

    await code.click();
    await page.keyboard.press("Control+End");
    // Type a tag that pulls in a file which does not exist.
    //
    // Do NOT test the unclosed-container path by typing `<div>` alone: CodeMirror's
    // html mode has autoCloseTags on, so the moment you type `>` it inserts
    // `</div>` and the document is balanced. The linter is then CORRECT to stay
    // silent, and the assertion can never pass. (This cost a session: the silent
    // panel was misread as diagnoseFiles rejecting Sandpack's `{ code }` file
    // shape, which LiveEditor already flattens to plain strings before calling it.)
    //
    // `<script src="...">` is autoclose-proof for our purposes: the missing-asset
    // check reads the `src` attribute, not the tag balance, so it fires either way.
    await page.keyboard.type('<script src="nope.js">');
    await page.waitForTimeout(PREVIEW_SETTLE_MS);

    const panel = editor.getByTestId("exercise-diagnostics");
    // The error path: names the file, and says what to do about it.
    await expect(panel).toContainText(/nope\.js/);
    await expect(panel).toContainText(/no such file in this exercise/i);
    // The tag-balance path: autoclose puts `</script>` before the caret, not
    // after the typed text, so `<script>` really is left unclosed here.
    await expect(panel).toContainText(/<script> is opened/);
  });

  test("the editor and its controls are reachable by keyboard", async ({ page }) => {
    const reset = page.getByTestId("exercise-reset").first();
    await expect(reset).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await reset.focus();
    await expect(reset).toBeFocused();
    // The hint that makes the editor escapable must be on the page, not implied.
    await expect(page.getByText(/to move focus out/i).first()).toBeVisible();
  });
});

test.describe("animated concept explainers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("mounts, steps forward, and restarts", async ({ page }) => {
    await page.goto("/practice/concept/box-model");
    const animation = page.getByTestId("concept-animation");
    await expect(animation).toBeVisible();
    await expect(animation).toHaveAttribute("data-concept-id", "box-model");
    await expect(page.getByTestId("concept-caption")).toContainText("Step 1 of 5");

    await page.getByTestId("concept-next").click();
    await expect(page.getByTestId("concept-caption")).toContainText("Step 2 of 5");
    await expect(animation).toHaveAttribute("data-step", "1");

    await page.getByTestId("concept-restart").click();
    await expect(page.getByTestId("concept-caption")).toContainText("Step 1 of 5");
  });

  test("degrades to a static diagram under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/practice/concept/flex-axes");

    const animation = page.getByTestId("concept-animation");
    await expect(animation).toHaveAttribute("data-reduced-motion", "true");
    await expect(page.getByTestId("concept-motion-state")).toContainText(/motion off/i);
    // The diagram and both axis labels are still there — nothing vanished.
    await expect(page.getByTestId("concept-stage")).toBeVisible();
    await expect(page.getByTestId("concept-stage")).toContainText(/main axis/i);
    await expect(page.getByTestId("concept-stage")).toContainText(/cross axis/i);

    await page.getByTestId("concept-next").click();
    await expect(page.getByTestId("concept-caption")).toContainText("Step 2 of 4");
  });

  test("states the transition duration in milliseconds when motion is allowed", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/practice/concept/http-cycle");
    await expect(page.getByTestId("concept-motion-state")).toContainText("450 ms");
  });

  test("an unknown concept id 404s rather than erroring", async ({ page }) => {
    const response = await page.goto("/practice/concept/not-a-concept");
    expect(response?.status()).toBe(404);
  });
});

test.describe("empty and malformed states", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a lecture with no sandpack resource shows an empty state, not an error", async ({
    page,
  }) => {
    // Walk lecture ids until one without exercises is found. Seeded content has 12
    // lectures and only 4 exercises, so this terminates quickly — and it does not
    // hardcode an id that a reseed would invalidate.
    for (let lectureId = 1; lectureId <= 12; lectureId += 1) {
      const response = await page.goto(`/practice/${lectureId}`);
      if (response && response.status() === 404) continue;
      const empty = page.getByTestId("empty-state");
      if (await empty.count()) {
        await expect(empty).toContainText(/no in-browser exercise/i);
        return;
      }
    }
    // TODO(test): if this ever fails, every seeded lecture gained an exercise. Then
    // assert the empty state against a fixture lecture created with no resources
    // rather than deleting this coverage.
    throw new Error("No seeded lecture without a sandpack resource was found.");
  });

  test("a non-numeric lecture id 404s", async ({ page }) => {
    const response = await page.goto("/practice/not-a-number");
    expect(response?.status()).toBe(404);
  });
});

// ===========================================================================
// TAB STATE AND DRAFT PERSISTENCE
// ---------------------------------------------------------------------------
// Regression tests for the bug the product owner reported: "we have html code
// and we need to correct js code for increment button, when we click to open js
// code, it opens and then switches back to html page, and does not keep the
// changes."
//
// ROOT CAUSE, so the tests are read against it rather than guessed at: Sandpack's
// `useFiles` effect is keyed on `props.files` BY REFERENCE
// (@codesandbox/sandpack-react/dist/index.mjs, deps `[props.files,
// props.customSetup, props.template]`). Every producer of a SandpackExercise
// built a new object on each render, so any re-render above the editor ran
// `setState(getSandpackStateFromProps(props))` — rebuilding the files from the
// prop (edits gone) and recomputing activeFile from options.activeFile, which
// src/lib/exercises/parse.ts pins to /index.html. Hence "switches back to html".
//
// NOTHING in the suite covered tab switching or edit persistence before this.
//
// ---------------------------------------------------------------------------
// WHY THE THREE TAB TESTS BELOW PASS EITHER WAY — settled 2026-07-31, and no
// longer a TODO. Read before concluding they are vacuous.
// ---------------------------------------------------------------------------
// These four tests were run against the PRE-FIX LiveEditor.tsx to check they can
// actually fail. The result:
//
//   - "edits survive a full page reload"  -> FAILS pre-fix. The draft
//     persistence work is genuinely proven by this suite.
//   - the three TAB-STATE tests           -> PASS pre-fix, on both the desktop
//     and mobile projects.
//
// That is a limit of what a BROWSER test can reach, not evidence the hazard is
// imaginary. Sandpack resets when the `files` prop changes IDENTITY while the
// editor stays mounted, so reproducing it needs a parent that re-renders and
// rebuilds the exercise. Playwright can only trigger a re-render through a page,
// and every page hosting the editor is a server component.
//
// THE MECHANISM IS NOW PROVEN, just not from here. The trigger is supplied
// directly in src/components/exercises/LiveEditor.tabstate.test.tsx, a vitest
// component test that mocks @codesandbox/sandpack-react with a transcription of
// index.mjs:1365 + :2078 instead of a prop recorder, and mounts the editor under
// a stateful client parent. Revert the two memos in LiveEditor.tsx and it fails
// with `expected '/index.html' to be '/app.js'` — the owner's sentence, as an
// assertion message. Restore them and it passes. Run it with:
//   npx vitest run src/components/exercises/LiveEditor.tabstate.test.tsx
//
// WHAT WAS RULED OUT while hunting for a trigger inside the app, so that nobody
// repeats the search:
//   * MarkupWorkbench (/problems/[slug], /interview/[slug]) — the strongest lead,
//     and the FIRST client component in the app to host the editor. It is safe:
//     MarkupWorkbench.tsx:114-144 builds the exercise inside a React.useMemo keyed
//     on four primitives, so its own state changes hand the editor the same
//     object. Checked by driving the real component with the real editor (second
//     describe block in that test file); confirmed negative by de-memoising both
//     files, which does reproduce the bug, versus de-memoising either alone,
//     which does not.
//   * An RSC re-render delivering fresh props to a mounted editor. `grep -rn
//     "router.refresh\|useRouter\|startTransition" src` finds none, and every
//     revalidatePath call is in an admin/instructor action on a route that hosts
//     no editor (src/lib/{instructor,courses,videos,penalties,attendance}/
//     actions.ts, src/app/(app)/settings/actions.ts).
//   * The lazy wrappers (LazyExerciseList, LazyExercisePanel, LazyMarkupWorkbench)
//     are client components but hold no state, so they re-render only when their
//     server parent does, i.e. never.
//
// So: the three tab tests are GUARDS for the day a host page becomes stateful,
// the vitest file is the proof, and the owner's report still has no explanation
// AT /practice. To close that out, get from them: which page, which browser, and
// the exact sequence of clicks. The gaps still not covered anywhere are a
// non-Chromium engine and the counter exercise reached from the lecture page
// rather than /practice.
// ===========================================================================

test.describe("live editor — tab state and drafts", () => {
  test.setTimeout(EDITOR_TEST_TIMEOUT_MS);

  // NO localStorage clearing here. Playwright gives each test a fresh browser
  // context, so drafts are already isolated — and an addInitScript that cleared
  // storage would re-run on the RELOAD inside the persistence test below and
  // delete the very draft it was asserting.

  // The multi-file editor is located per test rather than in a beforeEach: the
  // helper returns WHICH editor to drive (the multi-file one is not necessarily
  // the first on the page) and a beforeEach has nowhere to hand that back.
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("selecting a non-HTML tab stays selected", async ({ page }) => {
    const editor = await openMultiFileExercise(page);

    const tabs = editor.locator(".sp-tab-button");
    const tabCount = await tabs.count();
    // A single-file exercise cannot exhibit the bug and would make this vacuous.
    expect(tabCount, "need a multi-file exercise to test tab switching").toBeGreaterThan(1);

    const lastTab = tabs.nth(tabCount - 1);
    const lastTabName = (await lastTab.textContent())?.trim() ?? "";
    await lastTab.click();
    await expect(lastTab).toHaveAttribute("data-active", "true");

    // Settle past the debounce window, which is when a stray re-render and the
    // resulting reset would previously have landed.
    await page.waitForTimeout(PREVIEW_SETTLE_MS);
    await expect(
      lastTab,
      `tab "${lastTabName}" must still be active — snapping back to HTML is the reported bug`,
    ).toHaveAttribute("data-active", "true");
  });

  test("tab and edits survive scrolling the exercise out of view and back", async ({ page }) => {
    // The scroll round trip is what a student actually does: open the JS tab,
    // scroll down to re-read the problem statement, scroll back up to type.
    //
    // This is the path `initMode` governs. The editor previously passed
    // "user-visible", which does NOT merely defer mounting — Sandpack also calls
    // unregisterAllClients() when the element leaves the viewport. "lazy" defers
    // the first mount the same way but never tears down afterwards.
    const editor = await openMultiFileExercise(page);
    const code = editor.locator(".cm-content").first();

    const tabs = editor.locator(".sp-tab-button");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);

    const lastTab = tabs.nth(tabCount - 1);
    const marker = `scroll${Date.now()}`;
    await lastTab.click();
    await code.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n// ${marker}`);
    await expect(code).toContainText(marker);

    // Out of view, far enough to leave the intersection observer's margin, then
    // back. `scrollIntoViewIfNeeded` would be a no-op here — the point is to make
    // the editor genuinely NOT intersecting.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(PREVIEW_SETTLE_MS);
    await page.evaluate(() => window.scrollTo(0, 0));
    await editor.scrollIntoViewIfNeeded();
    await page.waitForTimeout(PREVIEW_SETTLE_MS);

    await expect(lastTab, "the selected tab must survive a scroll round trip").toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(code, "edits must survive a scroll round trip").toContainText(marker);
  });

  test("edits on a non-HTML tab survive switching away and back", async ({ page }) => {
    const editor = await openMultiFileExercise(page);
    const code = editor.locator(".cm-content").first();

    const tabs = editor.locator(".sp-tab-button");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);

    const marker = `tabstate${Date.now()}`;
    await tabs.nth(tabCount - 1).click();
    await code.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n// ${marker}`);
    await expect(code).toContainText(marker);

    // Away to the first tab and back — the round trip the owner described.
    await tabs.nth(0).click();
    await expect(code).not.toContainText(marker);
    await tabs.nth(tabCount - 1).click();
    await expect(code, "the edit must still be on the tab it was typed into").toContainText(
      marker,
    );
  });

  test("edits survive a full page reload, and reset restores the starter", async ({ page }) => {
    // The locator is re-resolved on every use, so it still addresses the same
    // editor after the reloads below — but Sandpack mounts lazily, so each
    // reload needs the element scrolled back into view before it exists.
    const editor = await openMultiFileExercise(page);
    const code = editor.locator(".cm-content").first();

    const marker = `draft${Date.now()}`;
    await code.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n<!-- ${marker} -->`);
    await expect(code).toContainText(marker);
    // Outlast the save debounce before navigating away.
    await page.waitForTimeout(PREVIEW_SETTLE_MS);

    await page.reload();
    await editor.scrollIntoViewIfNeeded();
    await expect(code).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(code, "the draft must be restored after a reload").toContainText(marker);
    // Restoration is announced rather than silent: returning to your own
    // half-finished attempt with no explanation looks like broken content.
    await expect(editor.getByTestId("exercise-draft-restored")).toBeVisible();

    // Reset must reach the STARTER, not the restored draft. This is the trap in
    // seeding `files` from a draft: sandpack.resetAllFiles() restores the files
    // PROP, which would be the draft itself, so reset would appear to do nothing.
    // Two clicks because the button arms itself before it acts.
    await editor.getByTestId("exercise-reset").click();
    await editor.getByTestId("exercise-reset").click();
    await expect(code, "reset must discard the draft").not.toContainText(marker);
    await expect(editor.getByTestId("exercise-draft-restored")).toHaveCount(0);

    // And the reset must be durable — not reappear on the next visit.
    await page.reload();
    await editor.scrollIntoViewIfNeeded();
    await expect(code).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
    await expect(code).not.toContainText(marker);
  });
});
