// =============================================================================
// E2E — submissions stream. Owner: submissions stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Nine agents share port 3000, so the coordinator runs
// the e2e suite serially at integration. Authored, reviewed, never executed here.
//
// WHAT IS AND IS NOT VERIFIED
//
// UPDATED 2026-07-31 — THE SEEDED STATE CHANGED. Both URL columns used to be NULL
// on all four assignments, and most of this file was written around that. The
// seeder now fills both in (scripts/seed.ts -> backfillAssignmentLinks), but NOT
// with Google URLs: with no way to create a Google Form from this repository, they
// point at this application's own LOCAL STAND-IN surfaces —
// /assignments/[weekId]/submit and /api/stand-in/assignments/[id]/responses. See
// the header of src/lib/submissions/stand-in.ts.
//
// So, stated bluntly so no one reads a green run as more than it is: PASSING THIS
// FILE DOES NOT MEAN THE GOOGLE PIPELINE WORKS. It means the transport, the
// parser, the student matcher, the lateness rule and the idempotent upsert work
// against a sheet this repository wrote itself.
//
// The specs below split into four groups:
//   1. AUTHORIZATION on the two ingest endpoints — the highest-value group: an
//      earlier revision shipped ingest unauthenticated.
//   2. The assignment UI and the ingest report in the CURRENT seeded state.
//   3. INGESTION AND IDEMPOTENCY against a fixture CSV this test serves itself on
//      loopback, with the assignment temporarily pointed at it and restored
//      afterwards.
//   4. The SEEDED STAND-IN end to end — no temporary URL, no self-served server:
//      the assignment's real stored URL, fetched by the real ingestion code.
//   5. THE OPERATOR SURFACE — that a human can actually SEE the last ingest result
//      per assignment. Groups 1-4 prove the pipeline reports correctly; group 5 is
//      the only one that proves the report reaches anybody. Added 2026-07-31.
//
// SIDE EFFECTS. Groups 1, 2 and 4 all trigger ingestion against the seeded
// stand-in, which WRITES submission rows for the demo student. Several other
// streams read that table, so every group that can cause a write ends with
// `clearStandInSubmissions`, which deletes only rows whose `sheet_row_ref` begins
// "v1:" (ingestion-derived) for the demo student. The rows seeded by
// scripts/seed-demo-activity.ts use "seed:<email>" refs and are never touched.
// =============================================================================

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// DEMO_PASSWORD is deliberately NOT imported any more. Both places that used it
// were hand-rolling a second login, which is what `openSecondUser` below replaced;
// re-importing it is the smell that a third hand-rolled login has appeared.
import { DEMO, expectNoServerError, loginAs } from "../fixtures";

/**
 * Log a SECOND user in, in their own context, and wait for the session to exist.
 *
 * TWO BUGS FIXED HERE, both of which failed the spec at :507. Written as one helper
 * because both were the consequence of hand-rolling a second login inline.
 *
 * 1. `page.context().browser()!.newPage()` DOES NOT INHERIT `use.baseURL`. Playwright
 *    applies context options in the `context`/`page` fixtures, not to a context a
 *    test creates from the `browser` object. So `studentPage.goto("/assignments")`
 *    was a relative URL with no base and threw "Invalid URL" before any assertion
 *    ran. The `baseURL` fixture is passed in explicitly to fix it.
 *
 * 2. The inline version clicked submit and then immediately called `goto`, with no
 *    wait in between. The login is a form POST; navigating away can cancel it before
 *    Set-Cookie lands, and the next page then redirects to /login — which looks
 *    exactly like the feature under test being broken. `loginAs` in ../fixtures has
 *    always waited for the URL to leave /login; this reuses that rather than
 *    re-deriving it.
 *
 * The caller owns closing the context.
 */
async function openSecondUser(
  browser: Browser,
  baseURL: string | undefined,
  role: "student" | "instructor" | "admin",
): Promise<{ context: BrowserContext; page: Page }> {
  expect(baseURL, "playwright's baseURL fixture must be set for a manually created context").toBeTruthy();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAs(page, role);
  return { context, page };
}

