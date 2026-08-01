// =============================================================================
// E2E — the admin console: authoring rules, refusing cycles, and the override.
// Owner: prerequisites stream (feature 8).
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM, and NOT RUNNABLE UNTIL THE MIGRATION LANDS. See the header
// of ./gate.spec.ts for both, and for the precondition commands.
//
// PRECONDITIONS — IN THIS ORDER, ONCE, BEFORE THE SUITE:
//
//     npm run db:seed
//     npx tsx scripts/seed-course-access.ts
//     npx tsx scripts/seed-prerequisites.ts
//
// THIS SPEC WRITES AND THEN CLEANS UP. It adds one rule and one override, asserts
// them, and removes both. The seeded rule from scripts/seed-prerequisites.ts is left
// intact, because ./gate.spec.ts asserts against it.
//
// =============================================================================
// WHAT THIS FILE IS FOR
// =============================================================================
//
// 1. THE CYCLE REFUSAL, THROUGH THE REAL SERVER. The authoritative proof that
//    "A requiring B requiring A" is impossible is in
//    src/lib/prerequisites/graph.test.ts — 30 unit tests over chains, diamonds,
//    disconnected components and an already-cyclic graph — because a form refusing a
//    click proves nothing about the rule. What THIS test adds is that the refusal is
//    wired up: the admin sees a readable sentence rather than a constraint-violation
//    stack trace, and no row is written.
//
// 2. THE OVERRIDE IS AUTHORISED AND VISIBLE. A student must not be able to grant one
//    (asserted by URL, not by a missing menu item), and once granted it must appear on
//    the console WITH its reason and author AND on the student's own page.
//
// 3. REVOCATION KEEPS THE RECORD. A revoked override moves to a "Revoked" list rather
//    than vanishing, because the record of who granted an exception must survive its
//    withdrawal.
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { expectNoServerError, loginAs, withDb } from "../fixtures";

const GATED_COURSE = "Data Engineering Foundations";
const PREREQUISITE_COURSE = "Advanced React Patterns";

const SEED_HINT =
  "Run `npm run db:seed && npx tsx scripts/seed-course-access.ts && npx tsx scripts/seed-prerequisites.ts` " +
  "before this suite, and make sure the prerequisites migration has been applied.";

const OVERRIDE_REASON = "e2e admin: transcript on file";

/** Remove everything this spec creates. Idempotent, safe to call twice. */
async function cleanup(): Promise<void> {
  await withDb(async (sql) => {
    await sql(`DELETE FROM course_prerequisite_overrides WHERE reason = $1`, [
      OVERRIDE_REASON,
    ]);
    // The reverse edge this spec tries (and expects) to be refused. Deleted anyway:
    // if the refusal ever regresses, the leaked row would put a cycle in the graph
    // for every subsequent spec in the run, and a cycle makes courses un-enterable.
    await sql(
      `DELETE FROM course_prerequisites
        WHERE course_id = (SELECT id FROM courses WHERE title = $1)
          AND prerequisite_course_id = (SELECT id FROM courses WHERE title = $2)`,
      [PREREQUISITE_COURSE, GATED_COURSE],
    );
  });
}

test.beforeEach(cleanup);
test.afterAll(cleanup);

/**
 * Select an option whose visible text CONTAINS `label`.
 *
 * Resolves the option's `value` and selects by value rather than passing
 * `{ label }`: Playwright's label matcher is an exact string, and the student picker
 * renders "Demo Student (student@codequeenshub.test)". Matching on a substring keeps
 * the spec from hardcoding the email format, and resolving the VALUE keeps it from
 * hardcoding a course id — ids are serial values reassigned by every reseed.
 */
async function choose(page: Page, testId: string, label: string): Promise<void> {
  const select = page.getByTestId(testId);
  const value = await select
    .locator("option", { hasText: label })
    .first()
    .getAttribute("value");
  expect(value, `no option containing "${label}" in ${testId}. ${SEED_HINT}`).toBeTruthy();
  await select.selectOption(value!);
}

