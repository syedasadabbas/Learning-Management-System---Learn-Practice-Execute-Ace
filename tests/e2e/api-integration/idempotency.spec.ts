// =============================================================================
// IDEMPOTENCY, AND THE CONCURRENT CASE IN PARTICULAR.
// -----------------------------------------------------------------------------
// The API stream REASONED these endpoints idempotent and wrote the reasoning
// into each handler header — /start carries `status = 'scheduled'` in its WHERE
// clause, /join upserts on a unique index, /upvote relies on a composite primary
// key with ON CONFLICT DO NOTHING. The reasoning is sound. It had never been
// RUN, and least of all run twice at the same instant.
//
// WHY THE CONCURRENT CASE IS THE ONE THAT MATTERS. Sequential double-submit is
// the easy half and any read-then-write handler passes it, because the first
// call has committed by the time the second reads. The failure these guards
// exist to prevent is two requests INTERLEAVING — the instructor's flaky
// connection retrying while the first attempt is still in flight, two browser
// tabs, a double-tap on a phone. That is the case where a read-then-write
// handler sees "not yet started" twice and mints two Jitsi rooms, stranding
// every student who joined the first.
//
// So each spec below fires the duplicate calls with `Promise.all` and asserts on
// the DURABLE consequence — one room name, one attendance row, one vote — not
// merely on both responses being 200. Two 200s is what the bug looks like.
// =============================================================================

import { expect, test } from "@playwright/test";

import {
  assertFeatureFlagsOn,
  NO_TEST_DB_REASON,
  okBody,
  seedIds,
  signedInApi,
  TEST_DB_URL,
} from "./fixtures";

test.skip(!TEST_DB_URL, NO_TEST_DB_REASON);
test.describe.configure({ mode: "serial" });

// A LARGER BUDGET THAN THE 30 s DEFAULT, for compilation and not for slowness.
// Against `next dev` every route compiles on FIRST request, and the routes this
// file touches are newer than tests/e2e/global-setup.ts's warm-up list, so the
// first spec to reach one pays webpack out of its own budget. Run on its own,
// this file passes at the default; run first in a larger selection it timed out
// in `beforeAll` with "Timeout of 30000ms exceeded" while the server log showed
// a route still compiling. Raised HERE rather than in playwright.config.ts so
// the 30 s default — a useful signal everywhere else — stays intact. Same
// reasoning, same number, as tests/e2e/live-classes/class-workflow.spec.ts.
test.setTimeout(90_000);


test.describe("live-class lifecycle is idempotent", () => {
  let classId = 0;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await assertFeatureFlagsOn(api);
    const { weekId } = await seedIds();
    const created = await api.post("/api/classes", {
      data: {
        weekId,
        title: "QA idempotency fixture",
        scheduledAt: new Date(Date.now() + 600_000).toISOString(),
        durationMinutes: 60,
      },
    });
    const row = await okBody<{ id: number }>(created, 201);
    classId = row.id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!classId) return;
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await api.delete(`/api/classes/${classId}`);
    await page.close();
  });

  test("two CONCURRENT /start calls mint exactly one room and one start time", async ({
    page,
  }) => {
    const api = await signedInApi(page, "instructor");

    const [a, b] = await Promise.all([
      api.post(`/api/classes/${classId}/start`),
      api.post(`/api/classes/${classId}/start`),
    ]);

    // Both succeed: the caller asked for the class to be running, and after
    // either call it is. An error on the retry would be a worse answer.
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);

    const first = await okBody<{
      jitsiRoomName: string | null;
      startedAt: string | null;
      alreadyStarted: boolean;
    }>(a);
    const second = await okBody<typeof first>(b);

    // THE ASSERTION THAT MATTERS. A second room name means students who joined
    // the first are in an empty conference the instructor is not in.
    expect(
      second.jitsiRoomName,
      "the two calls disagreed about the room — /start minted a second Jitsi conference",
    ).toBe(first.jitsiRoomName);

    // And the start time must not have been restamped: every attendance
    // duration in the class is computed from it.
    expect(second.startedAt).toBe(first.startedAt);

    // Exactly one of the two may claim to be the first.
    expect(
      [first.alreadyStarted, second.alreadyStarted].filter((v) => v === false).length,
      "exactly one call should report alreadyStarted: false",
    ).toBe(1);
  });

  test("a THIRD sequential /start is still a 200 with the same room", async ({ page }) => {
    const api = await signedInApi(page, "instructor");
    const response = await api.post(`/api/classes/${classId}/start`);
    expect(response.status()).toBe(200);
    const data = await okBody<{ alreadyStarted: boolean }>(response);
    expect(data.alreadyStarted).toBe(true);
  });

  test("two CONCURRENT /join calls produce ONE attendance row", async ({ page }) => {
    // The durable guard is the unique index
    // `class_attendance_class_student_idx`, proved to fire in
    // tests/integration/db/constraints.test.ts. This is the other half: that the
    // handler USES it (upsert) rather than reading first and inserting.
    const api = await signedInApi(page, "student");

    const results = await Promise.all([
      api.get(`/api/classes/${classId}/join`),
      api.get(`/api/classes/${classId}/join`),
    ]);
    for (const response of results) {
      expect(
        [200, 409].includes(response.status()),
        `join returned ${response.status()}; a 500 here means the unique index surfaced as a crash ` +
          `instead of being absorbed by an upsert`,
      ).toBe(true);
    }
    if (results.some((r) => r.status() === 409)) {
      test.skip(true, "class not in a joinable state");
    }

    const instructorPage = await page.context().browser()!.newPage();
    const instructorApi = await signedInApi(instructorPage, "instructor");
    const roster = await instructorApi.get(`/api/classes/${classId}/attendance`);
    const data = await okBody<{ items: Array<{ studentId: number }> } | Array<{ studentId: number }>>(
      roster,
    );
    const items = Array.isArray(data) ? data : data.items;
    const { studentId } = await seedIds();
    const mine = items.filter((r) => r.studentId === studentId);
    expect(
      mine.length,
      "two joins produced two attendance rows — the roster now double-counts every reconnect",
    ).toBe(1);
    await instructorPage.close();
  });

  test("two CONCURRENT /end calls do not produce a second, shorter class", async ({ page }) => {
    const api = await signedInApi(page, "instructor");
    const [a, b] = await Promise.all([
      api.post(`/api/classes/${classId}/end`),
      api.post(`/api/classes/${classId}/end`),
    ]);
    for (const response of [a, b]) {
      expect([200, 409]).toContain(response.status());
    }
    // At least one must have succeeded, and the class must be ended afterwards.
    const after = await api.get(`/api/classes/${classId}`);
    const cls = await okBody<{ status: string; endedAt: string | null }>(after);
    expect(cls.status).toBe("ended");
    expect(cls.endedAt).not.toBeNull();
  });
});

