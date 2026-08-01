// =============================================================================
// SHARED HELPERS FOR THE API INTEGRATION SPECS.
// -----------------------------------------------------------------------------
// These specs exercise the route handlers over REAL HTTP with a REAL session
// cookie. Before this directory existed, no route in the live-classes,
// presentations or learning-enhancement wave had ever been called that way:
// the streams verified their handlers by compiling them and by unit-testing the
// pure helpers underneath (src/lib/live-classes/access.test.ts,
// src/app/api/presentations/_access.test.ts). Both are worth having and neither
// proves that the wiring in between — the guard order, the param parsing, the
// Drizzle projection, the response envelope — behaves when a browser calls it.
//
// TWO PRECONDITIONS, both of which will otherwise produce FALSE PASSES.
//
// 1. THE FEATURE FLAGS MUST BE ON. src/lib/features.ts defaults all three to
//    false, and src/lib/feature-guard.ts turns a disabled feature into a 404
//    that is deliberately indistinguishable from an unrouted path. A run with
//    the flags unset therefore gets a 404 from every endpoint here, and a spec
//    that asserted "a student may not do X" would pass gloriously against a
//    feature that was not running. `assertFeatureFlagsOn` below fails the run
//    loudly instead. The server under test needs all six:
//
//      LIVE_CLASSES_ENABLED, PRESENTATIONS_ENABLED, LEARNING_ENHANCEMENTS_ENABLED
//      and the three NEXT_PUBLIC_ twins.
//
// 2. SESSIONS COME FROM THE REAL LOGIN FORM. `loginAs` drives the form, and
//    `page.request` shares the browser context's cookie jar, so every call made
//    through it carries the same session the UI would. Injecting a forged cookie
//    would test the handlers against a session shape Auth.js does not actually
//    mint.
//
// EVERY FIXTURE THIS FILE CREATES IS DELETED BY THE SPEC THAT CREATED IT, via
// the API, in an `afterAll`. The suite runs against a shared mutable database
// (see the long note in tests/e2e/fixtures.ts on order dependence), and a
// live class left behind by a crashed run is a row the /upcoming assertions of
// the NEXT run will read.
// =============================================================================

import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { DEMO, DEMO_PASSWORD, type DemoRole } from "../fixtures";

/** The frozen success envelope from src/lib/contracts/api.ts. */
export interface ApiOkBody<T> {
  ok: true;
  data: T;
}

/** The frozen failure envelope. */
export interface ApiErrBody {
  ok: false;
  error: string;
  code?: string;
}

/**
 * Log in and hand back a request context that carries the session.
 *
 * Returns `page.request` rather than a standalone `request` fixture precisely
 * because the standalone one has an EMPTY cookie jar: calls made through it are
 * anonymous, every assertion becomes "401", and a spec checking that a student
 * is refused would pass for entirely the wrong reason. This is the single
 * easiest way to write a worthless authorization test, so the helper exists to
 * make the right thing the short thing.
 */
export async function signedInApi(page: Page, role: DemoRole): Promise<APIRequestContext> {
  const user = DEMO[role];
  await page.goto("/login");
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  return page.request;
}

/**
 * Fail the run if the server under test has the feature flags off.
 *
 * Distinguishes the two 404s that matter: `/api/classes` answers 401 when the
 * flag is ON and the caller is anonymous (auth runs second), and 404 when the
 * flag is OFF (the gate runs first and never reaches auth). That ordering is
 * itself a documented property of src/lib/feature-guard.ts, so this check
 * doubles as an assertion on it.
 */
export async function assertFeatureFlagsOn(request: APIRequestContext): Promise<void> {
  const probes: Array<{ url: string; flag: string }> = [
    { url: "/api/classes", flag: "LIVE_CLASSES_ENABLED" },
    { url: "/api/presentations", flag: "PRESENTATIONS_ENABLED" },
    { url: "/api/interview-questions", flag: "LEARNING_ENHANCEMENTS_ENABLED" },
  ];

  for (const probe of probes) {
    const response = await request.get(probe.url);
    expect(
      response.status(),
      `${probe.url} answered ${response.status()}. A 404 here means ${probe.flag} is not "true" ` +
        `on the server under test, so every spec in tests/e2e/api-integration would be ` +
        `asserting against a disabled feature. Set ${probe.flag} and NEXT_PUBLIC_${probe.flag} ` +
        `before starting the server.`,
    ).not.toBe(404);
  }
}

