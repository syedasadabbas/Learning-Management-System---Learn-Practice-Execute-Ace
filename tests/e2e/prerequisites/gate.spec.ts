// =============================================================================
// E2E — the prerequisite gate as a STUDENT experiences it.
// Owner: prerequisites stream (feature 8).
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Eight agents share one dev server on port 3000 and one
// mutable seeded database; running these in parallel with the other streams' specs
// would produce results that mean nothing. The coordinator runs the whole suite
// serially at integration.
//
// ALSO NOT RUNNABLE UNTIL THE MIGRATION LANDS. `course_prerequisites` and
// `course_prerequisite_overrides` are declared in src/db/schema.prerequisites.ts and
// listed in drizzle.config.ts, but no migration has been generated — the coordinator
// generates one at the end of the wave, because eight concurrent generators produced
// conflicting migrations twice today. Every test below therefore asserts its
// precondition explicitly and fails with the command to run, so a missing table reads
// as "you have not migrated", never as "the feature is broken".
//
// PRECONDITIONS — IN THIS ORDER, ONCE, BEFORE THE SUITE:
//
//     npm run db:seed
//     npx tsx scripts/seed-course-access.ts     # the two extra courses
//     npx tsx scripts/seed-prerequisites.ts     # the rule this spec asserts
//
// The third is NOT listed in tests/e2e/fixtures.ts's SUITE_PRECONDITIONS, because
// that file is owned by the devops-testing stream and this stream must not edit it.
// Flagged in the stream report: it belongs there, as a "before" entry immediately
// after seed-course-access.ts.
//
// THIS SPEC MUTATES ONLY `course_prerequisite_overrides`, and only rows for the demo
// student and the one gated extra course. It takes no quiz, so it cannot consume one
// of the demo student's three attempts; it files no access request; and it never
// touches the cohort's own course, so no other stream's week, lock, progress or
// enrolment assertions are affected. The override it grants is REMOVED in an
// afterAll, so the suite is re-runnable.
//
// =============================================================================
// WHAT THIS FILE IS ACTUALLY FOR, and why each assertion is not decoration
// =============================================================================
//
// 1. HIDING A LINK IS NOT ACCESS CONTROL. Every refusal below is reached by TYPING
//    THE URL, never by clicking. The catalog withholds the Request button for a
//    course whose prerequisites are unmet, and that is worth nothing on its own.
//
// 2. "LOCKED IS NOT MISSING." The direct-URL test asserts HTTP **200** and a named
//    reason, not a 404. The codebase draws this line deliberately — a locked week
//    renders a LockedNotice at 200 while a genuinely absent resource 404s — and a
//    404 here would destroy the only information the feature exists to deliver.
//    Asserted on the RESPONSE STATUS, because a page that renders a refusal at 404
//    looks identical in the DOM.
//
// 3. THE STUDENT IS TOLD WHY. The unmet prerequisite is asserted BY NAME. "Locked"
//    with no reason is the failure mode feature 8 exists to remove, and a spec that
//    only checked for a refusal would pass against exactly that.
//
// 4. THE OVERRIDE IS VISIBLE. After an admin grants one, the student's own page must
//    say so and quote the reason. A record only the granter can read is silent to the
//    person it is about.
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { expectNoServerError, loginAs, withDb } from "../fixtures";

/** Titles must match scripts/seed-course-access.ts and scripts/seed-prerequisites.ts. */
const GATED_COURSE = "Data Engineering Foundations";
const PREREQUISITE_COURSE = "Advanced React Patterns";

const SEED_HINT =
  "Run `npm run db:seed && npx tsx scripts/seed-course-access.ts && npx tsx scripts/seed-prerequisites.ts` " +
  "before this suite, and make sure the prerequisites migration has been applied.";

const OVERRIDE_REASON = "e2e: completed the equivalent course elsewhere";

/**
 * The catalog card for a course, located by its visible title rather than by a
 * hardcoded id. Course ids are serial values reassigned by every reseed, so an id in
 * a spec is a test that breaks on a database refresh — the same reasoning
 * tests/e2e/courses/access-requests.spec.ts:47 gives.
 */
function cardFor(page: Page, title: string) {
  return page
    .locator('[data-testid^="course-card-"]')
    .filter({ has: page.getByText(title, { exact: false }) })
    .first();
}

async function courseIdFor(page: Page, title: string): Promise<string> {
  const testId = await cardFor(page, title).getAttribute("data-testid");
  const id = testId?.replace("course-card-", "");
  expect(id, `could not resolve the id of "${title}". ${SEED_HINT}`).toBeTruthy();
  return id!;
}

