import { test, expect, type Page } from "@playwright/test";

// =============================================================================
// ui-shell e2e — PRIMITIVE ANIMATION AND ITS REDUCED-MOTION BRANCH
// -----------------------------------------------------------------------------
// Target is the primitive reference page at /_ui (the %5Fui folder escape — see
// primitives.spec.ts for why the folder is named that). No database and no
// session, so this file is safe to run in parallel and needs no seed.
//
// WHAT THIS FILE IS FOR, AND WHY IT IS NOT A COMPONENT TEST.
// The vitest suites next to the components can only assert that a CLASS NAME is
// on an element. That is worth having, but it proves nothing about the thing
// that actually matters here: jsdom has no cascade, no @media evaluation and no
// getComputedStyle for animations, so a component test passes identically
// whether globals.css animates that class, animates it wrongly, or does not
// define it at all. Only a real browser can answer "is this element actually
// animating, and does it stop when the user asks it to". Hence: every assertion
// below reads a COMPUTED style.
//
// The reduced-motion technique is copied from the interactive-exercises spec
// (tests/e2e/interactive-exercises/practice.spec.ts, "degrades to a static
// diagram under prefers-reduced-motion"): page.emulateMedia, a real media
// feature emulation, not a stubbed matchMedia.
// =============================================================================

const UI_PATH = "/_ui";

async function openReference(page: Page) {
  const response = await page.goto(UI_PATH);
  expect(
    response?.status(),
    `${UI_PATH} must resolve — a 404 means the %5Fui folder escape is wrong`,
  ).toBeLessThan(400);
  await expect(
    page.getByRole("heading", { name: "UI primitive reference" }),
  ).toBeVisible();
}

/** Computed animation-name of the first matching element. */
function animationName(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
}

/** Computed animation-duration, returned in MILLISECONDS (metric). */
async function animationDurationMs(page: Page, selector: string) {
  const raw = await page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).animationDuration);
  // Chromium reports "0.4s"; a ms-valued declaration can come back as "400ms".
  return raw.trim().endsWith("ms")
    ? Number.parseFloat(raw)
    : Number.parseFloat(raw) * 1000;
}

test.describe("motion allowed", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openReference(page);
  });

  test("the progress fill runs the grow keyframe, at the token duration", async ({
    page,
  }) => {
    const selector = '[data-testid="progress-bar-fill"][data-animated="true"]';
    expect(await animationName(page, selector)).toBe("ui-progress-fill");
    // MOTION_MS.slow === 400 ms (src/lib/motion/tokens.ts, mirrored into
    // globals.css as --motion-slow). If this number moves, the mirror moved.
    expect(await animationDurationMs(page, selector)).toBe(400);
  });

  test("the per-call-site opt-out removes the keyframe, not just the class", async ({
    page,
  }) => {
    const fill = page
      .getByTestId("progress-static")
      .getByTestId("progress-bar-fill");
    await expect(fill).toHaveAttribute("data-animated", "false");
    expect(
      await fill.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
  });

  test("a progress bar ends at its real width, and says so in aria throughout", async ({
    page,
  }) => {
    // The animation is entry-only: aria-valuenow is the final value from the
    // first render, and the fill settles on the data-driven width. A bar left
    // at 0 because a keyframe was written with a fill-mode is exactly the bug
    // this asserts against.
    const bar = page
      .getByTestId("section-progress")
      .getByRole("progressbar", { name: "Week 2 quiz" });
    await expect(bar).toHaveAttribute("aria-valuenow", "42");

    // 42% of the track, within a pixel of rounding. Polled rather than measured
    // once: the 400 ms keyframe may still be running when this line is reached,
    // and a bare boundingBox() would be sampling a moving element. Polling also
    // makes the failure meaningful — it means the bar never ARRIVED at 42%.
    await expect
      .poll(async () => {
        const track = await bar.boundingBox();
        const fill = await bar.getByTestId("progress-bar-fill").boundingBox();
        if (!track || !fill) return Number.NaN;
        return Math.abs(fill.width - track.width * 0.42);
      })
      .toBeLessThan(2);
  });

  test("the skeleton shimmer loops", async ({ page }) => {
    const selector = '[data-testid="skeleton-bar"]';
    expect(await animationName(page, selector)).toBe("ui-skeleton-shimmer");
    expect(await animationDurationMs(page, selector)).toBe(1200); // MOTION_MS.ambient
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).animationIterationCount),
    ).toBe("infinite");
  });

  test("a pushed toast animates in and is readable immediately", async ({
    page,
  }) => {
    await page.getByTestId("toast-trigger-success").click();
    const toast = page.getByTestId("toast-viewport").getByTestId("toast");

    // Readable content is asserted BEFORE anything about the animation: the
    // constraint is that motion never gates the message.
    await expect(toast).toContainText("Pushed from the reference page.");
    expect(
      await toast.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("ui-toast-in");
  });

  test("an interactive card transitions transform; a plain one does not", async ({
    page,
  }) => {
    const props = await page
      .locator('[data-testid="card"][data-interactive="true"]')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(props).toContain("transform");
    expect(props).toContain("box-shadow");

    // A non-interactive card does not transition at all — it is not a target,
    // and a card that responds to a pointer promises a click it cannot honour.
    // Asserted on DURATION rather than on transition-property, because an
    // element with nothing declared reports the initial `all` for the property
    // and `0s` for the duration; the duration is the unambiguous half.
    const plainDuration = await page
      .locator('[data-testid="card"]:not([data-interactive])')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(plainDuration).toBe("0s");
  });

  test("buttons keep their colour transition after gaining the press one", async ({
    page,
  }) => {
    // The regression this guards: `transition` is winner-takes-all, and the
    // unlayered .ui-press rule in globals.css beats Tailwind's layered
    // `transition-colors`. If someone re-adds `transition-colors` to
    // Button.tsx, or drops the colour properties from .ui-press, every hover
    // fade in the app dies silently. Both must be in the one list.
    const props = await page
      .getByTestId("section-button")
      .locator('button[data-variant="primary"]')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(props).toContain("transform");
    expect(props).toContain("background-color");
  });
});

