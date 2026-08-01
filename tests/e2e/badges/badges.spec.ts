// =============================================================================
// E2E — /badges and the two badges API routes. Owner: badges stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Eight agents shared one database and one dev-server port
// while this was written, so running Playwright would have collided with seven
// other suites. Everything asserted here is therefore UNVERIFIED BY ME; the unit
// and integration coverage that I did run is:
//   * src/lib/badges/evaluate.test.ts          — 23 tests, the pure criteria
//   * src/lib/badges/on-scoring-event.test.ts  —  8 tests, the trigger seam
//   * src/lib/badges/award.integration.test.ts —  9 tests against real Postgres,
//     including eight concurrent awards collapsing to one row, and the same race
//     WITHOUT the unique index producing eight rows.
//
// PRECONDITION: `badge_awards` must exist. Its migration is generated once, by the
// coordinator, at the end of the wave (eight concurrent `db:generate` runs produce
// conflicting migrations — that broke twice). Until it is applied and pushed, every
// spec in this file fails at the first page load with a 500, and that is the
// expected failure rather than a bug in the specs. `npm run db:migrate` first.
//
// WHAT THESE SPECS ARE FOR, given the coverage above. Not the awarding logic — that
// is settled in Postgres and asserted there. These cover the three things only a
// browser can: the page renders for a real session, the nav link reaches it, and
// the API returns the same shape the page renders from.
//
// The DEMO STUDENT is seeded with no submissions and no quiz attempts (verified
// while writing this: loadBadgeFacts for student@codequeenshub.test returned
// submissionCount 0, bestQuizPercent null, solvedProblemCount 1, totalScore 0), so
// they earn NOTHING. Specs that need an earned badge insert one directly through
// `withDb` and delete it afterwards, rather than driving a grading flow that belongs
// to another stream's suite.
// =============================================================================

import { expect, test } from "@playwright/test";

import { DEMO, expectNoServerError, loginAs, withDb } from "../fixtures";

/** Every badge type the catalogue ships. Mirrors src/lib/badges/catalogue.ts. */
const CATALOGUE = [
  "first_submission",
  "perfect_quiz",
  "all_assignments_ontime",
  "coding_genius",
  "high_score",
] as const;

/** The demo student's id, resolved once per spec that needs it. */
async function demoStudentId(): Promise<number> {
  return withDb(async (sql) => {
    const result = await sql(`select id from users where email = $1`, [DEMO.student.email]);
    const row = result.rows[0];
    if (!row) throw new Error(`demo student ${DEMO.student.email} is not seeded`);
    return Number(row.id);
  });
}

/** Remove every award for a student, so a spec starts and ends from a known state. */
async function clearAwards(studentId: number): Promise<void> {
  await withDb(async (sql) => {
    await sql(`delete from badge_awards where student_id = $1`, [studentId]);
  });
}

test.describe("/badges renders the catalogue", () => {
  test("a student sees every badge, with the unearned ones marked", async ({ page }) => {
    const studentId = await demoStudentId();
    await clearAwards(studentId);

    await loginAs(page, "student");
    await page.goto("/badges");
    await expectNoServerError(page);

    await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();

    const cards = page.getByTestId("achievement-card");
    await expect(cards).toHaveCount(CATALOGUE.length);

    // Every catalogue entry is present and identified by its type, so a renamed
    // badge fails here rather than silently disappearing from the grid.
    for (const type of CATALOGUE) {
      await expect(page.locator(`[data-badge-type="${type}"]`)).toHaveCount(1);
    }

    // The demo student earns nothing, so the summary must say 0.
    const summary = page.getByTestId("achievement-summary");
    await expect(summary).toHaveAttribute("data-earned-count", "0");
    await expect(summary).toHaveAttribute("data-total-count", String(CATALOGUE.length));
  });

  test("an unearned card shows the criteria, not the past tense description", async ({ page }) => {
    const studentId = await demoStudentId();
    await clearAwards(studentId);

    await loginAs(page, "student");
    await page.goto("/badges");

    const card = page.locator('[data-badge-type="perfect_quiz"]');
    await expect(card).toHaveAttribute("data-earned", "false");
    // "Score 100% on any quiz attempt." — the instruction. NOT "You scored 100%",
    // which would be a lie on an unearned card.
    await expect(card).toContainText("Score 100%");
    await expect(card).toContainText("Not earned yet");
    await expect(card).not.toContainText("You scored");
  });

  test("an earned badge shows as earned, with its award date", async ({ page }) => {
    const studentId = await demoStudentId();
    await clearAwards(studentId);
    try {
      await withDb(async (sql) => {
        await sql(
          `insert into badge_awards (student_id, type, evidence) values ($1, 'perfect_quiz', $2)`,
          [studentId, JSON.stringify({ percentage: 100, quizId: 1 })],
        );
      });

      await loginAs(page, "student");
      await page.goto("/badges");
      await expectNoServerError(page);

      const card = page.locator('[data-badge-type="perfect_quiz"]');
      await expect(card).toHaveAttribute("data-earned", "true");
      await expect(card).toContainText("You scored 100%");
      await expect(card).toContainText("Earned");
      // The <time> element carries the machine-readable date.
      await expect(card.locator("time")).toHaveCount(1);

      await expect(page.getByTestId("achievement-summary")).toHaveAttribute(
        "data-earned-count",
        "1",
      );
    } finally {
      await clearAwards(studentId);
    }
  });

  test("the page states that badges carry no marks", async ({ page }) => {
    // Not decoration. Badges deliberately do not feed the leaderboard — see
    // src/db/schema.badges.ts:56-64 — and the page has to say so, or a student who
    // earns four badges and sees no rank change will read it as a bug.
    await loginAs(page, "student");
    await page.goto("/badges");
    await expect(page.getByText(/do not change your score/i)).toBeVisible();
  });
});

