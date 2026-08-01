// =============================================================================
// E2E — /notifications: the history dashboard and the email preferences.
// Owner: the email-notifications stream (roadmap PHASE 1 feature 1).
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Nine agents share port 3000 and one mutable seeded
// database on 2026-07-31, so the coordinator runs Playwright serially at the end.
// Every assertion below is therefore UNVERIFIED, and that is stated here rather
// than implied by a green unit suite. What HAS been run and seen green is the
// vitest coverage of the same logic: src/lib/notifications/*.test.ts (52 tests) and
// src/lib/queue/handlers/notification-email.test.ts (19 tests).
//
// PRECONDITION BEYOND THE USUAL SEED: this feature's two tables
// (`notifications`, `notification_preferences`) do not exist until the coordinator
// generates and applies the shared add-on migration. Until then EVERY test in this
// file fails at the first database call, and the failure is a missing relation, not
// a broken feature. The `beforeAll` below turns that into ONE clear skip with the
// reason attached, instead of five confusing failures.
//
// WHY THIS SPEC SEEDS ITS OWN ROWS. The producers that would create notifications
// naturally are not wired into the quiz/exam/penalty paths yet — the three call
// sites live in other streams' files and were reported to the coordinator rather
// than edited (src/lib/notifications/producers.ts documents each one). So a spec
// that submitted a quiz and waited for mail would be asserting a wire that does not
// exist. Inserting rows directly tests exactly what this stream DOES own: the
// history read model, the ownership filter, and the preference round trip.
//
// The inserted rows are removed in `afterAll`, and every one is tagged with a
// `dedupe_key` under the `__e2e_notif:` prefix so a crashed run leaves rows that are
// identifiable and cannot collide with a real notification's key (real keys always
// start with `notification_email:`).
// =============================================================================

import { expect, test } from "@playwright/test";

import { DEMO, SEED_HINT, expectNoServerError, loginAs, withDb } from "../fixtures";

/** Prefix for every row this spec creates. Never produced by application code. */
const E2E_KEY_PREFIX = "__e2e_notif:";

/** Set in `beforeAll`; when false every test skips with the migration message. */
let tablesExist = false;

async function studentId(): Promise<number> {
  return withDb(async (sql) => {
    const result = await sql(`select id from users where email = $1`, [DEMO.student.email]);
    if (result.rows.length === 0) {
      throw new Error(`The demo student ${DEMO.student.email} is missing. Seed first: ${SEED_HINT}`);
    }
    return Number(result.rows[0].id);
  });
}

test.beforeAll(async () => {
  tablesExist = await withDb(async (sql) => {
    const result = await sql(
      `select to_regclass('public.notifications') is not null as a,
              to_regclass('public.notification_preferences') is not null as b`,
    );
    return Boolean(result.rows[0]?.a) && Boolean(result.rows[0]?.b);
  });

  if (!tablesExist) return;

  const id = await studentId();
  await withDb(async (sql) => {
    // Clear residue from a previous run, then insert two known rows: one already
    // emailed and read, one still queued and unread. Both states are rendered
    // differently and both are asserted below.
    await sql(`delete from notifications where dedupe_key like $1`, [`${E2E_KEY_PREFIX}%`]);
    await sql(
      `insert into notifications
         (user_id, type, dedupe_key, recipient_email, subject, body, metadata, status, sent_at, read_at)
       values
         ($1, 'quiz_submitted', $2, $3, $4, $5, $6::jsonb, 'sent', now(), now()),
         ($1, 'penalty_issued', $7, $3, $8, $9, null, 'pending', null, null)`,
      [
        id,
        `${E2E_KEY_PREFIX}quiz`,
        DEMO.student.email,
        "E2E: your quiz attempt was graded",
        "Score: 8 / 10 (80%)\nResult: Passed",
        JSON.stringify({ url: "/quizzes/1" }),
        `${E2E_KEY_PREFIX}penalty`,
        "E2E: a late submission record was added",
        "Points deducted: 5",
      ],
    );
  });
});

test.afterAll(async () => {
  if (!tablesExist) return;
  await withDb(async (sql) => {
    await sql(`delete from notifications where dedupe_key like $1`, [`${E2E_KEY_PREFIX}%`]);
    // The preferences row IS left in place deliberately when a test changed it —
    // see the preference spec's own note. Reset to the default set instead of
    // deleting, so a later run starts from a known state either way.
    const id = await studentId();
    await sql(
      `update notification_preferences
          set quiz_submitted = true, exam_completed = true, assignment_feedback = true,
              penalty_issued = true, forum_reply = true, badge_earned = true,
              grade_posted = true, course_message = true
        where user_id = $1`,
      [id],
    );
  });
});

test.beforeEach(async ({ page }) => {
  test.skip(
    !tablesExist,
    "`notifications` / `notification_preferences` do not exist yet. The email-notifications " +
      "stream declares them in src/db/schema.notifications.ts and adds the path to " +
      "drizzle.config.ts; the coordinator generates ONE migration for the whole add-on wave. " +
      "Run that migration, then re-run this file.",
  );
  await loginAs(page, "student");
  await page.goto("/notifications");
  await expectNoServerError(page);
});

