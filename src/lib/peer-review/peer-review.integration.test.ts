// @vitest-environment node
// =============================================================================
// INTEGRATION — the half of this feature's correctness that lives in POSTGRES,
// plus the row-scoping half of authorization that a mock cannot reach.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS, stated as what the other 231 green tests do NOT prove.
//
// ./allocate.test.ts proves the ALLOCATOR never plans a self-review, over every
// cohort size from 0 to 40. It proves nothing about what the database would accept if
// a future hand-written INSERT, a script, or a reshaped allocator tried one anyway.
// ./visibility.test.ts proves the reveal RULE. It proves nothing about whether the
// query that feeds it is scoped to the right student — the `where reviewee_id = $1`
// predicate is SQL, and ./reviews.anonymity.test.ts mocks the client, so that
// predicate is the one thing it structurally cannot check. Its own footer says so.
//
// A mocked version of any assertion below would MODEL the thing under test and
// therefore agree with itself by construction — the trap
// src/lib/queue/store.integration.test.ts:6-13 sets out and
// src/lib/badges/award.integration.test.ts:9-16 restates. So this runs against real
// Postgres, in the shape those two files established.
//
// -----------------------------------------------------------------------------
// THE FIVE CLAIMS.
//
//   1. POSTGRES REFUSES A SELF-REVIEW ALLOCATION. `peer_review_allocations` carries
//      CHECK (reviewer_id <> reviewee_id), and this is the only place in the repo
//      where that is demonstrated rather than asserted. It also proves its own
//      sensitivity: the same INSERT succeeds on a scratch table WITHOUT the check.
//   2. THE TWO UNIQUE INDEXES DO THEIR JOBS UNDER CONCURRENCY. Four simultaneous
//      allocations of one (submission, reviewer) leave one row; four simultaneous
//      submits of one review leave ONE review, which is what makes "a submitted
//      review cannot be edited" true even against a double-clicked Save.
//   3. A STUDENT CANNOT READ A REVIEW THEY WERE NOT PARTY TO — through the real
//      `getReviewTask`, `getReceivedReviews` and `readReviewAsParty`, against real
//      rows. This is the authorization negative the brief asks for, asserted on the
//      real response.
//   4. THE REVEAL POINT HOLDS IN SQL. Before `released_at` is set, the reviewee's own
//      query returns no review content at all; after it, it returns it.
//   5. THE REVIEWEE'S RESPONSE BODY CARRIES NO REVIEWER IDENTITY, with a real
//      reviewer whose real name and email are in `users`, fetched through the real
//      query. The mocked test proves the mapping drops an identity; this proves the
//      whole path never has one.
//
// -----------------------------------------------------------------------------
// HOW IT COEXISTS WITH SEVEN OTHER AGENTS ON ONE SHARED DATABASE:
//   * every row it creates is its own — one course, one week, one assignment, three
//     probe students, three submissions — and every one carries PROBE_PREFIX in a
//     text column, so cleanup is exact and by prefix as well as by id;
//   * it touches NO existing course, week, assignment, submission or user, so no
//     other stream's fixtures or assertions can be affected;
//   * probe users get `cohort_id = NULL`, so they cannot appear on any cohort's
//     leaderboard while the test runs;
//   * deletes cascade: dropping the course removes the week, assignment, submissions,
//     round, allocations and reviews (`ON DELETE CASCADE` all the way down), and
//     dropping the users removes their allocations;
//   * the scratch table is named with `process.pid`, so two concurrent runs cannot
//     collide, and it is dropped in afterAll;
//   * `grading_rubrics` rows are removed explicitly, because they hang off the
//     assignment with `ON DELETE CASCADE` but the ROUND references them with
//     `ON DELETE RESTRICT` — order matters, and it is handled in afterAll.
//
// SKIPPED, LOUDLY, WITHOUT A REAL DATABASE. tests/setup.ts points DATABASE_URL at an
// unreachable placeholder so no unit test can touch Postgres; this file re-reads .env
// with `override` and warns rather than silently passing.
//
// ALSO SKIPPED, LOUDLY, WHEN THE TABLES DO NOT EXIST. The wave's migration is
// generated once by the coordinator; on a checkout where that has not run, claims
// 1-5 report as skipped and the scratch-table half of claim 1 still proves the
// mechanism.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { config as loadEnv } from "dotenv";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  getReceivedReviews as GetReceivedReviews,
  getReviewTask as GetReviewTask,
  readReviewAsParty as ReadReviewAsParty,
  submitReview as SubmitReview,
} from "./reviews";
import { DEFAULT_RUBRIC_CRITERIA } from "./rubric";
import { REVIEWER_IDENTITY_FIELDS } from "./visibility";

