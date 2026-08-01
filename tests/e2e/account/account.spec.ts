// =============================================================================
// ACCOUNT E2E — owned by the `account` stream.
// -----------------------------------------------------------------------------
// WHY THIS SPEC NEVER TOUCHES THE DEMO ACCOUNTS.
//
// Every other stream's suite logs in as student@codequeenshub.test with
// DEMO_PASSWORD from tests/fixtures.ts. This spec CHANGES PASSWORDS, so using that
// account would leave the shared database with a password no other spec knows and
// break twelve suites at once. It therefore registers a throwaway student per run,
// exactly as tests/e2e/auth/auth.spec.ts does — and inherits that file's caveat:
//
//   ACCUMULATING ROWS. Each run inserts a `e2e-account-…@codequeenshub.test` user
//   that is never deleted, plus its auth_tokens rows. Deliberate: a spec that
//   cleans up after itself cannot prove the row was written, and a failed run
//   leaves the evidence behind. TODO(ops): fold these into the periodic cleanup of
//   'e2e-%@codequeenshub.test' that auth.spec.ts already asks for.
//
// SERIAL, and stateful across tests: the password changes as the file progresses,
// and `currentPassword` tracks it. playwright.config.ts already pins workers to 1.
//
// THE RESET FLOW IS EXERCISED THROUGH THE DEV MAIL TRANSPORT — no SMTP, which is
// the project's default state (FREE_STACK.md). The link is read back from
// GET /api/account/dev-outbox, which 404s outside development. See that route's
// header for why it exists and how it is fenced off.
//
// TODO(test): THE RESET TESTS REQUIRE A DEVELOPMENT SERVER. playwright.config.ts
// runs `next build && next start` when CI is set, which makes NODE_ENV=production,
// and /api/account/dev-outbox then correctly 404s — so "completes a real reset
// through the dev transport" FAILS under `CI=true npx playwright test`, with the
// explanatory message attached to the status assertion in latestResetLink().
// Deliberately a failure and not a skip: a silently skipped reset test is how an
// untested password-reset flow reaches production. Options, none chosen here
// because it is a harness decision the devops-testing stream owns:
//   (a) run this spec's reset tests only against the dev server (a separate
//       Playwright project without the production webServer);
//   (b) point a CI run at a capture SMTP server (e.g. a Docker MailHog) and read
//       the link from its API instead of the dev outbox;
//   (c) gate these two tests on `process.env.NODE_ENV !== "production"` and accept
//       that CI does not cover the reset flow end to end.
// =============================================================================

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/** A unique, obviously-synthetic account for this run. */
const EMAIL = `e2e-account-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}@codequeenshub.test`;
const NAME = "E2E Account Student";

const FIRST_PASSWORD = "E2eAccount!1";
const SECOND_PASSWORD = "E2eAccount!2";
const THIRD_PASSWORD = "E2eAccount!3";

/** Mutated as the file progresses. See the serial note in the header. */
let currentPassword = FIRST_PASSWORD;

async function register(page: Page): Promise<void> {
  await page.goto("/register");
  await page.fill('input[name="name"]', NAME);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', FIRST_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/register/, { timeout: 15_000 });
}