// ===========================================================================
test.describe("only an admin reaches the console", () => {
  test("a student is refused /admin/prerequisites by URL", async ({ page }) => {
    // By URL, not by looking for an absent nav link. Hiding a link is not access
    // control, and this page authors the rules that decide who enters a course.
    await loginAs(page, "student");
    await page.goto("/admin/prerequisites");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("admin-prerequisites")).toHaveCount(0);
  });

  test("an INSTRUCTOR is refused too", async ({ page }) => {
    // Deliberately the same level as /admin/course-requests: authoring a prerequisite
    // is an ENROLMENT act, and a feature that admitted instructors to a decision the
    // neighbouring feature reserves for admins would be a privilege escalation by
    // inconsistency. See src/lib/prerequisites/policy.ts's PREREQUISITE_ADMIN_AUTH.
    await loginAs(page, "instructor");
    await page.goto("/admin/prerequisites");
    await expect(page.getByTestId("admin-prerequisites")).toHaveCount(0);
  });

  test("an admin sees the console with the seeded rule listed", async ({ page }) => {
    await loginAs(page, "admin");
    const response = await page.goto("/admin/prerequisites");
    expect(response!.status()).toBe(200);
    await expectNoServerError(page);

    const list = page.getByTestId("prerequisite-rule-list");
    await expect(list, SEED_HINT).toBeVisible();
    await expect(list).toContainText(GATED_COURSE);
    await expect(list).toContainText(PREREQUISITE_COURSE);

    // No cycle exists, so the tripwire banner must be absent. Asserting its ABSENCE
    // matters: a banner that is always rendered would be ignored by the time it means
    // something.
    await expect(page.getByTestId("cycle-warning")).toHaveCount(0);
  });
});