/** Marks every row this file creates. */
const PROBE_PREFIX = "__peerreviewint";

/** How many racers. Two can interleave by luck; four cannot all be lucky. */
const RACERS = 4;

/**
 * Budget for one race, in milliseconds. A round trip to this Neon instance is
 * ~245 ms (src/db/index.ts), and a race is a table create, four connection
 * acquisitions, four inserts and a count.
 */
const RACE_TIMEOUT_MS = 60_000;

/** Long enough to pass MIN_REVIEW_CHARS (120). */
const REVIEW_TEXT =
  "The responsive layout holds at 360 mm and at 1280 mm, and the navigation collapses " +
  "cleanly. The footer link contrast is too low to read, and index.html nests three divs " +
  "where one section element would do.";

let pool: Pool;
let getReceivedReviews: typeof GetReceivedReviews;
let getReviewTask: typeof GetReviewTask;
let readReviewAsParty: typeof ReadReviewAsParty;
let submitReview: typeof SubmitReview;

let live = false;
let tablesExist = false;

const scratchTable = `${PROBE_PREFIX}_scratch_${process.pid}`;

/** Fixture ids, filled in beforeAll. */
const ids = {
  courseId: 0,
  weekId: 0,
  assignmentId: 0,
  rubricId: 0,
  roundId: 0,
  /** alice reviews bob's submission; carol is the STRANGER to that pairing. */
  alice: 0,
  bob: 0,
  carol: 0,
  bobSubmissionId: 0,
  aliceSubmissionId: 0,
  carolSubmissionId: 0,
  /** alice -> bob's submission. */
  allocationId: 0,
  reviewId: 0,
};

const REVIEWER_NAME = `${PROBE_PREFIX} Alice Reviewer`;
const REVIEWER_EMAIL = `${PROBE_PREFIX}.alice.${process.pid}@example.test`;