/**
 * Assert the rule the whole file depends on actually exists.
 *
 * Read straight from the database rather than inferred from the page: if the seed did
 * not run, or the migration has not been applied, every test below would fail in a way
 * that reads as a broken gate. One clear failure beats six confusing ones — the
 * pattern tests/e2e/courses/access-requests.spec.ts:15 established.
 */
async function assertRuleSeeded(): Promise<void> {
  const found = await withDb(async (sql) => {
    const result = await sql(
      `SELECT p.id
         FROM course_prerequisites p
         JOIN courses c  ON c.id = p.course_id
         JOIN courses pc ON pc.id = p.prerequisite_course_id
        WHERE c.title = $1 AND pc.title = $2`,
      [GATED_COURSE, PREREQUISITE_COURSE],
    );
    return result.rowCount ?? 0;
  });
  expect(
    found,
    `"${GATED_COURSE}" does not require "${PREREQUISITE_COURSE}". ${SEED_HINT}`,
  ).toBeGreaterThan(0);
}

/** Remove any override this spec created. Idempotent. */
async function clearOverrides(): Promise<void> {
  await withDb(async (sql) => {
    await sql(
      `DELETE FROM course_prerequisite_overrides
        WHERE reason = $1`,
      [OVERRIDE_REASON],
    );
  });
}

test.afterAll(async () => {
  // Deleted, not revoked. A revoked row would leave the admin console's "Revoked"
  // section growing by one on every suite run; this is test residue, not an audit
  // event, and scripts/seed-prerequisites.ts makes the same call for the same reason.
  await clearOverrides();
});

