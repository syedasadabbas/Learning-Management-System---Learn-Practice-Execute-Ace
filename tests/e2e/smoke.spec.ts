import { test, expect } from "@playwright/test";
import { expectNoServerError } from "./fixtures";

// Harness smoke test, owned by devops-testing. Its job is narrow: prove the
// Playwright harness, the web server, and the build actually work, so that when
// a feature stream's spec fails the cause is that feature and not the harness.

test.describe("harness smoke", () => {
  test("the app serves a page without a server error", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
    await expectNoServerError(page);
  });

  test("the configured app name and course title render", async ({ page }) => {
    await page.goto("/");
    // Values come from app.config, so this also proves config reaches the render.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Web Development Internship")).toBeVisible();
  });

  test("no uncaught console errors on the landing page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