beforeAll(async () => {
  // `override` because tests/setup.ts has already set DATABASE_URL to the
  // deliberately unreachable placeholder, and plain dotenv never replaces a value
  // that is already present.
  loadEnv({ override: true });

  const url = process.env.DATABASE_URL ?? "";
  if (!url || url.includes("never-connected")) {
    console.warn(
      "[peer-review:integration] SKIPPED — no real DATABASE_URL. These are the ONLY tests " +
        "that prove Postgres refuses a self-review allocation and that a student cannot read " +
        "a review they were not party to. A run without them proves neither.",
    );
    return;
  }

  const dbModule = await import("@/db");
  const reviews = await import("./reviews");
  pool = dbModule.pool;
  getReceivedReviews = reviews.getReceivedReviews;
  getReviewTask = reviews.getReviewTask;
  readReviewAsParty = reviews.readReviewAsParty;
  submitReview = reviews.submitReview;
  live = true;

  const present = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('peer_review_rounds','peer_review_allocations','peer_reviews','grading_rubrics')`,
  );
  tablesExist = present.rows.length === 4;

  if (!tablesExist) {
    console.warn(
      "[peer-review:integration] the peer-review tables do not all exist yet, so claims 1-5 " +
        "are SKIPPED, not passed. The wave's migration is generated once by the coordinator. " +
        "The scratch-table half of claim 1 still proves the CHECK mechanism.",
    );
    return;
  }

  // ---- fixtures. Own course -> week -> assignment, so nothing existing is touched.
  const course = await pool.query<{ id: number }>(
    `insert into courses (title, description, duration_weeks) values ($1, $2, 1) returning id`,
    [`${PROBE_PREFIX} course ${process.pid}`, "peer-review integration probe"],
  );
  ids.courseId = course.rows[0].id;

  const week = await pool.query<{ id: number }>(
    `insert into weeks (course_id, week_number, title) values ($1, 1, $2) returning id`,
    [ids.courseId, `${PROBE_PREFIX} week`],
  );
  ids.weekId = week.rows[0].id;

  const assignment = await pool.query<{ id: number }>(
    `insert into assignments (week_id, title, description, due_at)
     values ($1, $2, 'probe', now()) returning id`,
    [ids.weekId, `${PROBE_PREFIX} assignment`],
  );
  ids.assignmentId = assignment.rows[0].id;

  // Three probe students. cohort_id NULL so they cannot reach a leaderboard.
  const students = await pool.query<{ id: number; email: string }>(
    `insert into users (email, password_hash, name, role) values
       ($1, 'not-a-real-hash', $2, 'student'),
       ($3, 'not-a-real-hash', $4, 'student'),
       ($5, 'not-a-real-hash', $6, 'student')
     returning id, email`,
    [
      REVIEWER_EMAIL,
      REVIEWER_NAME,
      `${PROBE_PREFIX}.bob.${process.pid}@example.test`,
      `${PROBE_PREFIX} Bob Reviewee`,
      `${PROBE_PREFIX}.carol.${process.pid}@example.test`,
      `${PROBE_PREFIX} Carol Stranger`,
    ],
  );
  ids.alice = students.rows.find((r) => r.email === REVIEWER_EMAIL)!.id;
  ids.bob = students.rows.find((r) => r.email.includes(".bob."))!.id;
  ids.carol = students.rows.find((r) => r.email.includes(".carol."))!.id;

  const subs = await pool.query<{ id: number; student_id: number }>(
    `insert into submissions (student_id, assignment_id, github_url, description) values
       ($1, $4, 'https://github.com/probe/alice', 'alice notes'),
       ($2, $4, 'https://github.com/probe/bob', 'bob notes'),
       ($3, $4, 'https://github.com/probe/carol', 'carol notes')
     returning id, student_id`,
    [ids.alice, ids.bob, ids.carol, ids.assignmentId],
  );
  ids.aliceSubmissionId = subs.rows.find((r) => r.student_id === ids.alice)!.id;
  ids.bobSubmissionId = subs.rows.find((r) => r.student_id === ids.bob)!.id;
  ids.carolSubmissionId = subs.rows.find((r) => r.student_id === ids.carol)!.id;

  const rubric = await pool.query<{ id: number }>(
    `insert into grading_rubrics (assignment_id, name, criteria) values ($1, $2, $3) returning id`,
    [ids.assignmentId, `${PROBE_PREFIX} rubric`, JSON.stringify([...DEFAULT_RUBRIC_CRITERIA])],
  );
  ids.rubricId = rubric.rows[0].id;

  // The round starts UNRELEASED. Claim 4 releases it partway through.
  const round = await pool.query<{ id: number }>(
    `insert into peer_review_rounds (assignment_id, rubric_id, reviews_per_submission, review_due_at)
     values ($1, $2, 2, now() + interval '5 days') returning id`,
    [ids.assignmentId, ids.rubricId],
  );
  ids.roundId = round.rows[0].id;

  // alice reviews bob. carol is deliberately NOT allocated to bob's submission, so
  // she is the stranger every claim-3 assertion uses.
  const allocation = await pool.query<{ id: number }>(
    `insert into peer_review_allocations (round_id, submission_id, reviewee_id, reviewer_id)
     values ($1, $2, $3, $4) returning id`,
    [ids.roundId, ids.bobSubmissionId, ids.bob, ids.alice],
  );
  ids.allocationId = allocation.rows[0].id;
});

afterAll(async () => {
  if (!live) return;

  await pool.query(`drop table if exists ${scratchTable}`).catch(() => {});

  if (!tablesExist) return;

  // ORDER MATTERS. `peer_review_rounds.rubric_id` is ON DELETE RESTRICT, so the
  // round has to go before the rubric — and deleting the COURSE cascades to the
  // week, the assignment, its submissions and (through the assignment) the round.
  // The rubric is then unreferenced and deletable. Done by prefix as well as by id
  // so a crashed earlier run is cleaned up too.
  await pool.query(`delete from peer_review_rounds where assignment_id = $1`, [ids.assignmentId]).catch(() => {});
  await pool.query(`delete from courses where title like $1`, [`${PROBE_PREFIX}%`]).catch(() => {});
  await pool.query(`delete from grading_rubrics where name like $1`, [`${PROBE_PREFIX}%`]).catch(() => {});
  await pool.query(`delete from users where email like $1`, [`${PROBE_PREFIX}.%@example.test`]).catch(() => {});
});

// ===========================================================================
// CLAIM 1 — Postgres refuses a self-review, and would not without the CHECK.
// ===========================================================================

describe("CHECK (reviewer_id <> reviewee_id) — the mechanism, and its sensitivity", () => {
  it(
    "REFUSES an allocation whose reviewer is its reviewee",
    async () => {
      if (!live || !tablesExist) return;

      // The most important single assertion in this stream. Every other no-self-review
      // guarantee is application code that a future edit can bypass; this one cannot
      // be bypassed by any client, including a hand-written INSERT during an incident.
      await expect(
        pool.query(
          `insert into peer_review_allocations (round_id, submission_id, reviewee_id, reviewer_id)
           values ($1, $2, $3, $3)`,
          [ids.roundId, ids.bobSubmissionId, ids.bob],
        ),
      ).rejects.toThrow(/peer_review_allocations_no_self_review|violates check constraint/i);

      // And nothing was written.
      const count = await pool.query<{ n: string }>(
        `select count(*)::text as n from peer_review_allocations
          where round_id = $1 and reviewer_id = reviewee_id`,
        [ids.roundId],
      );
      expect(count.rows[0].n).toBe("0");
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "the same INSERT SUCCEEDS on a scratch table without the CHECK — so the test is sensitive",
    async () => {
      if (!live) return;

      // A near-copy of the DDL, confined to this file, for the reason
      // src/lib/badges/award.integration.test.ts gives for its own copy: the test has
      // to show the constraint is what does the work, and dropping the real one on a
      // database seven other agents are using would be sabotage rather than a test.
      await pool.query(`drop table if exists ${scratchTable}`);
      await pool.query(
        `create table ${scratchTable} (
           id serial primary key,
           round_id integer not null,
           submission_id integer not null,
           reviewee_id integer not null,
           reviewer_id integer not null
         )`,
      );

      await pool.query(
        `insert into ${scratchTable} (round_id, submission_id, reviewee_id, reviewer_id)
         values (1, 1, 7, 7)`,
      );
      const before = await pool.query<{ n: string }>(
        `select count(*)::text as n from ${scratchTable} where reviewer_id = reviewee_id`,
      );
      // Without the constraint, a self-review allocation is perfectly acceptable to
      // Postgres. That is the whole point: the constraint is the only thing stopping it.
      expect(before.rows[0].n).toBe("1");

      // Now add the identical CHECK and show the same statement is refused.
      await pool.query(`delete from ${scratchTable}`);
      await pool.query(
        `alter table ${scratchTable} add constraint ${scratchTable}_no_self check (reviewer_id <> reviewee_id)`,
      );
      await expect(
        pool.query(
          `insert into ${scratchTable} (round_id, submission_id, reviewee_id, reviewer_id)
           values (1, 1, 7, 7)`,
        ),
      ).rejects.toThrow(/check constraint/i);

      await pool.query(`drop table if exists ${scratchTable}`);
    },
    RACE_TIMEOUT_MS,
  );

  it("the constraint is present on the live table, read from the catalogue", async () => {
    if (!live || !tablesExist) return;
    // A CHECK that exists in the schema module but was never applied would satisfy
    // every other test in this repository. pg_constraint is the only place the two
    // are distinguishable.
    const found = await pool.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'peer_review_allocations_no_self_review'`,
    );
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].def.replace(/\s/g, "")).toContain("reviewer_id<>reviewee_id");
  });
});

