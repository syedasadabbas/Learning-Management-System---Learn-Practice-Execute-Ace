// =============================================================================
// E2E — instructor grading + admin console. instructor-admin stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Nine agents share one dev server and port 3000, so the
// coordinator runs the suites serially at integration. Authored now so it lands
// with the code it covers.
//
// The first block is the one that must never be allowed to regress: a STUDENT is
// refused every instructor endpoint, most importantly the grading endpoint. A
// student who can POST a grade can grade themselves.
//
// Credentials and seeded facts come from tests/e2e/fixtures.ts (owned by
// devops-testing) — never hardcoded here.
// =============================================================================

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { DEMO, DEMO_PASSWORD, loginAs, SEEDED } from "../fixtures";

const INSTRUCTOR_ENDPOINTS = [
  "/api/instructor/submissions",
  "/api/instructor/students",
  "/api/instructor/analytics",
] as const;

/**
 * Sign in through the API so the returned context carries a session cookie.
 *
 * `loginAs` drives the real form and is used for page tests; for pure endpoint
 * authorization checks a request-level login avoids paying for a browser render
 * on every assertion.
 */
async function apiLogin(page: Page, role: keyof typeof DEMO): Promise<APIRequestContext> {
  await loginAs(page, role);
  return page.request;
}

// ---------------------------------------------------------------------------
// Authorization — the heart of this stream
// ---------------------------------------------------------------------------