test.describe("the sidebar reaches /badges", () => {
  test("the Achievements link navigates there", async ({ page }) => {
    // Guards the nav wiring end to end. tests/unit/cross-stream-contracts.test.ts
    // already asserts the href resolves to a page.tsx on disk; this asserts a real
    // click gets a real student to a real page.
    await loginAs(page, "student");
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Achievements" }).first().click();
    await expect(page).toHaveURL(/\/badges$/);
    await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  });
});

test.describe("staff see the catalogue but earn nothing", () => {
  test("an instructor is not refused, and no badge is awarded to them", async ({ page }) => {
    // "student" in ROLE_SATISFYING means "signed in", so staff reach this page. The
    // page must degrade with a note rather than 403 — a nav link whose destination
    // refuses the person who can see it is worse than no link
    // (src/components/nav/nav-links.ts:171-176).
    await loginAs(page, "instructor");
    await page.goto("/badges");
    await expectNoServerError(page);

    await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
    await expect(page.getByText(/earn no badges/i)).toBeVisible();

    // And the read must not have WRITTEN anything for them: getBadgeView is called
    // with evaluate:false for staff.
    const instructorAwards = await withDb(async (sql) => {
      const result = await sql(
        `select count(*)::int as n from badge_awards ba
           join users u on u.id = ba.student_id
          where u.email = $1`,
        [DEMO.instructor.email],
      );
      return Number(result.rows[0].n);
    });
    expect(instructorAwards).toBe(0);
  });
});

test.describe("GET /api/me/badges", () => {
  test("returns the viewer's own badges and the whole catalogue", async ({ page }) => {
    const studentId = await demoStudentId();
    await clearAwards(studentId);
    try {
      await withDb(async (sql) => {
        await sql(`insert into badge_awards (student_id, type) values ($1, 'first_submission')`, [
          studentId,
        ]);
      });

      await loginAs(page, "student");
      const response = await page.request.get("/api/me/badges");
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.studentId).toBe(studentId);
      expect(body.data.totalCount).toBe(CATALOGUE.length);
      expect(body.data.entries.map((e: { type: string }) => e.type)).toEqual([...CATALOGUE]);

      const earned = body.data.entries.filter((e: { earned: boolean }) => e.earned);
      expect(earned).toHaveLength(1);
      expect(earned[0].type).toBe("first_submission");
      // ISO 8601 string, not a serialised Date object — the wire shape is declared
      // in toBadgeViewJson rather than left to JSON.stringify.
      expect(typeof earned[0].awardedAt).toBe("string");
      expect(() => new Date(earned[0].awardedAt as string).toISOString()).not.toThrow();
    } finally {
      await clearAwards(studentId);
    }
  });

  test("takes no studentId — a classmate's badges are not readable", async ({ page }) => {
    // "me" is the session, never a query string
    // (src/app/api/leaderboard/me/route.ts:5-8). A `studentId` parameter must be
    // ignored outright, not honoured and not 400'd.
    const studentId = await demoStudentId();
    await loginAs(page, "student");

    const response = await page.request.get("/api/me/badges?studentId=999999");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.studentId).toBe(studentId);
  });

  test("is refused without a session", async ({ page }) => {
    const response = await page.request.get("/api/me/badges");
    expect([401, 403]).toContain(response.status());
  });
});

test.describe("GET /api/badges", () => {
  test("returns the catalogue with criteria and rarity", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/badges");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.badges.map((b: { type: string }) => b.type)).toEqual([...CATALOGUE]);

    for (const badge of body.data.badges) {
      // Every entry must be renderable: a card with no name or no criteria is the
      // "permanently locked, unexplained" state catalogue.ts:19-22 argues against.
      expect(badge.name).toBeTruthy();
      expect(badge.criteria).toBeTruthy();
      expect(badge.glyph).toBeTruthy();
      expect(["common", "rare", "epic", "legendary"]).toContain(badge.rarity);
    }
  });

  test("has no write methods — the catalogue lives in code", async ({ page }) => {
    // IMPLEMENTATION_ROADMAP.md:262 asks for "Badge CRUD". There is no definitions
    // table to write to (src/db/schema.badges.ts:29-64), so POST must be a 405 from
    // the router rather than a stub pretending to accept an edit.
    await loginAs(page, "student");
    const response = await page.request.post("/api/badges", { data: { name: "Hacked" } });
    expect(response.status()).toBe(405);
  });
});

test.describe("awarding is idempotent through the UI", () => {
  test("reloading /badges repeatedly never duplicates a badge", async ({ page }) => {
    // The browser-level version of the guarantee proven in
    // src/lib/badges/award.integration.test.ts. /badges re-evaluates the criteria on
    // every load (the backfill path, src/lib/badges/queries.ts:60-79), so a page a
    // student refreshes ten times runs ten evaluations — and must still leave one row
    // per badge. This is the spec that would catch a regression from
    // ON CONFLICT DO NOTHING back to a check-then-insert.
    const studentId = await demoStudentId();
    await clearAwards(studentId);
    try {
      await loginAs(page, "student");
      for (let i = 0; i < 5; i += 1) {
        await page.goto("/badges");
        await expectNoServerError(page);
      }

      const duplicates = await withDb(async (sql) => {
        const result = await sql(
          `select type, count(*)::int as n from badge_awards
            where student_id = $1 group by type having count(*) > 1`,
          [studentId],
        );
        return result.rows;
      });
      expect(duplicates).toEqual([]);
    } finally {
      await clearAwards(studentId);
    }
  });
});