// ===========================================================================
// CLAIM 2 — the two unique indexes hold under concurrency.
// ===========================================================================

describe("unique indexes under concurrency", () => {
  it("both indexes are UNIQUE, read from pg_indexes", async () => {
    if (!live || !tablesExist) return;
    // A plain index would satisfy every query in this codebase and make every other
    // test pass. The catalogue is the only place the difference is visible.
    const rows = await pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname='public'
          and indexname in ('peer_review_allocations_pair_idx','peer_reviews_allocation_idx')`,
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.indexdef, row.indexname).toContain("CREATE UNIQUE INDEX");
    }
  });

  it(
    "FOUR simultaneous allocations of one (submission, reviewer) leave exactly one row",
    async () => {
      if (!live || !tablesExist) return;

      // carol -> alice's submission, allocated four times at once. This is what a
      // double-clicked "Allocate" routed to two serverless instances does, and the
      // reason allocateRound can be re-run safely.
      const clients = await Promise.all(Array.from({ length: RACERS }, () => pool.connect()));
      try {
        await Promise.all(
          clients.map((client) =>
            client
              .query(
                `insert into peer_review_allocations (round_id, submission_id, reviewee_id, reviewer_id)
                 values ($1, $2, $3, $4)
                 on conflict (submission_id, reviewer_id) do nothing`,
                [ids.roundId, ids.aliceSubmissionId, ids.alice, ids.carol],
              )
              .catch(() => undefined),
          ),
        );
      } finally {
        for (const client of clients) client.release();
      }

      // Counted in SQL, not reported by the application code under test.
      const count = await pool.query<{ n: string }>(
        `select count(*)::text as n from peer_review_allocations
          where submission_id = $1 and reviewer_id = $2`,
        [ids.aliceSubmissionId, ids.carol],
      );
      expect(count.rows[0].n).toBe("1");
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "FOUR simultaneous submits of one review leave ONE review — which is why a review cannot be edited",
    async () => {
      if (!live || !tablesExist) return;

      // Through the REAL `submitReview`, four times at once, all as alice. Exactly one
      // must report ok; the losers must report `already_submitted`. That is the
      // property that makes "a submitted review cannot be changed" true against a
      // race, rather than only against a second sequential attempt.
      const results = await Promise.all(
        Array.from({ length: RACERS }, () =>
          submitReview(
            {
              allocationId: ids.allocationId,
              content: REVIEW_TEXT,
              rubricScores: { requirements: 4, quality: 3, presentation: 5 },
            },
            ids.alice,
          ),
        ),
      );

      const accepted = results.filter((r) => r.ok);
      expect(accepted).toHaveLength(1);
      for (const rejected of results.filter((r) => !r.ok)) {
        if (rejected.ok) continue;
        expect(rejected.code).toBe("already_submitted");
      }

      const count = await pool.query<{ n: string }>(
        `select count(*)::text as n from peer_reviews where allocation_id = $1`,
        [ids.allocationId],
      );
      expect(count.rows[0].n).toBe("1");

      const stored = await pool.query<{ id: number; total_score: number; visibility: string }>(
        `select id, total_score, visibility from peer_reviews where allocation_id = $1`,
        [ids.allocationId],
      );
      ids.reviewId = stored.rows[0].id;
      expect(stored.rows[0].total_score).toBe(12);
      // The column default is the single source of the anonymity default; nothing in
      // the write path passes it.
      expect(stored.rows[0].visibility).toBe("anonymous");
    },
    RACE_TIMEOUT_MS,
  );

  it("a fifth, later submit is still refused — there is no update path at all", async () => {
    if (!live || !tablesExist) return;
    const again = await submitReview(
      {
        allocationId: ids.allocationId,
        content: `${REVIEW_TEXT} And now I would like to change what I said entirely.`,
        rubricScores: { requirements: 1, quality: 1, presentation: 1 },
      },
      ids.alice,
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_submitted");

    // The stored review is untouched: same total, original text.
    const stored = await pool.query<{ total_score: number; content: string }>(
      `select total_score, content from peer_reviews where allocation_id = $1`,
      [ids.allocationId],
    );
    expect(stored.rows[0].total_score).toBe(12);
    expect(stored.rows[0].content).not.toContain("change what I said");
  });
});

// ===========================================================================
// CLAIM 3 — the authorization NEGATIVES, against real rows and real SQL.
// ===========================================================================

describe("a student cannot reach a review they were not party to", () => {
  it("getReviewTask returns nothing for a stranger's allocation id", async () => {
    if (!live || !tablesExist) return;
    // Carol knows the id — she guessed it, or it leaked. The `where reviewer_id = $1`
    // predicate is what stops her, and this is the assertion the mocked test could
    // not make.
    const loaded = await getReviewTask(ids.carol, ids.allocationId);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe("not_found");
  });

  it("getReviewTask returns nothing even for the REVIEWEE of that allocation", async () => {
    if (!live || !tablesExist) return;
    // Bob owns the work being reviewed and still may not open the write form: it is
    // not his to write, and `not_found` rather than a 403 avoids confirming anything.
    const loaded = await getReviewTask(ids.bob, ids.allocationId);
    expect(loaded.ok).toBe(false);
  });

  it("submitReview refuses a stranger, and writes nothing", async () => {
    if (!live || !tablesExist) return;
    const before = await pool.query<{ n: string }>(`select count(*)::text as n from peer_reviews`);
    const result = await submitReview(
      {
        allocationId: ids.allocationId,
        content: REVIEW_TEXT,
        rubricScores: { requirements: 5, quality: 5, presentation: 5 },
      },
      ids.carol,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");

    const after = await pool.query<{ n: string }>(`select count(*)::text as n from peer_reviews`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("readReviewAsParty refuses a stranger with not_a_party", async () => {
    if (!live || !tablesExist || ids.reviewId === 0) return;
    const read = await readReviewAsParty(ids.carol, ids.reviewId);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("not_a_party");
  });

  it("getReceivedReviews never returns another student's feedback", async () => {
    if (!live || !tablesExist) return;
    // Carol has her own submission in this round but no review of it. Her result must
    // not contain Bob's review text under any circumstances.
    const carol = await getReceivedReviews(ids.carol);
    expect(JSON.stringify(carol)).not.toContain("360 mm");
  });
});

// ===========================================================================
// CLAIM 4 — the reveal point, in SQL, with real rows.
// ===========================================================================

describe("the reveal point", () => {
  it("BEFORE release, the reviewee's own query returns no review content", async () => {
    if (!live || !tablesExist) return;

    const before = await getReceivedReviews(ids.bob);
    const round = before.find((g) => g.roundId === ids.roundId);
    expect(round, "bob's round should be listed even before release").toBeDefined();
    expect(round!.released).toBe(false);
    expect(round!.reviews).toEqual([]);
    // The text exists in the database and does not reach him.
    expect(JSON.stringify(before)).not.toContain("360 mm");

    // Proof the row really is there, so the assertion above is not passing because
    // nothing was written.
    const stored = await pool.query<{ n: string }>(
      `select count(*)::text as n from peer_reviews where allocation_id = $1`,
      [ids.allocationId],
    );
    expect(stored.rows[0].n).toBe("1");
  });

  it("the REVIEWER can read their own review before release", async () => {
    if (!live || !tablesExist || ids.reviewId === 0) return;
    const read = await readReviewAsParty(ids.alice, ids.reviewId);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.review.content).toContain("360 mm");
  });

  it("AFTER release, the reviewee sees it — and still no reviewer identity", async () => {
    if (!live || !tablesExist) return;

    await pool.query(`update peer_review_rounds set released_at = now() where id = $1`, [ids.roundId]);

    const after = await getReceivedReviews(ids.bob);
    const round = after.find((g) => g.roundId === ids.roundId);
    expect(round!.released).toBe(true);
    expect(round!.reviews).toHaveLength(1);
    expect(round!.reviews[0].content).toContain("360 mm");
    expect(round!.reviews[0].totalScore).toBe(12);
    // Positional label, not the row id.
    expect(round!.reviews[0].reviewNumber).toBe(1);

    // ---- CLAIM 5, on the same real response ------------------------------------
    // Distinctive STRINGS are checked by substring, because a name and an address
    // cannot collide with anything legitimate in this payload.
    const serialised = JSON.stringify(after);
    expect(serialised).not.toContain(REVIEWER_NAME);
    expect(serialised).not.toContain(REVIEWER_EMAIL);
    expect(serialised).not.toContain("alice");

    // IDS ARE CHECKED STRUCTURALLY, NOT BY SUBSTRING, and the first version of this
    // test got that wrong in a way worth recording: `expect(serialised).not
    // .toContain(String(ids.reviewId))` FAILED with reviewId = 1, because the digit
    // "1" occurs inside a legitimate `maxPoints: 15` and inside a timestamp. A
    // substring search for a small integer is a coin flip, and on a fresh table every
    // id is a small integer — so the assertion would have been meaningless where it
    // passed and a false alarm where it did not. The property that actually matters is
    // that no FIELD carries an identity, so the keys are checked instead.
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (!value || typeof value !== "object" || value instanceof Date) return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        keys.add(key);
        walk(nested);
      }
    };
    walk(after);
    for (const forbidden of REVIEWER_IDENTITY_FIELDS) {
      expect([...keys], `"${forbidden}" must not be a field of a reviewee-facing response`).not.toContain(
        forbidden,
      );
    }
    // The revealed review's shape is pinned exactly, so a future edit that adds a
    // field has to come through this assertion rather than past it.
    expect(Object.keys(round!.reviews[0]).sort()).toEqual([
      "content",
      "maxTotal",
      "reviewNumber",
      "scoreLines",
      "submittedAt",
      "totalScore",
    ]);
  });

  it("a FLAGGED review is withheld from the reviewee even after release", async () => {
    if (!live || !tablesExist) return;

    await pool.query(
      `update peer_reviews set flagged_at = now(), instructor_note = 'probe: low effort'
        where allocation_id = $1`,
      [ids.allocationId],
    );

    const after = await getReceivedReviews(ids.bob);
    const round = after.find((g) => g.roundId === ids.roundId);
    expect(round!.released).toBe(true);
    expect(round!.reviews).toEqual([]);
    const serialised = JSON.stringify(after);
    expect(serialised).not.toContain("360 mm");
    // And the instructor's private note never reaches a student.
    expect(serialised).not.toContain("low effort");

    // The reviewer can still read their own flagged review.
    const own = await readReviewAsParty(ids.alice, ids.reviewId);
    expect(own.ok).toBe(true);
  });
});