test.describe("notification history", () => {
  test("lists the messages this course has sent, newest first", async ({ page }) => {
    await expect(page.getByTestId("notifications-heading")).toBeVisible();
    const items = page.getByTestId("notification-item");
    await expect(items).toHaveCount(2);

    // Ordered newest first. Both rows were inserted in one statement, so the tie is
    // broken by id descending — the second value in the ORDER BY, which is there
    // precisely so the order is total rather than arbitrary.
    await expect(items.first()).toContainText("a late submission record was added");
  });

  test("shows what was actually sent, including the score lines", async ({ page }) => {
    const quizRow = page.locator('[data-testid="notification-item"][data-notification-type="quiz_submitted"]');
    await expect(quizRow).toContainText("Score: 8 / 10 (80%)");
    await expect(quizRow).toContainText("Result: Passed");
  });

  test("distinguishes an emailed message from one still queued", async ({ page }) => {
    // "Emailed", never "Delivered": the transport acknowledging a message is not
    // proof of delivery, and with no SMTP configured the acknowledgement comes from
    // the dev logger. The label is the honest one.
    await expect(
      page.locator('[data-testid="notification-item"][data-notification-status="sent"]'),
    ).toContainText("Emailed");
    await expect(
      page.locator('[data-testid="notification-item"][data-notification-status="pending"]'),
    ).toContainText("Queued");
  });

  test("marks the unread one as read, and the count goes away", async ({ page }) => {
    await expect(page.getByTestId("unread-count")).toHaveAttribute("data-unread", "1");
    await page.getByTestId("mark-all-read").click();

    await expect(page.getByTestId("unread-count")).toHaveCount(0);
    await expect(page.locator('[data-testid="notification-item"][data-unread="true"]')).toHaveCount(
      0,
    );
  });

  test("never shows another student's notifications", async ({ page }) => {
    // The ownership predicate is in the WHERE clause of every statement in
    // src/lib/notifications/history.ts, not in a guard a caller has to remember.
    // A notification carries another student's scores and penalty text, so this is
    // the assertion that matters most on this page.
    const classmateSubject = `${E2E_KEY_PREFIX}other-student`;
    await withDb(async (sql) => {
      const other = await sql(
        `select id from users where email <> $1 and role = 'student' limit 1`,
        [DEMO.student.email],
      );
      if (other.rows.length === 0) return;
      await sql(
        `insert into notifications (user_id, type, dedupe_key, recipient_email, subject, body, status)
         values ($1, 'quiz_submitted', $2, 'classmate@codequeenshub.test', $3, 'private', 'sent')
         on conflict (dedupe_key) do nothing`,
        [Number(other.rows[0].id), classmateSubject, classmateSubject],
      );
    });

    await page.reload();
    await expect(page.getByText(classmateSubject)).toHaveCount(0);
  });
});

test.describe("email preferences", () => {
  test("renders every switch, with the digest ones labelled as not yet active", async ({ page }) => {
    await expect(page.getByTestId("notification-preferences")).toBeVisible();
    await expect(page.getByTestId("preference-quizSubmitted")).toBeChecked();
    await expect(page.getByTestId("preference-penaltyIssued")).toBeChecked();
    // A switch that looks live and does nothing is worse than an honest one.
    await expect(page.getByTestId("notification-preferences")).toContainText(
      "digests are not implemented",
    );
  });

  test("an opt-out survives a reload and reaches the database", async ({ page }) => {
    await page.getByTestId("preference-quizSubmitted").uncheck();
    await page.getByTestId("save-preferences").click();

    await expect(page.getByTestId("preferences-saved")).toBeVisible();
    await expect(page.getByTestId("preference-quizSubmitted")).not.toBeChecked();

    await page.goto("/notifications");
    await expect(page.getByTestId("preference-quizSubmitted")).not.toBeChecked();
    await expect(page.getByTestId("preference-examCompleted")).toBeChecked();

    // Asserted in the DATABASE as well as in the DOM: the row is what the producers
    // read, and a page that renders its own form state correctly while writing
    // nothing would pass a DOM-only test.
    const stored = await withDb(async (sql) => {
      const result = await sql(
        `select p.quiz_submitted, p.exam_completed
           from notification_preferences p
           join users u on u.id = p.user_id
          where u.email = $1`,
        [DEMO.student.email],
      );
      return result.rows[0];
    });
    expect(stored?.quiz_submitted).toBe(false);
    expect(stored?.exam_completed).toBe(true);
  });
});

test.describe("access", () => {
  test("an anonymous visitor is sent to the login page", async ({ browser }) => {
    // A fresh context, so it carries no session cookie from the shared fixture.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto("/notifications");
      // `requireUser()` in the page redirects even if src/middleware.ts has no
      // /notifications prefix yet (that line is the coordinator's — see the page's
      // header). This assertion is what makes the page safe to ship before it lands.
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await context.close();
    }
  });
});