async function login(page: Page, password: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

async function loginExpectingSuccess(page: Page, password: string): Promise<void> {
  await login(page, password);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Newest reset link for `email` from the dev transport's outbox. */
async function latestResetLink(
  request: APIRequestContext,
  email: string,
): Promise<string | null> {
  const response = await request.get("/api/account/dev-outbox");
  expect(
    response.status(),
    "dev-outbox must be reachable: the dev server must run with NODE_ENV=development and no SMTP_* set",
  ).toBe(200);

  const body = await response.json();
  expect(body.ok).toBe(true);

  for (const message of body.data.messages as Array<{ to: string; text: string }>) {
    if (message.to !== email) continue;
    const match = /https?:\/\/\S*\/reset-password\?token=[0-9a-f]{64}/.exec(message.text);
    if (match) return match[0];
  }
  return null;
}

// ---------------------------------------------------------------------------

test.describe("account settings", () => {
  test("anonymous visitor cannot reach /settings", async ({ page }) => {
    await page.goto("/settings");
    // /settings is not in middleware's PROTECTED prefix table, so this proves the
    // (app) layout's requireUser() is doing the work. If the redirect ever stops
    // happening, the prefix must be added to middleware (auth stream's file).
    await expect(page).toHaveURL(/\/login/);
  });

  test("registers a throwaway student and shows email and role as read-only", async ({
    page,
  }) => {
    await register(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();

    // Email and role are rendered as text, not inputs. A self-service role change
    // is privilege escalation, so there is no control to change it.
    await expect(page.getByTestId("readonly-email")).toHaveText(EMAIL);
    await expect(page.getByTestId("readonly-role")).toHaveText("Student");
    await expect(page.locator('input[name="role"]')).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
  });

  test("saves the editable profile fields and they survive a reload", async ({ page }) => {
    await loginExpectingSuccess(page, currentPassword);

    await page.goto("/settings");
    await page.fill('input[name="name"]', "E2E Renamed Student");
    await page.fill('textarea[name="bio"]', "Learning to ship in metric units.");
    await page.fill('input[name="githubProfile"]', "https://github.com/e2e-demo");
    await page.fill('input[name="avatarUrl"]', "https://cdn.example.test/avatar.png");
    await page.getByTestId("save-profile").click();

    await expect(page.getByTestId("profile-notice")).toHaveAttribute("data-tone", "success");

    await page.goto("/settings");
    await expect(page.locator('input[name="name"]')).toHaveValue("E2E Renamed Student");
    await expect(page.locator('textarea[name="bio"]')).toHaveValue(
      "Learning to ship in metric units.",
    );
    await expect(page.locator('input[name="githubProfile"]')).toHaveValue(
      "https://github.com/e2e-demo",
    );
  });

  test("rejects a malformed profile link instead of storing it", async ({ page }) => {
    await loginExpectingSuccess(page, currentPassword);
    await page.goto("/settings");
    await page.fill('input[name="githubProfile"]', "github.com/no-scheme");
    await page.getByTestId("save-profile").click();
    await expect(page.getByTestId("profile-notice")).toHaveAttribute("data-tone", "error");
  });

  test("a PATCH carrying role=admin does not escalate", async ({ page }) => {
    await loginExpectingSuccess(page, currentPassword);

    // The API is a public POST target; the form not showing a role control proves
    // nothing about what a hand-built request can do.
    const patch = await page.request.patch("/api/account/profile", {
      data: {
        name: "E2E Renamed Student",
        role: "admin",
        email: "attacker@example.test",
      },
    });
    expect(patch.status()).toBe(200);
    const patched = await patch.json();
    expect(patched.data.role).toBe("student");
    expect(patched.data.email).toBe(EMAIL);
    expect(patched.data).not.toHaveProperty("passwordHash");

    // And the session's own view of the role is unchanged.
    const me = await page.request.get("/api/auth/me");
    const body = await me.json();
    expect(body.data.role).toBe("student");
  });
});

test.describe("password change", () => {
  test("refuses a WRONG current password, and the old password still works", async ({
    page,
  }) => {
    await loginExpectingSuccess(page, currentPassword);
    await page.goto("/settings");

    await page.fill('input[name="currentPassword"]', "definitely-not-it");
    await page.fill('input[name="newPassword"]', SECOND_PASSWORD);
    await page.fill('input[name="confirmPassword"]', SECOND_PASSWORD);
    await page.getByTestId("change-password").click();

    await expect(page.getByTestId("password-notice")).toHaveAttribute("data-tone", "error");

    // The refusal must not have written anything: this is the property that stops a
    // stolen session from becoming permanent account ownership.
    const attempt = await page.request.post("/api/account/password", {
      data: {
        currentPassword: SECOND_PASSWORD,
        newPassword: THIRD_PASSWORD,
        confirmPassword: THIRD_PASSWORD,
      },
    });
    expect(attempt.status()).toBe(403);
  });

  test("refuses a mismatched confirmation", async ({ page }) => {
    await loginExpectingSuccess(page, currentPassword);
    await page.goto("/settings");
    await page.fill('input[name="currentPassword"]', currentPassword);
    await page.fill('input[name="newPassword"]', SECOND_PASSWORD);
    await page.fill('input[name="confirmPassword"]', `${SECOND_PASSWORD}x`);
    await page.getByTestId("change-password").click();
    await expect(page.getByTestId("password-notice")).toHaveAttribute("data-tone", "error");
  });

  test("accepts the CORRECT current password, and the new one then signs in", async ({
    page,
  }) => {
    await loginExpectingSuccess(page, currentPassword);
    await page.goto("/settings");

    await page.fill('input[name="currentPassword"]', currentPassword);
    await page.fill('input[name="newPassword"]', SECOND_PASSWORD);
    await page.fill('input[name="confirmPassword"]', SECOND_PASSWORD);
    await page.getByTestId("change-password").click();

    await expect(page.getByTestId("password-notice")).toHaveAttribute("data-tone", "success");
    currentPassword = SECOND_PASSWORD;

    // Prove it against a fresh session rather than trusting the banner.
    await page.context().clearCookies();
    await loginExpectingSuccess(page, SECOND_PASSWORD);

    await page.context().clearCookies();
    await login(page, FIRST_PASSWORD);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("form-error")).toBeVisible();
  });
});

test.describe("password reset by email", () => {
  test("answers identically for a registered and an unregistered address", async ({ page }) => {
    // The no-enumeration property, observed from outside. Any difference here —
    // text, tone, status, redirect — is the whole cohort's roster.
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "definitely-nobody@codequeenshub.test");
    await page.getByTestId("request-reset").click();
    await expect(page.getByTestId("forgot-notice")).toHaveAttribute("data-tone", "success");
    const unknownText = await page.getByTestId("forgot-notice").innerText();
    const unknownUrl = new URL(page.url()).pathname + new URL(page.url()).search;

    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', EMAIL);
    await page.getByTestId("request-reset").click();
    await expect(page.getByTestId("forgot-notice")).toHaveAttribute("data-tone", "success");
    const knownText = await page.getByTestId("forgot-notice").innerText();
    const knownUrl = new URL(page.url()).pathname + new URL(page.url()).search;

    expect(knownText).toBe(unknownText);
    expect(knownUrl).toBe(unknownUrl);

    // The API surface must match too.
    const a = await page.request.post("/api/account/reset-request", {
      data: { email: "definitely-nobody-2@codequeenshub.test" },
    });
    expect(a.status()).toBe(200);
    expect(await a.json()).toEqual({
      ok: true,
      data: expect.objectContaining({ accepted: true }),
    });
  });

  test("completes a real reset through the dev transport, and the link is single-use", async ({
    page,
  }) => {
    const link = await latestResetLink(page.request, EMAIL);
    expect(link, "the previous test requested a link for this address").not.toBeNull();

    const path = new URL(link!).pathname + new URL(link!).search;
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    await page.fill('input[name="newPassword"]', THIRD_PASSWORD);
    await page.fill('input[name="confirmPassword"]', THIRD_PASSWORD);
    await page.getByTestId("submit-reset").click();

    await expect(page.getByTestId("reset-done")).toBeVisible();
    currentPassword = THIRD_PASSWORD;

    // The reset did NOT sign anyone in — a link is not a session.
    const meAfterReset = await page.request.get("/api/auth/me");
    expect(meAfterReset.status()).toBe(401);

    // The new password works.
    await loginExpectingSuccess(page, THIRD_PASSWORD);
    await page.context().clearCookies();

    // SINGLE USE: the same link, replayed, is refused. A link forwarded from a
    // mailbox must not be redeemable twice.
    await page.goto(path);
    await page.fill('input[name="newPassword"]', "Replay3dPassw0rd!");
    await page.fill('input[name="confirmPassword"]', "Replay3dPassw0rd!");
    await page.getByTestId("submit-reset").click();
    await expect(page.getByTestId("reset-notice")).toHaveAttribute("data-tone", "error");

    // ...and the replay changed nothing.
    await loginExpectingSuccess(page, THIRD_PASSWORD);
  });

  test("a garbage token is refused with the same generic message", async ({ page }) => {
    await page.goto(`/reset-password?token=${"f".repeat(64)}`);
    await page.fill('input[name="newPassword"]', "Whatever!123");
    await page.fill('input[name="confirmPassword"]', "Whatever!123");
    await page.getByTestId("submit-reset").click();
    await expect(page.getByTestId("reset-notice")).toHaveAttribute("data-tone", "error");
    // No form is offered without a plausible token at all.
    await page.goto("/reset-password");
    await expect(page.getByTestId("reset-notice")).toBeVisible();
    await expect(page.locator('input[name="newPassword"]')).toHaveCount(0);
  });

  test("the reset-confirm API reveals nothing about which cause refused it", async ({
    page,
  }) => {
    const unknown = await page.request.post("/api/account/reset-confirm", {
      data: {
        token: "a".repeat(64),
        newPassword: "Whatever!123",
        confirmPassword: "Whatever!123",
      },
    });
    expect(unknown.status()).toBe(400);
    const body = await unknown.json();
    expect(body.code).toBe("invalid_link");
    expect(JSON.stringify(body)).not.toMatch(/expired|used|unknown/i);
  });

  test("rate-limits repeated requests for one address", async ({ page }) => {
    // A fresh address, so this does not consume the quota of any other test.
    const target = `e2e-rl-${Date.now().toString(36)}@codequeenshub.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await page.request.post("/api/account/reset-request", {
        data: { email: target },
      });
      statuses.push(response.status());
    }
    // Per-email quota is 3 per 15 minutes, so the tail must be refused.
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
  });
});