test.describe("prefers-reduced-motion: reduce", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReference(page);
  });

  test("every keyframe animation is off — not merely fast", async ({ page }) => {
    // The blanket rule in globals.css only clamps durations to 1 ms. These
    // assertions are what proves the explicit overrides on top of it exist:
    // "none" cannot be produced by the blanket.
    for (const selector of [
      '[data-testid="progress-bar-fill"][data-animated="true"]',
      '[data-testid="skeleton-bar"]',
    ]) {
      expect(await animationName(page, selector), selector).toBe("none");
    }

    await page.getByTestId("toast-trigger-success").click();
    const toast = page.getByTestId("toast-viewport").getByTestId("toast");
    await expect(toast).toBeVisible();
    expect(
      await toast.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
  });

  test("nothing is lost: the bar still shows its value and the toast its text", async ({
    page,
  }) => {
    // The house rule from src/lib/exercises/reduced-motion.ts — reduced motion
    // degrades to a STATIC version, it never removes information.
    const bar = page
      .getByTestId("section-progress")
      .getByRole("progressbar", { name: "Week 2 quiz" });
    await expect(bar).toHaveAttribute("aria-valuenow", "42");

    await expect
      .poll(async () => {
        const track = await bar.boundingBox();
        const fill = await bar.getByTestId("progress-bar-fill").boundingBox();
        if (!track || !fill) return Number.NaN;
        return Math.abs(fill.width - track.width * 0.42);
      })
      .toBeLessThan(2);

    // The skeleton loses its shimmer, so its meaning has to survive in the
    // accessibility tree instead.
    const skeleton = page.getByTestId("skeleton").first();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(skeleton).toHaveAttribute("role", "status");
    // ...and it must not be a frozen half-lit gradient, which reads as a bug.
    expect(
      await page
        .locator('[data-testid="skeleton-bar"]')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toBe("none");
  });

  test("hover and press do not move anything", async ({ page }) => {
    // The part a `hover:-translate-y-0.5` utility could never deliver: with the
    // blanket rule alone the card would still hop, just in 1 ms.
    const card = page
      .locator('[data-testid="card"][data-interactive="true"]')
      .first();
    await card.hover();
    expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe(
      "none",
    );

    const button = page
      .getByTestId("section-button")
      .locator('button[data-variant="primary"]')
      .first();
    await button.hover();
    expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe(
      "none",
    );
  });

  test("the star rating is still fully operable with motion off", async ({
    page,
  }) => {
    // Motion is the affordance being removed; the FUNCTION must be untouched.
    const rating = page.getByTestId("rating-interactive");
    await rating.locator('[data-testid="star"][data-value="4"]').click();
    await expect(page.getByTestId("rating-value")).toHaveText("value: 4");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("rating-value")).toHaveText("value: 3");
  });
});

test.describe("star rating preview", () => {
  // Not strictly an animation, but it is the state-change feedback added in the
  // same pass and the reason the control now feels responsive, so it is proven
  // in the same place. It is pointer state, which vitest can only simulate with
  // a synthetic event — this is the real thing.
  test("hover previews a rating without committing it", async ({ page }) => {
    await openReference(page);
    const rating = page.getByTestId("rating-interactive");
    const readout = page.getByTestId("rating-value");

    await expect(rating).toHaveAttribute("data-value", "0");
    await rating.locator('[data-testid="star"][data-value="4"]').hover();

    await expect(rating).toHaveAttribute("data-preview", "4");
    // The committed value has NOT moved — a mouse crossing the widget must not
    // regrade a submission.
    await expect(rating).toHaveAttribute("data-value", "0");
    await expect(readout).toHaveText("value: 0");

    // Leaving the group clears it.
    await page.getByTestId("rating-reset").hover();
    await expect(rating).toHaveAttribute("data-preview", "0");
  });
});
