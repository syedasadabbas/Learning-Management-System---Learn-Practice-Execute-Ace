// =============================================================================
// SHARED E2E FIXTURES — owned by the devops-testing stream.
// -----------------------------------------------------------------------------
// Every stream's e2e specs import from here rather than hardcoding credentials
// or selectors, so a change to the login flow updates one file, not twelve.
//
// These values must match scripts/seed.ts. If the seed changes, change this too.
// =============================================================================

import { expect, type Page } from "@playwright/test";

/** Password shared by all three seeded demo accounts. */
export const DEMO_PASSWORD = "Passw0rd!demo";

export const DEMO = {
  student: { email: "student@codequeenshub.test", name: "Demo Student" },
  instructor: { email: "instructor@codequeenshub.test", name: "Demo Instructor" },
  admin: { email: "admin@codequeenshub.test", name: "Demo Admin" },
} as const;

export type DemoRole = keyof typeof DEMO;

/**
 * The three seeded ACTIVITY accounts — classmates of the demo student, created by
 * scripts/seed-demo-activity.ts so the leaderboard has more than one row.
 *
 * Exported as addresses rather than as a domain suffix because the difference
 * matters to at least one privacy assertion: "no email appears" and "no OTHER
 * STUDENT's email appears" are different properties, and only the second one is
 * what a leaked-classmate-data regression would violate. A suffix match cannot
 * tell the viewer's own address apart from a classmate's. See the note on the
 * privacy spec in tests/e2e/leaderboard/leaderboard.spec.ts.
 */
export const SEEDED_CLASSMATES = [
  { email: "advanced@codequeenshub.test", name: "Ayesha Advanced" },
  { email: "steady@codequeenshub.test", name: "Bilal Steady" },
  { email: "struggling@codequeenshub.test", name: "Chandni Struggling" },
] as const;

/**
 * Every seeded address EXCEPT the one the given role signs in as.
 *
 * This is the list a privacy assertion should check: the page may legitimately
 * know who you are, and in `next dev` React serialises the awaited session object
 * into the RSC debug stream whether the page asked for it or not (see the spec
 * comment for the evidence). It may never know a classmate's address.
 */
export function otherSeededEmails(viewer: DemoRole): string[] {
  return [
    ...Object.entries(DEMO)
      .filter(([role]) => role !== viewer)
      .map(([, user]) => user.email),
    ...SEEDED_CLASSMATES.map((c) => c.email),
  ];
}

/** Content facts the seed guarantees. Assert against these, not magic numbers. */
export const SEEDED = {
  weekCount: 4,
  questionsPerQuiz: 10,
  totalQuestions: 40,
  passingScorePercent: 70,
  attemptsAllowed: 3,
  weekTitles: [
    "HTML5 Foundations",
    "CSS3 & Responsive Design",
    "JavaScript Fundamentals",
    "Git, Deployment & Final Project",
  ],
} as const;

/**
 * Log in through the real UI as one of the seeded demo accounts.
 *
 * Deliberately drives the actual form rather than injecting a session cookie:
 * if login breaks, every spec that depends on it should fail loudly instead of
 * passing against a forged session.
 *
 * TODO(test): the selectors below assume the auth stream ships a login form at
 * /login with name="email" / name="password" inputs and a submit button. The
 * auth stream must either match this contract or update this helper in the same
 * PR — a mismatch here breaks every downstream stream's e2e suite at once.
 */