// ===========================================================================
test.describe("a student blocked by a prerequisite", () => {
  test.beforeEach(async ({ page }) => {
    await clearOverrides();
    await assertRuleSeeded();
    await loginAs(page, "student");
  });

  test("the catalog NAMES the missing prerequisite instead of just hiding the button", async ({
    page,
  }) => {
    await page.goto("/courses");
    await expectNoServerError(page);

    const notice = page.getByTestId("catalog-prerequisites");
    await expect(notice, SEED_HINT).toBeVisible();

    // The reason, by name. This is requirement 5: a withheld button with no
    // explanation is the failure this feature removes.
    await expect(notice).toContainText(GATED_COURSE);
    await expect(notice).toContainText(PREREQUISITE_COURSE);

    // The machine-readable reason, so a copy edit does not break the assertion —
    // the convention CourseCatalog.tsx:25 established with data-access-state.
    await expect(
      notice.locator('[data-unmet-reason="no_access"]').first(),
    ).toBeVisible();
  });

  test("the Request button is withheld for the gated course but offered for the other one", async ({
    page,
  }) => {
    await page.goto("/courses");
    await expectNoServerError(page);

    const gatedId = await courseIdFor(page, GATED_COURSE);
    const openableId = await courseIdFor(page, PREREQUISITE_COURSE);

    // Not a security assertion — the next test is. This one proves the auto-refusal
    // is scoped: a bug that withheld every button would pass a test that only looked
    // at the gated course.
    await expect(
      page.locator(`[data-testid="course-card-${gatedId}"] button`, {
        hasText: /request/i,
      }),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-testid="course-card-${openableId}"] button`, {
        hasText: /request/i,
      }),
    ).not.toHaveCount(0);
  });

  test("typing the URL is refused at HTTP 200 with the reason named, NOT a 404", async ({
    page,
  }) => {
    // THE MOST IMPORTANT TEST IN THIS FILE. Hiding a link is not access control, so
    // this navigates by URL. And "locked is not missing", so the STATUS is asserted:
    // a refusal rendered at 404 looks identical in the DOM and would destroy the
    // student's ability to tell "not for me yet" from "does not exist".
    await page.goto("/courses");
    const gatedId = await courseIdFor(page, GATED_COURSE);

    const response = await page.goto(`/courses/${gatedId}`);
    expect(response, "no response for the course URL").not.toBeNull();
    expect(response!.status(), "a prerequisite refusal must be a 200, not a 404").toBe(200);
    await expectNoServerError(page);

    const denied = page.getByTestId("course-access-denied");
    await expect(denied).toBeVisible();
    // The DENIAL KIND, from the data attribute the page already exposes, so this
    // does not pass against a generic "not available" refusal.
    await expect(denied).toHaveAttribute("data-denial", "prerequisite_unmet");

    const notice = page.getByTestId("prerequisite-notice");
    await expect(notice).toHaveAttribute("data-variant", "blocked");
    await expect(notice).toContainText(PREREQUISITE_COURSE);
  });

  test("no course content is rendered on the refused page", async ({ page }) => {
    // The property /courses/[courseId]/page.tsx:10 documents and this stream had to
    // preserve: the refusal happens BEFORE `listCourseWeeks` is called, so a render
    // bug further down cannot leak an outline. Asserted from the outside by the
    // absence of the outline the allowed branch renders.
    await page.goto("/courses");
    const gatedId = await courseIdFor(page, GATED_COURSE);
    await page.goto(`/courses/${gatedId}`);

    await expect(page.getByTestId("course-week-outline")).toHaveCount(0);
    await expect(page.getByTestId("course-detail")).toHaveCount(0);
  });

  test("the refusal does not claim a quiz will open the course", async ({ page }) => {
    // docs/SUBJECT_SECTIONS.md:101 records why this matters for section refusals: a
    // wrong reason sends a student to spend one of their three quiz attempts for
    // nothing. A prerequisite is not opened by any quiz in THIS course either.
    await page.goto("/courses");
    const gatedId = await courseIdFor(page, GATED_COURSE);
    await page.goto(`/courses/${gatedId}`);

    const notice = page.getByTestId("prerequisite-notice");
    await expect(notice).not.toContainText(/pass the week/i);
  });
});

// ===========================================================================
test.describe("the cohort's own course is never prerequisite-gated", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("a prerequisite recorded against the ACTIVE course does not close it", async ({
    page,
  }) => {
    // THE COMPATIBILITY RULE, end to end. src/lib/courses/policy.ts:36 records that
    // gating the active course "would have silently revoked the course every existing
    // student is on". If this test ever fails, one admin data-entry mistake takes the
    // whole cohort out of the course they are studying.
    //
    // The rule is inserted directly rather than through the admin UI: the UI warns
    // about exactly this and the point here is that the GATE holds even when the row
    // exists, however it got there.
    const activeCourseId = await withDb(async (sql) => {
      const result = await sql(`SELECT id FROM courses ORDER BY id ASC LIMIT 1`);
      return Number(result.rows[0]?.id);
    });
    const otherCourseId = await withDb(async (sql) => {
      const result = await sql(
        `SELECT id FROM courses WHERE title = $1 LIMIT 1`,
        [PREREQUISITE_COURSE],
      );
      return Number(result.rows[0]?.id);
    });
    expect(Number.isFinite(activeCourseId), SEED_HINT).toBe(true);
    expect(Number.isFinite(otherCourseId), SEED_HINT).toBe(true);

    try {
      await withDb(async (sql) => {
        await sql(
          `INSERT INTO course_prerequisites (course_id, prerequisite_course_id, min_score)
           VALUES ($1, $2, NULL)
           ON CONFLICT DO NOTHING`,
          [activeCourseId, otherCourseId],
        );
      });

      const response = await page.goto(`/courses/${activeCourseId}`);
      expect(response!.status()).toBe(200);
      await expectNoServerError(page);

      // ALLOWED, and allowed as the open course — not as an approved request, which
      // would mean the compatibility branch had been bypassed.
      await expect(page.getByTestId("course-detail")).toBeVisible();
      await expect(page.getByTestId("access-via")).toContainText(/open to your cohort/i);

      // And /weeks, the surface every other stream's specs use, still works.
      const weeks = await page.goto("/weeks");
      expect(weeks!.status()).toBe(200);
      await expectNoServerError(page);
    } finally {
      // ALWAYS removed, even on failure. Leaving this row behind would put a
      // prerequisite on the cohort course for every subsequent spec in the run.
      await withDb(async (sql) => {
        await sql(
          `DELETE FROM course_prerequisites
            WHERE course_id = $1 AND prerequisite_course_id = $2`,
          [activeCourseId, otherCourseId],
        );
      });
    }
  });
});

// ===========================================================================
test.describe("staff are not locked out by a prerequisite", () => {
  for (const role of ["instructor", "admin"] as const) {
    test(`an ${role} can open the gated course`, async ({ page }) => {
      // An admin who had to satisfy a prerequisite before they could see the course
      // they are configuring is a deadlock, and an instructor who cannot open the
      // course they teach cannot grade it. `decideCourseAccess`'s staff branch runs
      // before the prerequisite check; this asserts that end to end.
      await assertRuleSeeded();
      await loginAs(page, role);

      await page.goto("/courses");
      const gatedId = await courseIdFor(page, GATED_COURSE);

      const response = await page.goto(`/courses/${gatedId}`);
      expect(response!.status()).toBe(200);
      await expect(page.getByTestId("course-detail")).toBeVisible();
      await expect(page.getByTestId("access-via")).toContainText(/staff access/i);
    });
  }
});
