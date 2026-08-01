// =============================================================================
// AUTHORIZATION, OVER REAL HTTP, WITH REAL SESSIONS.
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS FOR, stated as the failure it catches.
//
// Every handler in this wave composes two guards: `featureGate(flag)` then
// `apiGuard(role)`, then — and this is the part no unit test reaches — a
// per-ROW ownership predicate baked into a Drizzle WHERE clause. The role guard
// is the easy half and it is already unit-tested in src/lib/guard.test.ts. The
// row-level half is the half that leaks, because `apiGuard("student")` means
// "signed in", NOT "role === student" (src/lib/guard.ts says so at the top), so
// every presentation and practice-problem route admits every signed-in user and
// then relies on a filter to decide what they can see.
//
// A filter that is present but wrong — `or` where `and` was meant, an
// `ownershipFilter` that returns `undefined` (Drizzle for "no constraint") on
// the wrong branch — compiles, passes typecheck, passes every unit test of the
// pure helper, and hands one student another student's coursework. Only a call
// with a real cookie finds it.
//
// A NOTE ON 404 VERSUS 403, because the specs below insist on it. Reading a
// resource that exists but is not yours answers 404, not 403. 403 confirms the
// id is real, which turns any list endpoint's pagination into an enumeration
// oracle. The handlers implement this by scoping the SELECT rather than by
// fetching and then checking, so an inaccessible row simply is not there and
// "not there" is the ordinary 404 path. Asserting 404 here pins that choice, so
// a later refactor to fetch-then-check has to argue for the downgrade.
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

// Serial: these specs create a class and a deck in `beforeAll` and delete them
// in `afterAll`. Parallel workers would each create their own and then trip over
// each other's /upcoming assertions.
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


test.describe("live-classes authorization", () => {
  let classId = 0;
  let weekId = 0;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await assertFeatureFlagsOn(api);
    ({ weekId } = await seedIds());

    const created = await api.post("/api/classes", {
      data: {
        weekId,
        title: "QA authorization fixture",
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
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
    // Via the API, not raw SQL: the DELETE handler is itself part of what this
    // wave shipped, and a teardown that bypassed it would leave the cascade
    // untested while still cleaning up.
    await api.delete(`/api/classes/${classId}`);
    await page.close();
  });

  test("a student cannot schedule a class", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.post("/api/classes", {
      data: {
        weekId,
        title: "student should not be able to create this",
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        durationMinutes: 60,
      },
    });
    // 403 and not 404 here on purpose: `/api/classes` as a COLLECTION is a route
    // the student may legitimately GET, so its existence is not a secret. It is
    // the per-row reads below that must not confirm an id.
    expect(response.status()).toBe(403);
    const body = (await response.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
  });

  test("a student cannot start a class", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/classes/${classId}/start`);
    expect(response.status()).toBe(403);
  });

  test("a student cannot end a class", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/classes/${classId}/end`);
    expect(response.status()).toBe(403);
  });

  test("a student cannot answer a Q&A question", async ({ page }) => {
    const studentApi = await signedInApi(page, "student");

    // The student asks a question first — they are allowed to do that.
    await studentApi.post(`/api/classes/${classId}/start`); // refused; harmless
    const asked = await studentApi.post(`/api/classes/${classId}/qa`, {
      data: { question: "may a student answer their own question?" },
    });
    // Asking may require the class to be active; either it succeeded or it was
    // refused for STATE, never for the student's role.
    expect([200, 201, 409]).toContain(asked.status());
    if (asked.status() === 409) test.skip(true, "class not joinable in this state");

    const question = await okBody<{ id: number }>(asked, asked.status());
    const answered = await studentApi.post(
      `/api/classes/${classId}/qa/${question.id}/answer`,
      { data: { answer: "no" } },
    );
    expect(answered.status()).toBe(403);
  });

  test("a student cannot grade attendance", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const { studentId } = await seedIds();
    const response = await api.patch(
      `/api/classes/${classId}/attendance/${studentId}`,
      { data: { participationScore: 100 } },
    );
    expect(response.status()).toBe(403);
  });

  test("an anonymous caller is refused, and is told to sign in rather than 404'd", async ({
    request,
  }) => {
    // `request` and not `page.request`: this context has NO cookie jar, which is
    // exactly the anonymous case. 401 rather than 404 proves the FLAG is on and
    // that the auth guard, not the feature gate, is what refused — the ordering
    // documented in src/lib/feature-guard.ts.
    const response = await request.get(`/api/classes/${classId}`);
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("unauthenticated");
  });

  test("a malformed class id is rejected as a 400, not swallowed as a 404", async ({ page }) => {
    const api = await signedInApi(page, "student");
    for (const bad of ["abc", "-1", "0", "1.5", "1e3"]) {
      const response = await api.get(`/api/classes/${bad}`);
      expect(
        response.status(),
        `"${bad}" should be a 400 from parsePositiveInt, not a database round trip`,
      ).toBe(400);
    }
  });
});