export async function loginAs(page: Page, role: DemoRole): Promise<void> {
  const user = DEMO[role];
  await page.goto("/login");
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  // Landing anywhere other than /login means the session was established.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Assert the page is not showing a Next.js error overlay or a 500. */
export async function expectNoServerError(page: Page): Promise<void> {
  await expect(page.locator("text=Application error")).toHaveCount(0);
  await expect(page.locator("text=Internal Server Error")).toHaveCount(0);
}

// =============================================================================
// TEST ISOLATION AGAINST ONE SHARED MUTABLE DATABASE
// -----------------------------------------------------------------------------
// THE PROBLEM, stated as the failure it produces. `workers: 1` (playwright.config.ts:29)
// removes the RACE between specs but not the ORDER DEPENDENCE between them: a spec
// that reads state it did not create passes or fails according to what ran before
// it — including runs from previous days, and including hand-run scripts. Two real
// examples, both diagnosed on 2026-07-31:
//
//   1. video-ingestion's "no unreviewed candidate is presented as live" asserted
//      that every row in the review queue has status `candidate`. Nothing in the
//      suite ever created a candidate. Commit 664dbc1 harvested 77 real rows and
//      commit 46b9d4e's work approved them so lecture pages could play a video, so
//      the table held 77 approved rows and ZERO candidates, and the assertion read
//      the "Already reviewed" list instead. `Expected: "candidate", Received: "approved"`.
//   2. submissions' ingest specs write real submission rows for the demo student,
//      which the leaderboard, progress and dashboard specs read. Their cleanup was
//      skipped for want of DATABASE_URL — see the header of playwright.config.ts.
//
// THE MECHANISM, and why it is shaped this way. These are OPT-IN helpers, not a
// global beforeEach hook. A global hook that reset shared tables would be invisible
// at the point of use, would run for the ~90% of specs that are GET-only, and would
// make one stream's teardown silently destroy another stream's fixtures — which is
// precisely the failure mode being fixed. A spec that depends on state must SAY SO,
// in its own file, in a line a reviewer can see.
//
// THE CONTRACT every helper here keeps:
//   * it names the rows it touches narrowly enough that no other stream's
//     assertions can be affected;
//   * it is idempotent, so a spec that crashed mid-run does not poison the next;
//   * it FAILS LOUDLY when DATABASE_URL is missing rather than no-op'ing, because a
//     silent no-op is what let problem 2 above run undetected for days. dotenv is
//     loaded in playwright.config.ts, so an absent variable now means a genuinely
//     unconfigured checkout, and a spec that needs the database cannot be trusted on
//     one anyway.
// =============================================================================

/**
 * The ordered list of commands that must be run against the shared database
 * before a full-suite run, and what each one establishes.
 *
 * Exported as data rather than left in prose so a spec can quote the exact command
 * in its own skip/failure message. A missing precondition must read as "you did not
 * seed", never as "the feature is broken".
 */
export const SUITE_PRECONDITIONS = [
  {
    when: "before",
    command: "npm run db:seed",
    establishes:
      "users, one cohort, 4 weeks, quizzes, assignments, 12 lectures WITH topic_key set, " +
      "assignment form/sheet URLs pointed at the local stand-in, and — via " +
      "scripts/seed-demo-activity.ts, which seed.ts calls — the three classmate accounts " +
      "(advanced / steady / struggling) plus their leaderboard rows. Without the classmates " +
      "the leaderboard ordering specs degrade to skips.",
  },
  {
    when: "before",
    command: "npx tsx scripts/seed-course-access.ts",
    establishes:
      "the two extra courses the access-request specs ask for (the base seed is " +
      "single-course, so without them there is nothing to request) and clears their " +
      "request rows so the pending -> decided transitions actually occur. NOT called by " +
      "db:seed; it must be run separately. See tests/e2e/courses/access-requests.spec.ts:7.",
  },
  {
    when: "before",
    command: "npx tsx scripts/seed-prerequisites.ts",
    establishes:
      "the prerequisite rules the prerequisites specs assert against. MUST run AFTER " +
      "seed-course-access.ts, not before: a rule is an edge between two courses and the " +
      "extra courses do not exist until that script has run, so ordering this earlier " +
      "seeds edges to nothing. Requested by the prerequisites stream, which could not " +
      "add it here because this file belongs to devops-testing. Note the rules apply at " +
      "READ time, so seeding them gates the seeded students immediately — the ACTIVE " +
      "course (lowest id) stays open regardless, which is the compatibility rule " +
      "src/lib/courses/store.ts#isOpenCourse exists to protect.",
  },
  {
    when: "before",
    command: "npm run db:seed:addons",
    establishes:
      "exam, coding-problem and interactive-learning content for the grand-quiz, " +
      "coding-problems and interactive-learning specs",
  },
  {
    when: "before",
    command: "npx tsx scripts/reset-e2e-state.ts",
    establishes:
      "a database with no residue from a PREVIOUS run: no 'e2e' topic_videos fixture " +
      "rows, no ingestion-derived submissions for the demo student, and none of the " +
      "throwaway accounts the registration specs create and never delete. Idempotent; " +
      "reports what it removed. See that script's header for what it deliberately leaves alone.",
  },
  {
    when: "before",
    command: "npm run db:smoke",
    establishes:
      "nothing — it VERIFIES, read-only, that every stream's real SQL runs and that the " +
      "seed took. A failure here is far cheaper to read than the same failure as a 500 in " +
      "a browser trace three layers up.",
  },
  {
    when: "midway",
    command: "npx tsx scripts/reset-demo-student.ts",
    establishes:
      "the demo student at ZERO activity — no quiz attempts, no progress rows, no " +
      "submissions, no leaderboard row. This one is NOT a pre-step: it must run BETWEEN " +
      "the course-content specs (which assert weeks 2-4 are locked, true only while no " +
      "passing week-1 attempt exists) and the quizzes specs (which deliberately consume " +
      "all three week-1 attempts and unlock week 2). Whichever of those two runs second " +
      "fails on state the first one legitimately created. See that script's header.",
  },
] as const;

/**
 * One-line hint for a failure message, listing the SETUP commands in order.
 *
 * Excludes the midway step: quoting reset-demo-student.ts in a "you did not seed"
 * message would tell a reader to run it at the wrong moment, and running it at the
 * wrong moment is itself one of the failures this file exists to prevent.
 */
export const SEED_HINT = SUITE_PRECONDITIONS.filter((p) => p.when === "before")
  .map((p) => p.command)
  .join(" && ");

/**
 * Run `fn` against the shared database on a single short-lived connection.
 *
 * Uses a bare `pg.Client` rather than importing `@/db`: that module builds a
 * long-lived pre-warmed Pool (see its POOL TUNING block) which is correct for a
 * server process and wrong for a test that wants to open a connection, write two
 * rows and leave nothing behind. It is also imported for its side effects, and a
 * pool held open by the test process outlives the spec.
 *
 * `finally { end() }` rather than `end()` on the happy path only: a throwing spec
 * that leaks a connection eventually exhausts the Neon pooler, and the symptom is a
 * timeout in an unrelated file much later.
 */
export async function withDb<T>(fn: (sql: SqlRunner) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set in the test process. playwright.config.ts imports " +
        "dotenv/config, so this means .env is missing or has no DATABASE_URL. " +
        `Configure it, then: ${SEED_HINT}`,
    );
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // `params` is spread conditionally rather than passed as `undefined`: pg's
    // overload set resolves a second argument of `undefined` against the CALLBACK
    // signature, not the values array, so `client.query(text, undefined)` is a type
    // error and — worse — would be a callback-style call at runtime if it compiled.
    return await fn((text, params) =>
      params === undefined
        ? client.query(text)
        : client.query(text, params as unknown[]),
    );
  } finally {
    await client.end();
  }
}

