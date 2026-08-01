import { test, expect, type Page } from "@playwright/test";

import { NAV_LINKS } from "../../../src/components/nav/nav-links";

// ui-shell e2e. Target is the primitive reference page at /_ui.
//
// NOTE ON THE ROUTE: App Router treats a folder starting with "_" as private and
// gives it no URL, so the page lives at src/app/%5Fui/page.tsx — the documented
// Next.js escape that serves the URL /_ui. If this spec 404s, that folder name
// is the first thing to check.
//
// No database and no session are involved, so unlike the other streams' specs
// this one is safe to run in parallel and needs no seed.

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

test.describe("/_ui primitive reference", () => {
  test.beforeEach(async ({ page }) => {
    await openReference(page);
  });

  test("every primitive section renders", async ({ page }) => {
    for (const id of [
      "nav",
      "button",
      "card",
      "badge",
      "lockbadge",
      "progress",
      "stars",
      "avatar",
      "empty",
      "toast",
    ]) {
      await expect(
        page.getByTestId(`section-${id}`),
        `section-${id} should render`,
      ).toBeVisible();
    }
  });

  test("the shell renders a top bar, a sidebar and a skip link", async ({
    page,
  }) => {
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(page.getByTestId("brand-mark")).toBeVisible();
    await expect(page.getByTestId("role-badge")).toHaveText("Student");
    await expect(page.getByTestId("sidebar")).toHaveAttribute(
      "data-role",
      "student",
    );
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toBeAttached();
  });

  test("Button renders all variants and sizes; disabled blocks the click", async ({
    page,
  }) => {
    const section = page.getByTestId("section-button");
    // 5 variants x 3 sizes = 15 in the matrix.
    for (const variant of [
      "primary",
      "secondary",
      "accent",
      "ghost",
      "danger",
    ]) {
      await expect(
        section.locator(`button[data-variant="${variant}"]`).first(),
      ).toBeVisible();
    }
    for (const size of ["sm", "md", "lg"]) {
      await expect(
        section.locator(`button[data-size="${size}"]`).first(),
      ).toBeVisible();
    }

    const counter = page.getByTestId("button-click-count");
    await expect(counter).toHaveText("clicks: 0");
    await section.locator('button[data-variant="primary"]').first().click();
    await expect(counter).toHaveText("clicks: 1");

    const disabled = page.getByTestId("button-disabled");
    await expect(disabled).toBeDisabled();
    await disabled.click({ force: true });
    await expect(counter).toHaveText("clicks: 1");

    await expect(page.getByTestId("button-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByTestId("button-fullwidth")).toBeVisible();
  });

  test("Card, Badge, LockBadge, Avatar and EmptyState render", async ({
    page,
  }) => {
    await expect(
      page.getByTestId("section-card").getByTestId("card"),
    ).toHaveCount(4);

    // 6 tones at md + 6 at sm.
    await expect(
      page.getByTestId("section-badge").getByTestId("badge"),
    ).toHaveCount(12);

    const locks = page.getByTestId("section-lockbadge").getByTestId("lock-badge");
    await expect(locks).toHaveCount(3);
    await expect(locks.filter({ hasText: "Locked" }).first()).toHaveAttribute(
      "data-locked",
      "true",
    );
    await expect(locks.filter({ hasText: "Unlocked" })).toHaveAttribute(
      "data-locked",
      "false",
    );

    const avatarSection = page.getByTestId("section-avatar");
    await expect(avatarSection.getByTestId("avatar")).toHaveCount(6);
    // Assert the visible glyph, not the avatar's textContent: the fallback also
    // carries an sr-only copy of the full name for screen readers.
    const initials = avatarSection.getByTestId("avatar-initials");
    await expect(initials).toHaveCount(5); // the 6th avatar has an image
    await expect(initials.nth(0)).toHaveText("AL");
    await expect(initials.nth(2)).toHaveText("GH"); // Grace ... Hopper
    await expect(initials.nth(3)).toHaveText("PR"); // single name -> 2 letters
    await expect(initials.nth(4)).toHaveText("?"); // empty name
    await expect(avatarSection.getByRole("img", { name: "With image" })).toBeVisible();

    await expect(
      page.getByTestId("section-empty").getByTestId("empty-state"),
    ).toHaveCount(2);
  });

  test("ProgressBar exposes aria-valuenow and clamps bad input", async ({
    page,
  }) => {
    const section = page.getByTestId("section-progress");
    const bars = section.getByRole("progressbar");
    await expect(bars).toHaveCount(10);

    await expect(
      page.getByTestId("progress-negative").getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(
      page.getByTestId("progress-over").getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "100");
    await expect(
      page.getByTestId("progress-nan").getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "0");

    await expect(
      section.getByRole("progressbar", { name: "Week 2 quiz" }),
    ).toHaveAttribute("aria-valuenow", "42");
  });

  test("StarRating responds to clicks 1..5", async ({ page }) => {
    const rating = page.getByTestId("rating-interactive");
    const readout = page.getByTestId("rating-value");

    await expect(rating).toHaveAttribute("data-value", "0");
    await expect(readout).toHaveText("value: 0");

    for (const n of [1, 2, 3, 4, 5]) {
      await rating.locator(`[data-testid="star"][data-value="${n}"]`).click();
      await expect(rating).toHaveAttribute("data-value", String(n));
      await expect(readout).toHaveText(`value: ${n}`);
      await expect(
        rating.getByRole("radio", { name: `${n} star${n === 1 ? "" : "s"}` }),
      ).toHaveAttribute("aria-checked", "true");
    }

    // Clicking back down works too — a 5 must not be a one-way door.
    await rating.locator('[data-testid="star"][data-value="2"]').click();
    await expect(readout).toHaveText("value: 2");

    await page.getByTestId("rating-reset").click();
    await expect(readout).toHaveText("value: 0");
  });

  test("StarRating is keyboard operable and read-only mode is inert", async ({
    page,
  }) => {
    const rating = page.getByTestId("rating-interactive");

    await rating.locator('[data-testid="star"][data-value="3"]').click();
    await expect(page.getByTestId("rating-value")).toHaveText("value: 3");

    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("rating-value")).toHaveText("value: 4");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("rating-value")).toHaveText("value: 3");
    await page.keyboard.press("End");
    await expect(page.getByTestId("rating-value")).toHaveText("value: 5");
    await page.keyboard.press("Home");
    await expect(page.getByTestId("rating-value")).toHaveText("value: 1");

    // Read-only examples: 0..5, no radios, clicking changes nothing.
    for (const n of [0, 1, 2, 3, 4, 5]) {
      const readOnly = page.getByTestId(`rating-readonly-${n}`);
      await expect(readOnly).toHaveAttribute("data-readonly", "true");
      await expect(readOnly).toHaveAttribute("data-value", String(n));
      await expect(readOnly.getByRole("radio")).toHaveCount(0);
    }

    const three = page.getByTestId("rating-readonly-3");
    await three.locator('[data-testid="star"][data-value="5"]').click();
    await expect(three).toHaveAttribute("data-value", "3");
  });

  test("Toast renders all tones with the right live-region role", async ({
    page,
  }) => {
    const section = page.getByTestId("section-toast");
    await expect(section.getByTestId("toast")).toHaveCount(5);

    await expect(
      section.locator('[data-testid="toast"][data-tone="info"]').first(),
    ).toHaveAttribute("role", "status");
    await expect(
      section.locator('[data-testid="toast"][data-tone="success"]'),
    ).toHaveAttribute("role", "status");
    await expect(
      section.locator('[data-testid="toast"][data-tone="warning"]'),
    ).toHaveAttribute("role", "alert");
    await expect(
      section.locator('[data-testid="toast"][data-tone="error"]'),
    ).toHaveAttribute("role", "alert");

    // Pushed toasts land in the fixed viewport and can be dismissed.
    await page.getByTestId("toast-trigger-error").click();
    const viewport = page.getByTestId("toast-viewport");
    await expect(viewport.getByTestId("toast")).toHaveCount(1);
    await viewport
      .getByRole("button", { name: "Dismiss notification" })
      .click();
    await expect(viewport.getByTestId("toast")).toHaveCount(0);
  });

  test("navigation is data-driven: switching role swaps the link set", async ({
    page,
  }) => {
    const sidebar = page.getByTestId("sidebar");
    const preview = page.getByTestId("nav-link-preview");

    // DERIVED from nav-links.ts, not hardcoded. This assertion read `5` and had
    // been failing since five nav links were added (/learn, /problems,
    // /interview, /settings, /admin/videos) — a hand-kept count drifts, and it
    // drifts in the direction of FAILING here or, worse, of silently passing.
    // The same derivation was already applied to nav-links.test.tsx for exactly
    // this reason; this spec was missed.
    await expect(sidebar.getByTestId("sidebar-link")).toHaveCount(
      NAV_LINKS.student.length,
    );
    await expect(sidebar.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(preview).toHaveAttribute("data-role", "student");

    await page.getByTestId("role-switch-instructor").click();
    await expect(sidebar).toHaveAttribute("data-role", "instructor");
    await expect(page.getByTestId("role-badge")).toHaveText("Instructor");
    await expect(
      sidebar.getByRole("link", { name: "Grading queue" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Dashboard" }),
    ).toHaveCount(0);

    await page.getByTestId("role-switch-admin").click();
    await expect(sidebar).toHaveAttribute("data-role", "admin");
    await expect(page.getByTestId("role-badge")).toHaveText("Admin");
    await expect(sidebar.getByTestId("sidebar-link")).toHaveCount(
      NAV_LINKS.admin.length,
    );
    await expect(sidebar.getByRole("link", { name: "Deadlines" })).toBeVisible();
  });

  test("brand colours come from the config-mirrored tokens", async ({
    page,
  }) => {
    // app.config branding.colors.primary === #4f5bd5 === rgb(79, 91, 213).
    // If this fails, globals.css @theme has drifted from app.config.ts.
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-brand")
        .trim(),
    );
    expect(brand.toLowerCase()).toBe("#4f5bd5");

    const badgeColor = await page
      .getByTestId("role-badge")
      .evaluate((el) => getComputedStyle(el).color);
    expect(badgeColor).toBe("rgb(79, 91, 213)");
  });
});

test.describe("public landing page", () => {
  // ui-shell replaced the Wave 0 placeholder at src/app/page.tsx, so it owns
  // this. No AppShell here: there is no session and therefore no role.
  test("renders branding from app.config and links into the auth flow", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Code Queens LMS" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Web Development Internship" }),
    ).toBeVisible();
    await expect(page.getByText("70% to unlock the next week")).toBeVisible();

    // Auth owns these routes; the landing page only points at them.
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/register");
    await expect(page.getByRole("link", { name: "/_ui" })).toHaveAttribute(
      "href",
      "/_ui",
    );

    // No AppShell chrome on a public page.
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });
});

test.describe("/_ui on a narrow viewport", () => {
  test("the sidebar is a toggleable drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReference(page);

    const sidebar = page.getByTestId("sidebar");
    const toggle = page.getByTestId("sidebar-toggle");

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toHaveAttribute("data-open", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("sidebar-scrim")).toBeVisible();

    // Click a point that is ACTUALLY EXPOSED, rather than the element's centre.
    //
    // The scrim is `fixed inset-0` (AppShell.tsx:73), so its bounding box is the
    // whole viewport and Playwright's default click target is the viewport centre
    // — x ≈ 195 at this 390 px width. The open drawer is `w-64` (256 px) at z-40
    // against the scrim's z-30 (Sidebar.tsx:42), so that centre point sits UNDER
    // the drawer and the hit-target check can never succeed: the click retried
    // until the 30 s test timeout.
    //
    // `position` is relative to the element's top-left, which here is the
    // viewport's, so x = 330 is in the strip of scrim to the RIGHT of the drawer.
    // That is the part a real user taps to dismiss it, so this is the truer
    // gesture as well as the deterministic one.
    await page.getByTestId("sidebar-scrim").click({ position: { x: 330, y: 400 } });
    await expect(sidebar).toHaveAttribute("data-open", "false");
  });
});