/** Read a success envelope, asserting the status and the `ok: true` shape. */
export async function okBody<T>(
  response: { status(): number; json(): Promise<unknown>; text(): Promise<string> },
  expectedStatus = 200,
): Promise<T> {
  const raw = await response.text();
  expect(response.status(), `unexpected status; body was ${raw}`).toBe(expectedStatus);
  const parsed = JSON.parse(raw) as ApiOkBody<T>;
  expect(parsed.ok).toBe(true);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Reading fixture ids out of the database
// ---------------------------------------------------------------------------
// There is no `GET /api/weeks` collection route — only `/api/weeks/:weekId/...`
// — so a spec that needs a week id to hang a live class off cannot discover one
// over HTTP. It reads it from the database instead.
//
// THROUGH `TEST_DATABASE_URL`, NEVER `DATABASE_URL`. The latter points at the
// shared Neon database the team develops against, and these specs CREATE and
// DELETE live classes, presentations and practice problems. Pointing them at
// the shared database would leave real rows in a real cohort's timetable. The
// separate variable makes opting a database into this suite a deliberate act —
// the same reasoning, and the same shape of answer, as
// services/realtime/src/store/contract.test.ts and
// tests/integration/db/constraints.test.ts.
//
// Point it at the SAME database the server under test is using, or the ids read
// here will not exist over there:
//
//   createdb lms_qa
//   for f in src/db/migrations/0*.sql; do psql -d lms_qa -f "$f"; done
//   DATABASE_URL=…/lms_qa npm run db:seed
//   DATABASE_URL=…/lms_qa <six feature flags> npm run dev
//   TEST_DATABASE_URL=…/lms_qa E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/api-integration

/** Set when a throwaway database has been opted in. Undefined disables this suite. */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL;

/**
 * Why this whole directory is skipped, phrased for the run summary.
 *
 * Exported as a string so each spec can pass it to `test.skip(...)` and a run
 * that did not exercise the API says WHY, rather than quietly reporting fewer
 * tests. A silently-absent suite is how a module comes to have no coverage.
 */
export const NO_TEST_DB_REASON =
  "SKIPPED: TEST_DATABASE_URL is not set. These specs create and delete rows, so they " +
  "refuse to run against the shared DATABASE_URL. See the header of " +
  "tests/e2e/api-integration/fixtures.ts for the four commands that provision a scratch database.";

interface SeedIds {
  weekId: number;
  lectureId: number;
  assignmentId: number;
  studentId: number;
  instructorId: number;
}

/**
 * The seeded ids the API specs build on, read once per file.
 *
 * `pg` is imported lazily so that a checkout without TEST_DATABASE_URL — where
 * every spec is skipped anyway — does not pay for the driver at collection time.
 */
export async function seedIds(): Promise<SeedIds> {
  if (!TEST_DB_URL) throw new Error(NO_TEST_DB_REASON);
  const { Client } = await import("pg");
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    const one = async (sql: string): Promise<number> => {
      const { rows } = await client.query<{ id: number }>(sql);
      expect(rows.length, `no row for: ${sql} — did you run npm run db:seed?`).toBeGreaterThan(0);
      return rows[0].id;
    };
    return {
      weekId: await one(`SELECT id FROM weeks ORDER BY week_number LIMIT 1`),
      lectureId: await one(`SELECT id FROM lectures ORDER BY id LIMIT 1`),
      assignmentId: await one(`SELECT id FROM assignments ORDER BY id LIMIT 1`),
      studentId: await one(
        `SELECT id FROM users WHERE email = '${DEMO.student.email}' LIMIT 1`,
      ),
      instructorId: await one(
        `SELECT id FROM users WHERE email = '${DEMO.instructor.email}' LIMIT 1`,
      ),
    };
  } finally {
    await client.end();
  }
}