// ===========================================================================
test.describe("cycles are refused, not stored", () => {
  test("adding the reverse of an existing rule is refused with a readable reason", async ({
    page,
  }) => {
    // The seed already has: GATED requires PREREQUISITE. This attempts the reverse.
    await loginAs(page, "admin");
    await page.goto("/admin/prerequisites");
    await expectNoServerError(page);

    await choose(page, "prerequisite-course", PREREQUISITE_COURSE);
    await choose(page, "prerequisite-required-course", GATED_COURSE);
    await page.getByTestId("add-prerequisite-form").getByRole("button").click();

    // A sentence, not a stack trace. `PREREQUISITE_REFUSAL_MESSAGE.cycle` explains
    // that neither course could ever be taken.
    await expect(page.getByRole("alert").or(page.locator("text=circular")).first()).toContainText(
      /circular/i,
    );

    // AND NO ROW WAS WRITTEN. The message is the symptom; this is the property.
    const stored = await withDb(async (sql) => {
      const result = await sql(
        `SELECT p.id FROM course_prerequisites p
           JOIN courses c  ON c.id = p.course_id
           JOIN courses pc ON pc.id = p.prerequisite_course_id
          WHERE c.title = $1 AND pc.title = $2`,
        [PREREQUISITE_COURSE, GATED_COURSE],
      );
      return result.rowCount ?? 0;
    });
    expect(stored, "the reverse edge must not have been stored").toBe(0);
  });

  test("a course cannot be made its own prerequisite", async ({ page }) => {
    // The select filters the chosen course out, so this is asserted at the DATA
    // level: the degenerate 1-cycle is unrepresentable because of the
    // `course_prerequisites_no_self` CHECK, not because of a filtered dropdown.
    await loginAs(page, "admin");
    await page.goto("/admin/prerequisites");

    const rejected = await withDb(async (sql) => {
      const course = await sql(`SELECT id FROM courses WHERE title = $1 LIMIT 1`, [
        GATED_COURSE,
      ]);
      const id = Number(course.rows[0]?.id);
      try {
        await sql(
          `INSERT INTO course_prerequisites (course_id, prerequisite_course_id) VALUES ($1, $1)`,
          [id],
        );
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected, "the database must refuse a self-prerequisite").toBe(true);
  });
});

// ===========================================================================
test.describe("the admin override — REQUIREMENT 4", () => {
  test("grants access, is listed with its reason, and the STUDENT is told", async ({
    page,
    browser,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/prerequisites");
    await expectNoServerError(page);

    await choose(page, "override-student", "Demo Student");
    await choose(page, "override-course", GATED_COURSE);
    await page.getByTestId("override-reason-input").fill(OVERRIDE_REASON);
    await page.getByTestId("grant-override-form").getByRole("button").click();

    // Listed as LIVE, with the reason. An override an auditor cannot read is silent.
    const live = page.getByTestId("live-override-list");
    await expect(live).toBeVisible();
    await expect(live).toContainText(OVERRIDE_REASON);
    await expect(live).toContainText("Demo Student");
    // The audit snapshot of what was actually waived, which survives a later change
    // to the rules.
    await expect(live).toContainText(PREREQUISITE_COURSE);

    // ---- and now the student, in a separate session ------------------------
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    try {
      await loginAs(studentPage, "student");
      await studentPage.goto("/courses");
      const testId = await studentPage
        .locator('[data-testid^="course-card-"]')
        .filter({ has: studentPage.getByText(GATED_COURSE, { exact: false }) })
        .first()
        .getAttribute("data-testid");
      const gatedId = testId?.replace("course-card-", "");
      expect(gatedId, SEED_HINT).toBeTruthy();

      const response = await studentPage.goto(`/courses/${gatedId}`);
      expect(response!.status()).toBe(200);

      // NOTE: the student is only ADMITTED here if they also have an approved access
      // request for this course, because the prerequisite check sits inside
      // `decideCourseAccess`'s `approved` branch — the override waives the
      // PREREQUISITE, not the enrolment. Both outcomes are asserted, and which one
      // applies depends on whether the courses stream's own spec ran first, so the
      // assertion is on the property that must hold either way: the student must NOT
      // be refused FOR THE PREREQUISITE.
      const denied = studentPage.getByTestId("course-access-denied");
      if (await denied.count()) {
        await expect(
          denied,
          "the override must remove the prerequisite denial",
        ).not.toHaveAttribute("data-denial", "prerequisite_unmet");
      } else {
        // Admitted. The override must be VISIBLE to them, with its reason.
        const notice = studentPage.getByTestId("prerequisite-override");
        await expect(notice).toBeVisible();
        await expect(studentPage.getByTestId("override-reason")).toContainText(
          OVERRIDE_REASON,
        );
      }
    } finally {
      await studentContext.close();
    }
  });

  test("a student cannot grant themselves one", async ({ page }) => {
    // The form is admin-only, so this probes the underlying decision the only way a
    // browser can: the page itself. `grantPrerequisiteOverrideAction` opens with
    // `requirePrerequisiteAdmin()`, which is asserted directly as a pure function in
    // src/lib/prerequisites/policy.test.ts ("REFUSES a student, and refuses on the
    // ROLE first") — a compiled server action cannot be invoked from a spec without
    // reimplementing the RSC protocol, so the pure assertion is the real proof and
    // this is the reachability check.
    await loginAs(page, "student");
    await page.goto("/admin/prerequisites");
    await expect(page.getByTestId("grant-override-form")).toHaveCount(0);
    await expect(page.getByTestId("override-panel")).toHaveCount(0);
  });

  test("revoking keeps the record instead of deleting it", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/prerequisites");

    await choose(page, "override-student", "Demo Student");
    await choose(page, "override-course", GATED_COURSE);
    await page.getByTestId("override-reason-input").fill(OVERRIDE_REASON);
    await page.getByTestId("grant-override-form").getByRole("button").click();

    const liveRow = page.locator('[data-override-state="live"]').first();
    await expect(liveRow).toBeVisible();
    const overrideId = (await liveRow.getAttribute("data-testid"))?.replace("override-", "");
    expect(overrideId).toBeTruthy();

    await page.getByTestId(`revoke-override-${overrideId}`).click();

    // Moved, not deleted: the record of who granted an exception and who withdrew it
    // is the audit trail, and deleting it would erase the only evidence either
    // decision was made.
    await expect(page.getByTestId("revoked-override-list")).toContainText(OVERRIDE_REASON);
    await expect(page.getByTestId(`override-${overrideId}`)).toHaveAttribute(
      "data-override-state",
      "revoked",
    );

    const rows = await withDb(async (sql) => {
      const result = await sql(
        `SELECT revoked_at, revoked_by FROM course_prerequisite_overrides WHERE reason = $1`,
        [OVERRIDE_REASON],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at, "the row must be stamped, not removed").not.toBeNull();
    expect(rows[0].revoked_by, "the revoking admin must be recorded").not.toBeNull();
  });
});

// ===========================================================================
test.describe("the derived learning path", () => {
  test("orders the prerequisite before the course that needs it", async ({ page }) => {
    // IMPLEMENTATION_ROADMAP.md:491 specifies a `learning_paths` table with an explicit
    // course order. It was deliberately not built — see `topologicalOrder`'s docstring
    // — and this asserts the derived replacement actually produces a usable order.
    await loginAs(page, "admin");
    await page.goto("/admin/prerequisites");

    const path = page.getByTestId("learning-path");
    await expect(path, SEED_HINT).toBeVisible();

    const items = await path.locator("li").allTextContents();
    const prereqIndex = items.findIndex((t) => t.includes(PREREQUISITE_COURSE));
    const gatedIndex = items.findIndex((t) => t.includes(GATED_COURSE));
    expect(prereqIndex).toBeGreaterThanOrEqual(0);
    expect(gatedIndex).toBeGreaterThanOrEqual(0);
    expect(
      prereqIndex,
      "the prerequisite must be listed before the course that requires it",
    ).toBeLessThan(gatedIndex);
  });
});