test.describe("Q&A upvoting is idempotent per user", () => {
  // REGRESSION GUARD. Before migration 0007, `class_qa` had an `upvotes` integer
  // and nothing recorded WHO had voted, so a student could hold the button down
  // and climb the queue the instructor triages by. `class_qa_votes` closed it.
  // The database half of the fix is proved in
  // tests/integration/db/constraints.test.ts; this is the HTTP half.
  let classId = 0;
  let questionId = 0;

  test.beforeAll(async ({ browser }) => {
    const instructorPage = await browser.newPage();
    const instructorApi = await signedInApi(instructorPage, "instructor");
    await assertFeatureFlagsOn(instructorApi);
    const { weekId } = await seedIds();

    const created = await instructorApi.post("/api/classes", {
      data: {
        weekId,
        title: "QA upvote fixture",
        scheduledAt: new Date(Date.now() + 600_000).toISOString(),
        durationMinutes: 60,
      },
    });
    classId = (await okBody<{ id: number }>(created, 201)).id;
    await instructorApi.post(`/api/classes/${classId}/start`);

    // The INSTRUCTOR asks the question, so that the student upvoting it is not
    // upvoting their own — which is refused for a different reason (403) and
    // would mask the idempotency result entirely.
    const asked = await instructorApi.post(`/api/classes/${classId}/qa`, {
      data: { question: "does the second upvote count?" },
    });
    if (asked.status() >= 400) {
      test.skip(true, `could not seed a question: ${asked.status()} ${await asked.text()}`);
    }
    questionId = (await okBody<{ id: number }>(asked, asked.status())).id;
    await instructorPage.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!classId) return;
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await api.post(`/api/classes/${classId}/end`);
    await api.delete(`/api/classes/${classId}`);
    await page.close();
  });

  test("two CONCURRENT upvotes by one student count as ONE", async ({ page }) => {
    const api = await signedInApi(page, "student");

    const [a, b] = await Promise.all([
      api.post(`/api/classes/${classId}/qa/${questionId}/upvote`),
      api.post(`/api/classes/${classId}/qa/${questionId}/upvote`),
    ]);
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);

    const first = await okBody<{ upvotes: number; counted: boolean }>(a);
    const second = await okBody<typeof first>(b);

    // Exactly one call may report `counted: true`.
    expect(
      [first.counted, second.counted].filter(Boolean).length,
      "both concurrent upvotes claimed to have counted — the ledger did not deduplicate",
    ).toBe(1);

    // And the DURABLE total, read back fresh, must be 1.
    const third = await api.post(`/api/classes/${classId}/qa/${questionId}/upvote`);
    const settled = await okBody<{ upvotes: number; counted: boolean }>(third);
    expect(settled.counted).toBe(false);
    expect(
      settled.upvotes,
      "the displayed counter drifted above the number of distinct voters",
    ).toBe(1);
  });

  test("a student may not upvote their own question", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const asked = await api.post(`/api/classes/${classId}/qa`, {
      data: { question: "my own question" },
    });
    if (asked.status() >= 400) test.skip(true, "could not ask");
    const mine = await okBody<{ id: number }>(asked, asked.status());
    const response = await api.post(`/api/classes/${classId}/qa/${mine.id}/upvote`);
    expect(response.status()).toBe(403);
  });

  test("a question id from ANOTHER class is not votable through this class's URL", async ({
    page,
  }) => {
    // Cross-resource confusion: the handler locates the row by (id, class_id),
    // so a valid question id under the wrong class must be 404 rather than a
    // successful vote recorded against a class the caller never joined.
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/classes/999999/qa/${questionId}/upvote`);
    expect(response.status()).toBe(404);
  });
});
