// =============================================================================
// AUTH E2E — owned by the auth stream.
// -----------------------------------------------------------------------------
// Runs against the REAL, seeded Neon database (see playwright.config.ts). Nothing
// here is mocked: registration writes an actual `users` row and login verifies an
// actual bcrypt hash.
//
// ACCUMULATING ROWS — read before changing:
//   Each run of "register -> logout -> login" INSERTS A NEW USER ROW that is
//   never deleted. Emails are suffixed with a timestamp + random token so repeat
//   runs never collide with each other, and the `e2e-` prefix keeps them clearly
//   distinguishable from the seeded `@codequeenshub.test` demo accounts.
//   Deleting them is not done here on purpose: a spec that deletes its own rows
//   cannot prove the row was really written, and a failed run leaves the row
//   behind for diagnosis.
//   TODO(ops): add a periodic cleanup of users whose email matches
//   'e2e-%@codequeenshub.test' once a cohort is enrolled for real, so the demo
//   database does not grow without bound.
// =============================================================================

import { expect, test } from "@playwright/test";

import { DEMO, DEMO_PASSWORD, loginAs } from "../fixtures";

/** Password for throwaway e2e accounts. Satisfies registerSchema (min 8 chars). */
const E2E_PASSWORD = "E2ePassw0rd!";

/** A unique, obviously-synthetic email. See the accumulation note above. */
function uniqueEmail(): string {
  const stamp = Date.now().toString(36);
  const token = Math.random().toString(36).slice(2, 8);
  return `e2e-${stamp}-${token}@codequeenshub.test`;
}

test.describe("registration and session lifecycle", () => {
  test("register -> logout -> login again with the same credentials", async ({ page }) => {
    const email = uniqueEmail();
    const name = "E2E Test Student";

    // ---- Register (writes a real row) -------------------------------------
    await page.goto("/register");
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');

    // Registration signs the new student in, so we must leave /register.
    await expect(page).not.toHaveURL(/\/register/, { timeout: 15_000 });

    // ---- The session is real: /api/auth/me returns the new user -----------
    const meAfterRegister = await page.request.get("/api/auth/me");
    expect(meAfterRegister.status()).toBe(200);
    const registered = await meAfterRegister.json();
    expect(registered.ok).toBe(true);
    expect(registered.data.email).toBe(email);
    expect(registered.data.name).toBe(name);
    // Self-registration must never mint a privileged account.
    expect(registered.data.role).toBe("student");
    // The hash must never cross the wire.
    expect(registered.data).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(registered)).not.toContain("$2a$");
    expect(JSON.stringify(registered)).not.toContain(E2E_PASSWORD);

    // ---- Logout clears the session ---------------------------------------
    const logout = await page.request.post("/api/auth/logout");
    expect(logout.status()).toBe(200);
    expect((await logout.json()).ok).toBe(true);

    const meAfterLogout = await page.request.get("/api/auth/me");
    expect(meAfterLogout.status()).toBe(401);

    // ---- Log back in through the real form -------------------------------
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    const meAfterLogin = await page.request.get("/api/auth/me");
    expect(meAfterLogin.status()).toBe(200);
    expect((await meAfterLogin.json()).data.email).toBe(email);
  });

  test("registering an email that already exists is rejected", async ({ page }) => {
    // The seeded demo student is guaranteed to exist.
    await page.goto("/register");
    await page.fill('input[name="name"]', "Impostor");
    await page.fill('input[name="email"]', DEMO.student.email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/register\?error=duplicate/, { timeout: 15_000 });
    await expect(page.getByTestId("form-error")).toContainText(/already exists/i);
  });

  test("a wrong password is rejected with a message that does not confirm the email", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', DEMO.student.email);
    await page.fill('input[name="password"]', "definitely-not-the-password");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/login\?/, { timeout: 15_000 });
    const alert = page.getByTestId("form-error");
    await expect(alert).toContainText(/invalid email or password/i);
    // Must not disclose that the email exists.
    await expect(alert).not.toContainText(/no such|not found|unknown user/i);
  });

  test("an unknown email produces the same message as a wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', uniqueEmail());
    await page.fill('input[name="password"]', "definitely-not-the-password");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/login\?/, { timeout: 15_000 });
    await expect(page.getByTestId("form-error")).toContainText(/invalid email or password/i);
  });

  test("the seeded demo accounts all log in", async ({ page }) => {
    for (const role of ["student", "instructor", "admin"] as const) {
      await loginAs(page, role);
      const me = await page.request.get("/api/auth/me");
      expect(me.status()).toBe(200);
      const body = await me.json();
      expect(body.data.email).toBe(DEMO[role].email);
      expect(body.data.role).toBe(role);
      // The seeded student belongs to cohort 1; staff are not cohort-scoped.
      if (role === "student") {
        expect(body.data.cohortId).not.toBeNull();
      } else {
        expect(body.data.cohortId).toBeNull();
      }
      await page.request.post("/api/auth/logout");
    }
    expect(DEMO_PASSWORD).toBe("Passw0rd!demo");
  });
});