test.describe("a student is refused every instructor endpoint", () => {
  test("cannot POST a grade — the endpoint that would let them grade themselves", async ({
    page,
  }) => {
    const request = await apiLogin(page, "student");

    const response = await request.post("/api/instructor/submissions/1/grade", {
      data: { submissionId: 1, stars: 5, score: 40, feedback: "Excellent work." },
      failOnStatusCode: false,
    });

    // 403 when the guard recognises the session but refuses the role; 401 if the
    // session was not established. Anything in the 2xx range is a security bug.
    expect(
      response.status(),
      "a student must never be able to write a grade",
    ).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    expect(response.ok()).toBe(false);

    const body = await response.json().catch(() => null);
    if (body) expect(body.ok).toBe(false);
  });

  for (const path of INSTRUCTOR_ENDPOINTS) {
    test(`cannot GET ${path}`, async ({ page }) => {
      const request = await apiLogin(page, "student");
      const response = await request.get(path, { failOnStatusCode: false });

      expect(response.ok(), `${path} must refuse a student`).toBe(false);
      expect([401, 403]).toContain(response.status());

      // Nothing about other students may leak in the error body.
      const text = await response.text();
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("$2a$");
    });
  }

  test("cannot open the grading page", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/instructor/grading");
    // requireRole redirects a student to /login?error=forbidden.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("grade-form")).toHaveCount(0);
  });

  test("cannot open the admin console", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("an anonymous visitor is refused", () => {
  test("gets 401 from the grading endpoint with no session", async ({ request }) => {
    const response = await request.post("/api/instructor/submissions/1/grade", {
      data: { stars: 5 },
      failOnStatusCode: false,
    });
    expect(response.ok()).toBe(false);
    expect(response.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Instructor is allowed
// ---------------------------------------------------------------------------

test.describe("an instructor is allowed", () => {
  test("reads the grading queue endpoint", async ({ page }) => {
    const request = await apiLogin(page, "instructor");
    const response = await request.get("/api/instructor/submissions");

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.rows)).toBe(true);
    // No password hash may appear anywhere in a staff-facing payload.
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  test("reads the student roster without any credential material", async ({ page }) => {
    const request = await apiLogin(page, "instructor");
    const response = await request.get("/api/instructor/students");

    expect(response.ok()).toBe(true);
    const text = await response.text();
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("$2a$");
  });

  test("reads analytics, and zero-denominator rates come back as null, not NaN", async ({
    page,
  }) => {
    const request = await apiLogin(page, "instructor");
    const response = await request.get("/api/instructor/analytics");

    expect(response.ok()).toBe(true);
    const raw = await response.text();
    // JSON cannot represent NaN; if the server ever produced one, JSON.stringify
    // would emit `null` and the string "NaN" would appear only from a template.
    expect(raw).not.toContain("NaN");
    expect(raw).not.toContain("Infinity");

    const body = JSON.parse(raw);
    expect(body.ok).toBe(true);
    for (const week of body.data.weeks) {
      for (const key of [
        "quizPassRate",
        "submissionRate",
        "gradedRate",
        "completionRate",
      ]) {
        const rate = week[key];
        expect(rate.percent === null || Number.isFinite(rate.percent)).toBe(true);
        if (rate.denominator === 0) expect(rate.percent).toBeNull();
      }
    }
  });

  test("sees the queue page, and an empty queue is explained rather than broken", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor/grading");

    await expect(page.getByRole("heading", { name: "Grading queue" })).toBeVisible();
    await expect(page.locator("text=Application error")).toHaveCount(0);

    const table = page.getByTestId("queue-table");
    const empty = page.getByTestId("empty-state");
    // Exactly one of the two renders. With no Google Form URL configured, nothing
    // has been ingested, so empty is the expected first state.
    const tableCount = await table.count();
    if (tableCount === 0) {
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(/not a fault|no assignment submissions/i);
    } else {
      await expect(table).toBeVisible();
    }
  });

  test("sees one filter chip per seeded week", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/instructor/grading");
    for (let week = 1; week <= SEEDED.weekCount; week += 1) {
      await expect(page.getByTestId(`filter-week-${week}`)).toBeVisible();
    }
  });

  test("cannot reach admin-only pages — instructor does not satisfy admin", async ({
    page,
  }) => {
    // ROLES_SATISFYING.admin is ["admin"] alone.
    await loginAs(page, "instructor");
    for (const path of ["/admin", "/admin/quizzes", "/admin/students", "/admin/reports"]) {
      await page.goto(path);
      await expect(page, `${path} must refuse an instructor`).toHaveURL(/\/login/);
    }
  });
});

// ---------------------------------------------------------------------------
// Admin satisfies instructor routes, and owns the console
// ---------------------------------------------------------------------------

test.describe("an admin is allowed", () => {
  test("reads every instructor endpoint (admin satisfies instructor)", async ({ page }) => {
    const request = await apiLogin(page, "admin");
    for (const path of INSTRUCTOR_ENDPOINTS) {
      const response = await request.get(path);
      expect(response.ok(), `${path} must admit an admin`).toBe(true);
    }
  });

  test("opens the admin console and its sections", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();

    for (const [path, heading] of [
      ["/admin/quizzes", "Quizzes"],
      ["/admin/assignments", "Assignments"],
      ["/admin/students", "Accounts"],
      ["/admin/deadlines", "Deadlines"],
      ["/admin/reports", "Reports"],
      ["/admin/analytics", "Analytics"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await expect(page.locator("text=Application error")).toHaveCount(0);
    }
  });

  test("edits a week deadline and the new date persists", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/deadlines");

    const input = page.getByTestId("deadline-input-1");
    await expect(input).toBeVisible();
    await input.fill("2026-12-01T17:00");
    await page.getByTestId("save-deadline-1").click();
    await expect(page.getByTestId("toast")).toContainText(/deadline saved/i);

    await page.reload();
    await expect(page.getByTestId("deadline-input-1")).toHaveValue("2026-12-01T17:00");
  });

  test("exports grades as CSV", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/reports");

    const download = page.waitForEvent("download", { timeout: 15_000 });
    await page.getByTestId("export-grades").first().click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^grades-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

// ---------------------------------------------------------------------------
// Grading a submission end to end
// ---------------------------------------------------------------------------

test.describe("grading a queued submission", () => {
  test("a 4-star grade awards the assignmentPoints figure", async ({ page }) => {
    const request = await apiLogin(page, "instructor");
    const queue = await request.get("/api/instructor/submissions");
    const body = await queue.json();
    const row = body.data.rows[0];

    // TODO(test): the seed configures no googleFormUrl / googleSheetCsvUrl, so no
    // submissions exist and this assertion has nothing to grade. It is skipped
    // rather than deleted: once devops-testing seeds an ingested submission (or
    // the submissions stream's ingest runs in setup), it starts covering the
    // acceptance criterion "instructor grades a submission; the leaderboard and
    // student dashboard update". Do not make it pass by seeding from this spec —
    // the fixtures file is owned by devops-testing.
    test.skip(!row, "no ingested submissions in the seeded database");

    await page.goto(`/instructor/grading?submission=${row.submissionId}`);
    await expect(page.getByTestId("grade-form")).toBeVisible();

    // 4 stars: at or above 3, so no star deduction; full 40 unless late.
    await page.getByTestId("grade-stars").getByTestId("star").nth(3).click();
    await expect(page.getByTestId("grade-stars")).toHaveAttribute("data-value", "4");

    const expectedScore = row.daysLate > 0 ? row.projectedScore : 40;
    await page.getByTestId("feedback-input").fill("Clean markup, good use of flexbox.");
    await page.getByTestId("save-grade").click();

    await expect(page.getByTestId("toast")).toContainText(/Saved: 4 stars/);

    const after = await request.get("/api/instructor/submissions?status=graded");
    const graded = (await after.json()).data.rows.find(
      (r: { submissionId: number }) => r.submissionId === row.submissionId,
    );
    expect(graded.stars).toBe(4);
    if (expectedScore !== null) expect(graded.score).toBe(expectedScore);
  });

  test("the API rejects 0 stars and 6 stars", async ({ page }) => {
    const request = await apiLogin(page, "instructor");

    for (const stars of [0, 6]) {
      const response = await request.post("/api/instructor/submissions/1/grade", {
        data: { submissionId: 1, stars },
        failOnStatusCode: false,
      });
      // 400 (validation) is expected. 404 is acceptable only if submission 1 does
      // not exist AND validation ran first — so assert it is never a success.
      expect(response.ok(), `stars=${stars} must not be accepted`).toBe(false);
      expect(response.status()).toBe(400);
    }
  });

  test("the API rejects feedback over 4000 characters", async ({ page }) => {
    const request = await apiLogin(page, "instructor");
    const response = await request.post("/api/instructor/submissions/1/grade", {
      data: { submissionId: 1, stars: 4, feedback: "x".repeat(4001) },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
  });

  test("the API rejects a body naming a different submission than the URL", async ({
    page,
  }) => {
    const request = await apiLogin(page, "instructor");
    const response = await request.post("/api/instructor/submissions/1/grade", {
      data: { submissionId: 999, stars: 4 },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("submission_id_mismatch");
  });
});

// Referenced so an unused-import lint does not remove the credential constant,
// which documents that specs must not invent their own passwords.
test("fixtures supply the shared demo password", async () => {
  expect(DEMO_PASSWORD.length).toBeGreaterThan(8);
});