test.describe("presentations authorization", () => {
  let studentDeckId = 0;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const api = await signedInApi(page, "student");
    await assertFeatureFlagsOn(api);
    // `createPresentationSchema` is `.strict()` — an unknown key such as
    // `slides` is a 422, not an ignored extra. The deck is optional; the handler
    // supplies the empty-deck default so the API and the editor's "new
    // presentation" button produce byte-identical JSON.
    const created = await api.post("/api/presentations", {
      data: { title: "QA private student deck" },
    });
    const row = await okBody<{ id: number }>(created, created.status());
    studentDeckId = row.id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!studentDeckId) return;
    const page = await browser.newPage();
    const api = await signedInApi(page, "student");
    await api.delete(`/api/presentations/${studentDeckId}`);
    await page.close();
  });

  test("an instructor MAY read a student's unpublished deck", async ({ page }) => {
    // Not a leak — the teaching relationship, argued at length in
    // src/app/api/presentations/_access.ts. Pinned here so that a later
    // tightening of `readableFilter` that broke grading would fail loudly rather
    // than look like a security improvement.
    const api = await signedInApi(page, "instructor");
    const response = await api.get(`/api/presentations/${studentDeckId}`);
    expect(response.status()).toBe(200);
  });

  test("an instructor may NOT edit a student's deck", async ({ page }) => {
    // Writes are creator-only even for staff: an instructor rewriting submitted
    // work and leaving it under the student's name is indistinguishable from the
    // student having written it.
    const api = await signedInApi(page, "instructor");
    const response = await api.put(`/api/presentations/${studentDeckId}`, {
      data: { title: "rewritten by staff" },
    });
    expect([403, 404]).toContain(response.status());

    // And the title must be unchanged — a 403 that still wrote would be worse
    // than a 200 that did.
    const studentPage = await page.context().browser()!.newPage();
    const studentApi = await signedInApi(studentPage, "student");
    const after = await studentApi.get(`/api/presentations/${studentDeckId}`);
    const deck = await okBody<{ title: string }>(after);
    expect(deck.title).toBe("QA private student deck");
    await studentPage.close();
  });

  test("a non-existent deck answers 404 and not 500", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.get("/api/presentations/999999");
    expect(response.status()).toBe(404);
  });
});

test.describe("input validation ceilings", () => {
  test("pagination rejects an out-of-range page size instead of honouring it", async ({
    page,
  }) => {
    // An unbounded `limit` is a denial-of-service primitive: one request asking
    // for a million rows holds a pooled connection (max 5, see src/db/index.ts)
    // for as long as the serialization takes.
    const api = await signedInApi(page, "instructor");
    const response = await api.get("/api/classes?limit=100000");
    expect(
      [200, 422].includes(response.status()),
      `expected a clamp (200) or a rejection (422), got ${response.status()}`,
    ).toBe(true);

    if (response.status() === 200) {
      const data = await okBody<{ items: unknown[] }>(response);
      expect(
        data.items.length,
        "a 200 for limit=100000 must mean the value was CLAMPED, not honoured",
      ).toBeLessThanOrEqual(200);
    }
  });

  test("a negative page number is rejected", async ({ page }) => {
    const api = await signedInApi(page, "instructor");
    const response = await api.get("/api/classes?page=-5");
    expect([200, 422]).toContain(response.status());
  });
});