test.describe("role-based access control (ROLES_SATISFYING)", () => {
  test("an anonymous visitor is redirected from a protected page to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an anonymous caller gets 401 in the ApiResult envelope, not an HTML redirect", async ({
    request,
  }) => {
    const res = await request.get("/api/auth/me");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  test("a student is 403'd on an instructor-only API route", async ({ page }) => {
    await loginAs(page, "student");
    const res = await page.request.get("/api/instructor/submissions");
    // 403, not 401: the session is valid, the role is not sufficient.
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("forbidden");
  });

  test("a student is redirected away from an instructor-only page", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/instructor/submissions");
    // The guard sends them to /login?error=forbidden rather than rendering it.
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page).toHaveURL(/error=forbidden/);
  });

  test("an instructor reaches instructor-scoped paths (not blocked by the guard)", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    const res = await page.request.get("/api/instructor/submissions");
    // The instructor-admin stream has not built this handler yet, so 404 is the
    // expected outcome. What matters here is that it is NOT 401/403 — the guard
    // let the instructor through.
    expect([200, 404]).toContain(res.status());
  });

  test("an admin also satisfies instructor-scoped paths (staff hierarchy)", async ({ page }) => {
    await loginAs(page, "admin");
    const res = await page.request.get("/api/instructor/submissions");
    expect([200, 404]).toContain(res.status());
  });

  test("a student satisfies student-scoped API routes", async ({ page }) => {
    await loginAs(page, "student");
    const res = await page.request.get("/api/auth/me");
    expect(res.status()).toBe(200);
  });

  test("an admin also satisfies student-scoped routes (staff read student endpoints)", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    const res = await page.request.get("/api/auth/me");
    expect(res.status()).toBe(200);
  });
});

// =============================================================================
// Sign-out reachability, per route group.
// -----------------------------------------------------------------------------
// These exist because a real defect got past a fully green suite: the sign-out
// control was wired into src/app/(app)/layout.tsx only, so every /instructor/*
// and /admin/* page rendered with NO way to end the session — staff had to
// navigate into the student area to sign out. It was found by driving the running
// app by hand, not by a test, because nothing asserted the control's PRESENCE.
//
// Asserted per route group rather than once, since the two groups have separate
// layouts and a fix to one says nothing about the other.
// =============================================================================
test.describe("sign-out is reachable from every route group", () => {
  const SIGN_OUT = { role: "button" as const, name: /sign out/i };

  test("a student can sign out from a student page", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/dashboard");
    await expect(page.getByRole(SIGN_OUT.role, { name: SIGN_OUT.name })).toBeVisible();
  });

  test("an instructor can sign out from a staff page", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor");
    await expect(page.getByRole(SIGN_OUT.role, { name: SIGN_OUT.name })).toBeVisible();
  });

  test("an admin can sign out from an admin page", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin");
    await expect(page.getByRole(SIGN_OUT.role, { name: SIGN_OUT.name })).toBeVisible();
  });

  test("signing out from a staff page ends the session and lands on the public page", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor");
    await page.getByRole(SIGN_OUT.role, { name: SIGN_OUT.name }).click();
    await expect(page).toHaveURL(/\/$/);
    // The session is really gone, not just navigated away from.
    await page.goto("/instructor");
    await expect(page).toHaveURL(/\/login/);
  });
});