/**
 * Minimal query shape, so helpers do not depend on the `pg` types at call sites.
 *
 * Rows are `unknown[]`, not `any[]`: a helper reading `rows[0].n` should have to say
 * what it expects (`Number(result.rows[0].n)` casts at the point of use), rather than
 * inheriting `any` and silently accepting a column name that does not exist. That is
 * the failure mode scripts/smoke-db.ts:33-39 was written about.
 */
export type SqlRunner = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

// ---------------------------------------------------------------------------
// topic_videos — the review-queue precondition
// ---------------------------------------------------------------------------

export interface VideoCandidateFixture {
  id: number;
  topicKey: string;
  youtubeId: string;
  /** Delete the row. Idempotent, so calling it twice is safe. */
  remove: () => Promise<void>;
}

/**
 * Insert one `topic_videos` row with status `candidate` and return a handle to it.
 *
 * WHY A SPEC CREATES THIS ITSELF. The review queue's central property — an
 * unreviewed candidate is never presented as live — can only be tested when an
 * unreviewed candidate exists, and no seeder makes one: scripts/harvest-videos.ts
 * needs a live oEmbed call to youtube.com, which this suite must not depend on
 * (tests/e2e/video-ingestion/video-review.spec.ts:17-20 records that constraint).
 * The row is inserted directly for exactly that reason, and it is the ONE row the
 * spec is allowed to assert the status of, because it is the one row the spec owns.
 *
 * THE TOPIC KEY AND ID ARE UNIQUE PER CALL. `topic_videos` has a unique index on
 * (topic_key, youtube_id) (src/db/schema.ts:554), so a fixed pair would collide
 * with a leftover row from a crashed run and the insert would fail rather than the
 * assertion. A per-call suffix also guarantees the key matches NO lecture, so the
 * row cannot make a video appear on a student page and cannot perturb the
 * course-content specs that assert a lecture PLAYS an approved video (commit 46b9d4e).
 *
 * `source = 'e2e'` marks it as test-created for anyone reading the table by hand.
 */