/**
 * Delete only the submissions an ingest run in this file could have created.
 *
 * Scoped three ways on purpose — demo student, ingestion-shaped row ref, and
 * nothing else — because this suite shares one seeded database with every other
 * stream's specs. A blanket `DELETE FROM submissions` would silently destroy the
 * graded fixtures that the leaderboard and instructor-queue specs assert against,
 * and the failure would surface in someone else's file.
 *
 * A no-op when DATABASE_URL is absent from the test process: the cleanup is best
 * effort, and skipping it is better than failing an otherwise valid run.
 */
async function clearStandInSubmissions(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM submissions
        WHERE sheet_row_ref LIKE 'v1:%'
          AND student_id = (SELECT id FROM users WHERE email = $1)`,
      [DEMO.student.email],
    );
  } finally {
    await client.end();
  }
}

/** Week 1's assignment id is not knowable up front; it is read via the API. */
async function firstWeekAssignment(request: APIRequestContext): Promise<{
  assignmentId: number;
  weekId: number;
  formConfigured: boolean;
}> {
  // /api/courses is the course-content stream's route; week ids come from there.
  const coursesResponse = await request.get("/api/courses");
  expect(coursesResponse.ok(), "GET /api/courses should succeed for a signed-in user").toBe(true);

  // Walk weeks until one has an assignment. Deliberately does not assume week
  // id 1 — serial ids depend on how many times the database has been reseeded.
  for (let weekId = 1; weekId <= 40; weekId += 1) {
    const response = await request.get(`/api/weeks/${weekId}/assignment`);
    if (response.status() === 404) continue;
    if (!response.ok()) continue;
    const body = await response.json();
    return {
      assignmentId: body.data.assignmentId,
      weekId: body.data.weekId,
      formConfigured: body.data.formConfigured,
    };
  }
  throw new Error("No week with an assignment was found via GET /api/weeks/:weekId/assignment.");
}

// ---------------------------------------------------------------------------
// 1. Authorization — the part that was already a security defect once
// ---------------------------------------------------------------------------

test.describe("ingest authorization", () => {
  // Two tests here trigger a REAL ingest, which now has a real sheet to read.
  test.afterAll(clearStandInSubmissions);

  test("an anonymous POST to the manual ingest endpoint is rejected", async ({ request }) => {
    // ROUTE_AUTH: "instructor". Anonymous must never reach a write path.
    const response = await request.post("/api/assignments/1/ingest");
    expect([401, 403]).toContain(response.status());
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  test("a signed-in STUDENT cannot trigger manual ingest", async ({ page, request }) => {
    await loginAs(page, "student");
    // The page's storage state carries the session cookie into `request` because
    // Playwright shares the browser context's cookie jar for same-origin calls
    // made through page.request.
    const response = await page.request.post("/api/assignments/1/ingest");
    expect(response.status()).toBe(403);
    void request;
  });

  test("a signed-in INSTRUCTOR can trigger manual ingest", async ({ page }) => {
    await loginAs(page, "instructor");
    const { assignmentId } = await firstWeekAssignment(page.request);

    const response = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.triggeredBy.mode).toBe("manual");
  });

  test("ingest is not exposed on GET — a write must not be reachable by navigation", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    const response = await page.request.get("/api/assignments/1/ingest");
    expect(response.status()).toBe(405);
  });

  test("the cron endpoint rejects a request with no bearer token", async ({ request }) => {
    const response = await request.post("/api/cron/ingest-submissions");
    expect([401, 503]).toContain(response.status());
    expect((await response.json()).ok).toBe(false);
  });

  test("the cron endpoint rejects a wrong bearer token", async ({ request }) => {
    const response = await request.post("/api/cron/ingest-submissions", {
      headers: { authorization: "Bearer definitely-not-the-cron-secret" },
    });
    expect([401, 503]).toContain(response.status());
  });

  test("NO user role satisfies the cron endpoint — not even an admin", async ({ page }) => {
    // ROLES_SATISFYING.cron is an empty array. This is the single most important
    // assertion in this file: a logged-in admin must not be able to stand in for
    // the scheduler.
    await loginAs(page, "admin");
    const response = await page.request.post("/api/cron/ingest-submissions");
    expect([401, 403, 503]).toContain(response.status());
    expect(response.status()).not.toBe(200);
  });

  test("the cron endpoint refuses a browser session even with a valid token", async ({ page }) => {
    // Defence in depth against a leaked secret reaching client-side code.
    // Skipped unless the secret is available to the test process.
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET is not available to the test process.");
    await loginAs(page, "admin");
    const response = await page.request.post("/api/cron/ingest-submissions", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("cron_only");
  });

  test("the cron endpoint accepts the CRON_SECRET bearer token from a clean context", async ({
    request,
  }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET is not available to the test process.");
    const response = await request.post("/api/cron/ingest-submissions", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.assignmentsConsidered).toBeGreaterThan(0);
    // Durations are milliseconds (metric units per house rules).
    expect(typeof body.data.durationMs).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 2. The assignment UI, whichever of the three Form states is configured
// ---------------------------------------------------------------------------

test.describe("assignment pages and the configured Form state", () => {
  test.afterAll(clearStandInSubmissions);

  test("the student's submission history renders", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/assignments");
    await expectNoServerError(page);
    await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
    await expect(page.getByTestId("submissions-summary")).toBeVisible();
  });

  test("a week's assignment page offers no broken link when the Form URL is null", async ({
    page,
  }) => {
    await loginAs(page, "student");
    const { weekId, formConfigured } = await firstWeekAssignment(page.request);

    await page.goto(`/assignments/${weekId}`);
    await expectNoServerError(page);

    if (formConfigured) {
      // The real URLs have been supplied since this spec was written.
      await expect(page.getByTestId("submit-link")).toBeVisible();
    } else {
      await expect(page.getByTestId("submit-link-unconfigured")).toBeVisible();
      await expect(page.getByText("Submission link not yet configured")).toBeVisible();
      // No dead anchor anywhere in the submit panel.
      await expect(page.locator('[data-testid="submit-link-unconfigured"] a')).toHaveCount(0);
    }
  });

  test("manual ingest reports a result rather than a 500, whatever is configured", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    const { assignmentId } = await firstWeekAssignment(page.request);

    const response = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    // Either aborted with a stated reason, or the URLs now exist and it ran.
    if (body.data.aborted !== null) {
      expect(["no_csv_url", "fetch_failed"]).toContain(body.data.aborted);
      expect(body.data.inserted).toBe(0);
    }
  });

  test("GET /api/weeks/:weekId/assignment requires a session", async ({ request }) => {
    const response = await request.get("/api/weeks/1/assignment");
    expect([401, 403]).toContain(response.status());
  });

  test("GET /api/weeks/:weekId/assignment rejects a non-numeric week id", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/weeks/not-a-number/assignment");
    expect(response.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3. Ingestion + idempotency against a self-served fixture CSV
// ---------------------------------------------------------------------------

/**
 * TODO(test): LIVE-SHEET INGESTION IS UNVERIFIED.
 *
 * This group proves the parse -> student match -> upsert -> late-flag path and
 * that re-running changes nothing. It does NOT prove ingestion works against a
 * real published Google Sheet, because no such sheet exists yet (both URL columns
 * are null in the seed, by decision, not by omission). Specifically unverified:
 *   - the exact header text a real Form produces per question;
 *   - the real sheet's timestamp format and spreadsheet timezone;
 *   - Google's 307 redirect from docs.google.com to googleusercontent.com.
 * Re-run this group against a real published sheet before a cohort relies on it.
 *
 * The group also needs DATABASE_URL in the test process, because pointing an
 * assignment at the fixture server is a direct column update: there is no
 * API route in this stream that can set `google_sheet_csv_url` (the admin console
 * that will own that is the instructor-admin stream's). It is skipped otherwise
 * rather than silently passing.
 */
test.describe("ingestion from a fixture CSV", () => {
  let server: Server | undefined;
  let fixtureUrl = "";
  let csvBody = "";

  /** Deliberately messy: good rows, a blank row, junk, and a duplicate. */
  function buildCsv(demoStudentEmail: string, submittedAt: string): string {
    return [
      "Timestamp,Email Address,GitHub Repository URL,Live Site URL,Notes",
      `${submittedAt},${demoStudentEmail},https://github.com/demo/week1,https://demo.example.test,Fixture submission`,
      ",,,,",
      `${submittedAt},nobody-enrolled@example.test,https://github.com/nobody/week1,,Unknown student`,
      "sometime last week,also-nobody@example.test,,,Malformed timestamp",
      `${submittedAt},${demoStudentEmail},https://github.com/demo/week1,https://demo.example.test,Literal duplicate`,
    ].join("\n");
  }

  test.beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      res.end(csvBody);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    // Loopback is on fetch-csv.ts's allow-list precisely so this is possible.
    fixtureUrl = `http://127.0.0.1:${address.port}/fixture.csv`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  test("ingests a fixture sheet, skips the bad rows, and is idempotent on re-run", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.skip(
      !process.env.DATABASE_URL,
      "DATABASE_URL is not available to the test process, so the fixture sheet URL " +
        "cannot be attached to an assignment. Live-sheet ingestion remains unverified.",
    );

    await loginAs(page, "instructor");
    const { assignmentId } = await firstWeekAssignment(page.request);

    // Direct column update, then restored in `finally`. Test setup only.
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    let originalCsvUrl: string | null = null;
    try {
      const before = await client.query<{ google_sheet_csv_url: string | null; due_at: Date }>(
        "SELECT google_sheet_csv_url, due_at FROM assignments WHERE id = $1",
        [assignmentId],
      );
      originalCsvUrl = before.rows[0].google_sheet_csv_url;
      const dueAt = new Date(before.rows[0].due_at);

      // One day PAST the deadline. The seeded cohort grace is 2 days, so this
      // must come back NOT late — the grace-window assertion.
      csvBody = buildCsv(
        DEMO.student.email,
        new Date(dueAt.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " "),
      );

      await client.query("UPDATE assignments SET google_sheet_csv_url = $1 WHERE id = $2", [
        fixtureUrl,
        assignmentId,
      ]);
      // Start from a clean slate FOR THE DEMO STUDENT ONLY.
      //
      // This was `DELETE FROM submissions WHERE assignment_id = $1`, which is a data
      // loss bug that only stayed harmless because the test was being skipped (see
      // the skip note above). Week 1's assignment carries three GRADED submissions
      // seeded by scripts/seed-demo-activity.ts for advanced@, steady@ and
      // struggling@ — verified present in the live database on 2026-07-31, ids 1-3,
      // scores 40/40/40, stars 5/3/4. The leaderboard, instructor-queue and
      // progress-tracking specs all assert against those rows, and the `finally`
      // below deleted them a second time without restoring them. Enabling this test
      // with the blanket delete in place would have turned one skipped spec into
      // several other streams' failures.
      await client.query(
        `DELETE FROM submissions
          WHERE assignment_id = $1
            AND student_id = (SELECT id FROM users WHERE email = $2)`,
        [assignmentId, DEMO.student.email],
      );

      // --- First run -------------------------------------------------------
      const first = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
      expect(first.status()).toBe(200);
      const firstBody = (await first.json()).data;

      expect(firstBody.aborted).toBeNull();
      expect(firstBody.rowsSeen).toBe(5);
      expect(firstBody.inserted).toBe(1);
      expect(firstBody.skipped.length).toBe(4);
      const reasons = Object.keys(firstBody.skipReasonCounts).sort();
      expect(reasons).toEqual(
        ["blank_row", "duplicate_row_ref_in_batch", "malformed_timestamp", "unknown_student"].sort(),
      );

      // EVERY count below is scoped to the demo student, for the same reason the
      // delete above is: week 1's assignment also carries three graded rows that
      // other streams assert against, so an unscoped `count(*)` here would read 4
      // and the failure would look like an ingestion bug.
      const demoRows = async (extraSql = "") =>
        (
          await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM submissions
              WHERE assignment_id = $1
                AND student_id = (SELECT id FROM users WHERE email = $2) ${extraSql}`,
            [assignmentId, DEMO.student.email],
          )
        ).rows[0].n;

      expect(await demoRows()).toBe("1");

      // Inside the 2-day cohort grace window -> not flagged late.
      const flags = await client.query<{ is_late: boolean; sheet_row_ref: string | null }>(
        `SELECT is_late, sheet_row_ref FROM submissions
          WHERE assignment_id = $1
            AND student_id = (SELECT id FROM users WHERE email = $2)`,
        [assignmentId, DEMO.student.email],
      );
      expect(flags.rows[0].is_late).toBe(false);
      expect(flags.rows[0].sheet_row_ref).toMatch(/^v1:[0-9a-f]{32}$/);

      // --- Second run: the idempotency assertion ---------------------------
      const second = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
      expect(second.status()).toBe(200);
      const secondBody = (await second.json()).data;
      expect(secondBody.inserted).toBe(0);
      expect(secondBody.unchanged).toBe(1);

      expect(await demoRows()).toBe("1");

      // No row may carry a NULL ref: the unique index would not constrain it and
      // every run would insert another copy.
      expect(await demoRows("AND sheet_row_ref IS NULL")).toBe("0");

      // --- The student sees it --------------------------------------------
      const student = await openSecondUser(browser, baseURL, "student");
      try {
        await student.page.goto("/assignments");
        await expect(student.page.getByTestId("lateness-badge").first()).toBeVisible();
      } finally {
        await student.context.close();
      }
    } finally {
      await client.query("UPDATE assignments SET google_sheet_csv_url = $1 WHERE id = $2", [
        originalCsvUrl,
        assignmentId,
      ]);
      // Scoped, and it must be: the unscoped version of this line destroyed three
      // other streams' graded fixtures and restored nothing.
      await client.query(
        `DELETE FROM submissions
          WHERE assignment_id = $1
            AND student_id = (SELECT id FROM users WHERE email = $2)`,
        [assignmentId, DEMO.student.email],
      );
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The SEEDED stand-in, end to end — no temporary URL, no self-served server
// ---------------------------------------------------------------------------

/**
 * WHAT THIS GROUP ADDS OVER GROUP 3, AND WHY BOTH ARE KEPT.
 *
 * Group 3 proves the parser and the upsert by pointing an assignment at a CSV the
 * test itself serves. That is a good unit-ish test wearing a browser, but it
 * cannot fail for the reason this feature actually failed: the column was NULL, so
 * nothing was ever fetched. Group 3 would have passed happily throughout.
 *
 * This group touches no URL. It reads whatever `google_sheet_csv_url` the SEEDER
 * wrote and asserts that a plain ingest — the same call the hourly cron makes —
 * comes back with `aborted: null` and a submission row. If someone reverts the
 * seeder change, or ships a stand-in URL the SSRF allow-list refuses, or breaks
 * the stand-in route, this is the group that goes red.
 *
 * TODO(course-owner): STILL UNPROVEN AGAINST GOOGLE. Everything here reads a CSV
 * this repository generated. Nothing has ever fetched a published Google Sheet.
 * Re-run this group once the real Forms exist and their sheets are published, and
 * expect the header-text and timestamp-locale assumptions in csv.ts to be the two
 * things that need adjusting.
 */
test.describe("the seeded stand-in pipeline", () => {
  test.afterAll(clearStandInSubmissions);

  test("the stand-in sheet endpoint serves CSV to an anonymous server-side fetch", async ({
    request,
  }) => {
    // Anonymous ON PURPOSE: ingestion fetches this from the server with no
    // cookies, so a session requirement would make it unreachable by the only
    // caller it has. The route's own gate is NODE_ENV + SUBMISSIONS_STAND_IN_SHEET.
    const response = await request.get("/api/stand-in/assignments/1/responses");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    // The marker that tells a log reader this did not come from Google.
    expect(response.headers()["x-stand-in"]).toBe("1");

    const body = await response.text();
    const [header, firstRow] = body.split(/\r?\n/);
    expect(header).toContain("Timestamp");
    expect(header).toContain("Email Address");
    expect(firstRow).toContain(DEMO.student.email);
  });

  test("an unknown assignment id is a 404 that reveals nothing", async ({ request }) => {
    const response = await request.get("/api/stand-in/assignments/999999/responses");
    expect(response.status()).toBe(404);
  });

  test("the student is offered a real link, labelled as a stand-in", async ({ page }) => {
    await loginAs(page, "student");
    const { weekId, formConfigured } = await firstWeekAssignment(page.request);
    expect(formConfigured, "the seeder must have written a Form URL").toBe(true);

    await page.goto(`/assignments/${weekId}`);
    await expectNoServerError(page);

    const standInLink = page.getByTestId("submit-link-stand-in");
    const realLink = page.getByTestId("submit-link");
    await expect(realLink).toBeVisible();

    if ((await standInLink.count()) === 0) {
      // A real Google Form has been configured since this was written. Then the
      // stand-in is irrelevant and the honest thing is to skip, not to fail.
      test.skip(true, "A real Google Form URL is configured; the stand-in is not in use.");
    }

    // The warning must be present. A link that looks like the real submission
    // form but is not is the exact failure this whole approach exists to avoid.
    await expect(page.getByText("Stand-in — the real Google Form does not exist yet")).toBeVisible();

    await standInLink.click();
    await expect(page.getByTestId("stand-in-form-page")).toBeVisible();
    await expect(page.getByTestId("stand-in-warning")).toBeVisible();
    // And a route to a human that actually works, rather than a dead form.
    await expect(page.getByTestId("stand-in-mailto")).toHaveAttribute("href", /^mailto:/);
  });

  test("ingest from the SEEDED sheet URL inserts, sets lateness, and repeats cleanly", async ({
    page,
    browser,
    baseURL,
  }) => {
    await loginAs(page, "instructor");
    const { assignmentId } = await firstWeekAssignment(page.request);

    const first = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()).data;

    // THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. Before the seeder
    // wrote the URLs this came back "no_csv_url" on every single run.
    expect(firstBody.aborted).toBeNull();
    expect(firstBody.rowsSeen).toBeGreaterThan(0);

    // Second run must change nothing: one submission per (assignment, student),
    // held by the unique index on (assignment_id, sheet_row_ref).
    const second = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
    const secondBody = (await second.json()).data;
    expect(secondBody.aborted).toBeNull();
    expect(secondBody.inserted).toBe(0);
    expect(secondBody.updated).toBe(0);
    expect(secondBody.unchanged + secondBody.rowsSeen).toBeGreaterThan(0);

    // The row reaches the student's own history through the read model, not just
    // the database — the half of "delivered" that a SQL assertion cannot see.
    const student = await openSecondUser(browser, baseURL, "student");
    try {
      await student.page.goto("/assignments");
      await expectNoServerError(student.page);
      await expect(student.page.getByTestId("submissions-summary")).toBeVisible();
      // Present for ANY submitted row, whatever its lateness: LatenessBadge renders
      // one of three states ("On time", "Within the grace period", "N days late") and
      // never renders nothing. Asserting on visibility rather than on text keeps this
      // independent of which week `firstWeekAssignment` happened to find — week 1's
      // stand-in respondent is deliberately 6 h EARLY, so a "late" assertion here
      // would be wrong.
      await expect(student.page.getByTestId("lateness-badge").first()).toBeVisible();
    } finally {
      await student.context.close();
    }
  });

  test("the cron sweep ingests every assignment rather than skipping them all", async ({
    request,
  }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET is not available to the test process.");

    const response = await request.post("/api/cron/ingest-submissions", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status()).toBe(200);
    const sweep = (await response.json()).data;

    expect(sweep.assignmentsConsidered).toBeGreaterThan(0);
    // The whole point of item 8: the sweep used to report every assignment as
    // skipped with `no_csv_url`. Now none of them may abort for that reason.
    expect(sweep.assignmentsIngested).toBe(sweep.assignmentsConsidered);
    for (const report of sweep.reports) {
      expect(report.aborted, `assignment ${report.assignmentId} aborted`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. THE OPERATOR SURFACE — added 2026-07-31
// ---------------------------------------------------------------------------
/**
 * WHY THIS GROUP EXISTS.
 *
 * Groups 1-4 prove that ingestion behaves correctly and reports what it did. They
 * do not prove that any HUMAN can find out. Everything ingestion reported went to
 * `console.info`, and the hourly sweep runs on Vercel, so "reported" meant a
 * platform log the instructor cannot open and the admin will not read. The
 * failure this guards against is the specific one that is both silent and likely:
 * a response sheet published as a web page answers 200 OK, reports itself
 * accurately every hour, and every student appears not to have submitted.
 *
 * The page is /assignments/ingest-status and the JSON is
 * GET /api/assignments/ingest-status. Both are staff-only, because the skipped-row
 * samples carry other respondents' email addresses.
 */
test.describe("ingest status is visible to staff", () => {
  test.afterAll(clearStandInSubmissions);

  test("an anonymous request to the status API is rejected", async ({ request }) => {
    const response = await request.get("/api/assignments/ingest-status");
    expect([401, 403]).toContain(response.status());
    expect((await response.json()).ok).toBe(false);
  });

  test("a STUDENT cannot read the status API — the samples carry other people's emails", async ({
    page,
  }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/assignments/ingest-status");
    expect(response.status()).toBe(403);
  });

  test("a STUDENT cannot reach the status page either", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/assignments/ingest-status");
    // requireRole redirects an under-privileged session rather than 403ing a page.
    await expect(page).toHaveURL(/\/login\?error=forbidden/);
  });

  test("an instructor sees every assignment, including ones never ingested", async ({ page }) => {
    await loginAs(page, "instructor");
    const response = await page.request.get("/api/assignments/ingest-status");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    // THE ASSERTION THAT MATTERS. An assignment absent from this list is
    // indistinguishable from a healthy one, so the row count must be the assignment
    // count and not "the ones that have a run recorded".
    expect(body.data.assignments.length).toBeGreaterThan(0);
    expect(body.data.summary.total).toBe(body.data.assignments.length);
    expect(typeof body.data.available).toBe("boolean");
    for (const row of body.data.assignments) {
      expect(typeof row.assignmentId).toBe("number");
      expect(typeof row.sheetConfigured).toBe("boolean");
      // `lastRun` is null-or-object, never absent: "never run" is a state, not a gap.
      expect(row).toHaveProperty("lastRun");
    }
  });

  test("an admin reaches the page and it renders one card per assignment", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/assignments/ingest-status");
    await expectNoServerError(page);
    await expect(page.getByTestId("ingest-status-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Submission ingest status" })).toBeVisible();

    const { assignmentId } = await firstWeekAssignment(page.request);
    // The testid is on the Card element itself, so the card CONTAINS its own title.
    // A sibling stream lost 12 specs today to a testid on an inner div while Card
    // rendered `title` in a header that is a sibling of children.
    const card = page.getByTestId(`ingest-status-${assignmentId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Week");
    await expect(card.getByTestId("ingest-verdict")).toBeVisible();
    await expect(card.getByTestId("ingest-verdict-why")).not.toBeEmpty();
  });

  test("the page does NOT claim a green pipeline while the sheets are stand-ins", async ({
    page,
  }) => {
    // The honesty assertion. A healthy verdict against a sheet this repository
    // generated must not read as "the Google pipeline works" — that is the exact
    // misreading the whole stand-in approach exists to prevent.
    await loginAs(page, "instructor");
    await page.goto("/assignments/ingest-status");
    const notice = page.getByTestId("ingest-stand-in-notice");
    if ((await notice.count()) === 0) {
      test.skip(true, "Real Google sheet URLs are configured; the stand-in notice is correct to be absent.");
    }
    await expect(notice).toContainText("Google is not involved");
  });

  test("a manual ingest is RECORDED, and the page shows what it did", async ({ page }) => {
    // End to end through the real write path: trigger, then read the surface. This
    // is the assertion that would go red if `recordIngestRun` stopped being called
    // from one of ingestAssignment's return paths — the abort paths especially, which
    // are the outcomes nobody currently finds out about.
    await loginAs(page, "instructor");
    const { assignmentId } = await firstWeekAssignment(page.request);

    const ingest = await page.request.post(`/api/assignments/${assignmentId}/ingest`);
    expect(ingest.status()).toBe(200);
    const report = (await ingest.json()).data;

    const status = await page.request.get("/api/assignments/ingest-status");
    const rows = (await status.json()).data.assignments as Array<{
      assignmentId: number;
      lastRun: { triggeredBy: string; rowsSeen: number; aborted: string | null } | null;
    }>;
    const mine = rows.find((r) => r.assignmentId === assignmentId);
    expect(mine, `assignment ${assignmentId} must appear in the status list`).toBeTruthy();
    expect(mine!.lastRun, "the manual ingest just run must have been recorded").not.toBeNull();
    expect(mine!.lastRun!.triggeredBy).toBe("manual");
    expect(mine!.lastRun!.rowsSeen).toBe(report.rowsSeen);
    expect(mine!.lastRun!.aborted).toBe(report.aborted);

    await page.goto("/assignments/ingest-status");
    const card = page.getByTestId(`ingest-status-${assignmentId}`);
    await expect(card).toBeVisible();
    // "never run" is the one verdict that must now be impossible for this row.
    await expect(card).not.toHaveAttribute("data-verdict", "never run");
  });
});