export async function createVideoCandidate(): Promise<VideoCandidateFixture> {
  // 11 characters, the real YouTube id length, so the admin screen's thumbnail URL
  // and "Watch on YouTube" link are shaped exactly as they are in production. The
  // id resolves to nothing, which is fine: the review screen renders metadata from
  // the row and never calls YouTube itself.
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const youtubeId = `e2e${suffix}`;
  const topicKey = `e2e-review-${suffix}`;

  const id = await withDb(async (sql) => {
    const inserted = await sql(
      `INSERT INTO topic_videos
         (topic_key, youtube_id, title, channel_title, duration_seconds, status, source, order_index)
       VALUES ($1, $2, $3, $4, $5, 'candidate', 'e2e', 0)
       RETURNING id`,
      [
        topicKey,
        youtubeId,
        "E2E fixture candidate — awaiting review",
        "E2E Fixture Channel",
        // SECONDS (SI, per house rules). A real number rather than NULL so the row
        // exercises the formatted-duration branch instead of "Duration unknown".
        372,
      ],
    );
    return Number(inserted.rows[0].id);
  });

  return {
    id,
    topicKey,
    youtubeId,
    remove: async () => {
      await withDb(async (sql) => {
        await sql("DELETE FROM topic_videos WHERE id = $1", [id]);
      });
    },
  };
}

/**
 * Delete every candidate row this suite created, whatever run created it.
 *
 * Safety net for the crashed-run case: `remove()` in an `afterAll` does not run if
 * the process was killed. Scoped to `source = 'e2e'`, so the 77 harvested curated
 * rows and every review decision made against them are untouched.
 */
export async function clearE2EVideoCandidates(): Promise<void> {
  await withDb(async (sql) => {
    await sql("DELETE FROM topic_videos WHERE source = 'e2e'");
  });
}

// ---------------------------------------------------------------------------
// submissions — the pollution every read-side stream trips over
// ---------------------------------------------------------------------------

/**
 * Delete the demo student's INGESTION-DERIVED submissions and nothing else.
 *
 * Promoted here from tests/e2e/submissions/submissions.spec.ts:59 because the
 * cleanup is no longer only that file's business. Assignment ingestion now really
 * writes, and it is reachable three ways: those specs, the manual sweep endpoint,
 * and a cron sweep — the last two run outside Playwright entirely and will never
 * call a spec's `afterAll`. So a spec that needs "this student has no ingested
 * submissions" must be able to establish that itself rather than hoping.
 *
 * SCOPED THREE WAYS, deliberately: the demo student, an ingestion-shaped
 * `sheet_row_ref` ('v1:' prefix), nothing else. The rows scripts/seed-demo-activity.ts
 * writes use 'seed:<email>' refs and are what the leaderboard and instructor-queue
 * specs assert against; a blanket DELETE would destroy them and the failure would
 * surface in someone else's file.
 */
export async function clearIngestedSubmissions(): Promise<void> {
  await withDb(async (sql) => {
    await sql(
      `DELETE FROM submissions
        WHERE sheet_row_ref LIKE 'v1:%'
          AND student_id = (SELECT id FROM users WHERE email = $1)`,
      [DEMO.student.email],
    );
  });
}

/**
 * How many ingestion-derived submissions the demo student currently has.
 *
 * For a spec that wants to ASSERT its precondition rather than silently assume it,
 * which is the difference between a legible failure and a confusing one.
 */
export async function countIngestedSubmissions(): Promise<number> {
  return withDb(async (sql) => {
    const result = await sql(
      `SELECT count(*)::int AS n
         FROM submissions
        WHERE sheet_row_ref LIKE 'v1:%'
          AND student_id = (SELECT id FROM users WHERE email = $1)`,
      [DEMO.student.email],
    );
    return Number(result.rows[0].n);
  });
}

// ---------------------------------------------------------------------------
// Generic save/restore, for the columns a spec must move and put back
// ---------------------------------------------------------------------------

/**
 * Read a single column, run `mutate`, and restore the original value afterwards —
 * even if `mutate` throws.
 *
 * Exists for the two known cases where a spec must move state that another stream
 * reads, and where deleting the row is not the right restore:
 *
 *   * the grading specs stamp `submissions.graded_at` even when the star rating is
 *     unchanged, which reorders the instructor queue and moves the leaderboard's
 *     `updated_at`/staleness figure for later specs;
 *   * the submissions ingest specs temporarily repoint an assignment's sheet URL at
 *     a loopback server (submissions.spec.ts group 3) and must put the seeded
 *     stand-in URL back.
 *
 * Restore is best-effort-but-loud: a failure to restore is rethrown ONLY when
 * `mutate` itself succeeded, so a real assertion failure is never masked by a
 * cleanup error on top of it.
 */
export async function withRestoredColumn<T>(
  table: string,
  column: string,
  where: { sql: string; params: readonly unknown[] },
  mutate: () => Promise<T>,
): Promise<T> {
  // Identifiers cannot be parameterised in SQL, so they are whitelisted by shape
  // rather than interpolated blind. Call sites are all in-repo, but a helper that
  // takes a table name and concatenates it is a habit worth not forming.
  const IDENT = /^[a-z_][a-z0-9_]*$/;
  if (!IDENT.test(table) || !IDENT.test(column)) {
    throw new Error(`withRestoredColumn: unsafe identifier ${table}.${column}`);
  }

  const original = await withDb(async (sql) => {
    const result = await sql(
      `SELECT ${column} AS value FROM ${table} WHERE ${where.sql} LIMIT 1`,
      where.params,
    );
    if (result.rows.length === 0) {
      throw new Error(
        `withRestoredColumn: no ${table} row matched "${where.sql}". ${SEED_HINT}`,
      );
    }
    return result.rows[0].value as unknown;
  });

  // The restored value goes in the LAST placeholder, not the first. `where.sql`
  // already numbers its own placeholders from $1, so putting the value at $1 would
  // shift every one of them by a position — a bug that reads as correct and
  // "restores" the wrong row (or none).
  const valuePlaceholder = `$${where.params.length + 1}`;
  const restoreSql = `UPDATE ${table} SET ${column} = ${valuePlaceholder} WHERE ${where.sql}`;
  const restoreParams = [...where.params, original];

  let result: T;
  try {
    result = await mutate();
  } catch (mutateError) {
    // Restore, then rethrow the ORIGINAL error — it is the one that explains the
    // run, so a cleanup failure must not replace it.
    await withDb(async (sql) => {
      await sql(restoreSql, restoreParams);
    }).catch(() => undefined);
    throw mutateError;
  }

  await withDb(async (sql) => {
    await sql(restoreSql, restoreParams);
  });
  return result;
}
