// @vitest-environment node
// =============================================================================
// INTEGRATION — the half of this feature's correctness that lives in POSTGRES.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS.
//
// ./evaluate.test.ts is 23 green tests about which badges a student qualifies for,
// and it proves NOTHING about the property the whole feature rests on: that a
// badge is awarded exactly once. Delete the word UNIQUE from
// `badge_awards_student_type_idx` and every one of those tests still passes while
// students collect duplicate badges. A mocked "award twice, expect one row" test
// would be worse than nothing, because it would MODEL the index and therefore
// agree with itself by construction — precisely the trap
// src/lib/queue/store.integration.test.ts:6-13 sets out. So this runs against real
// Postgres.
//
// -----------------------------------------------------------------------------
// THE THREE CLAIMS, AND WHY THE THIRD ONE IS THE IMPORTANT ONE.
//
//   1. EIGHT SIMULTANEOUS AWARDS OF ONE (student, badge) PRODUCE ONE ROW, via the
//      real `awardBadge`, and `created: true` comes back exactly once. Not "the
//      second call returned created:false" — that is application code reporting on
//      itself. The row count is counted in SQL.
//
//   2. THE INDEX IS UNIQUE, read from `pg_indexes`. A plain index would satisfy
//      every query in this codebase and make every other test pass, so the
//      catalogue is the only place the two are distinguishable.
//
//   3. THE SAME RACE WITHOUT THE INDEX PRODUCES EIGHT ROWS. This is the test
//      proving its own sensitivity, and it is the standard the queue stream set by
//      breaking its constraint by hand. It is done here on a SCRATCH TABLE with
//      byte-identical DDL, on eight separate raw connections, because dropping the
//      index on the live `badge_awards` while seven other agents share this
//      database would be sabotage rather than a test. The scratch table is created
//      with the index, shown to collapse the race to one row, then has ONLY the
//      index dropped and is shown to admit all eight. Same table, same statement,
//      same connections — the index is the only variable.
//
// -----------------------------------------------------------------------------
// HOW IT COEXISTS WITH SEVEN OTHER AGENTS ON ONE SHARED DATABASE:
//   * it creates ONE probe user, whose email carries PROBE_PREFIX, with
//     `cohort_id = NULL` so it cannot appear on any cohort's leaderboard, and
//     deletes it in afterAll — which cascades away its awards
//     (`badge_awards.student_id` is ON DELETE CASCADE);
//   * cleanup deletes by PREFIX as well as by recorded id, so a row left by a
//     crashed run is still removed on the next one;
//   * the scratch table is named with `process.pid`, so two concurrent runs of this
//     file cannot collide, and it is dropped in afterAll;
//   * it reads and writes NO other table.
//
// SKIPPED, LOUDLY, WITHOUT A REAL DATABASE. tests/setup.ts deliberately points
// DATABASE_URL at an unreachable placeholder so no unit test can touch Postgres.
// This file re-reads .env with `override` and skips itself — with a console
// warning, never silently — when that yields nothing real.
//
// ALSO SKIPPED, LOUDLY, WHEN `badge_awards` DOES NOT YET EXIST. The migration for
// this table is generated ONCE by the coordinator at the end of the wave (eight
// concurrent `db:generate` runs produce conflicting migrations), so on the branch
// as this lands the table may be absent. Claims 1 and 2 then report as skipped
// rather than as passed; claim 3, which needs only the scratch table, still runs
// and still proves the mechanism.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { config as loadEnv } from "dotenv";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { awardBadge as AwardBadge, listStudentBadges as ListStudentBadges } from "./award";

/** Marks every row and object this file creates, so cleanup is exact. */
const PROBE_PREFIX = "__badgeint";

/** How many racers. Two can interleave by luck; eight cannot all be lucky. */
const RACERS = 8;

/**
 * The badge used for the live-table race. Any catalogue type works — the index is
 * on (student_id, type) and knows nothing about meaning — and `first_submission`
 * is chosen because it is the cheapest thing to explain in a failure message.
 * The probe user is deleted afterwards, so no real student's awards are touched.
 */
const PROBE_BADGE = "first_submission" as const;

/**
 * `student_id` used on the SCRATCH table only. That table has no foreign key, so
 * the value need not exist in `users` — and using an implausible one keeps the
 * scratch rows visually distinct from the live-table probe's if both ever appear in
 * the same log.
 */
const PROBE_STUDENT_SENTINEL = 4242;

/**
 * Budget for one eight-way race, in milliseconds.
 *
 * Vitest's default is 5_000 ms and the first run of this file blew straight through
 * it: a round trip to this Neon instance is ~245 ms (the figure src/db/index.ts
 * records), and a race is a DROP, a CREATE TABLE, a CREATE INDEX, eight connection
 * acquisitions, eight inserts and a count — comfortably 20+ round trips. 60_000 ms
 * is far above that and far below the point where a genuine hang would be mistaken
 * for slowness.
 */
const RACE_TIMEOUT_MS = 60_000;

let pool: Pool;
let awardBadge: typeof AwardBadge;
let listStudentBadges: typeof ListStudentBadges;
let live = false;
/** True only when the migration for `badge_awards` has been applied. */
let tableExists = false;

let probeStudentId = 0;
const scratchTable = `${PROBE_PREFIX}_scratch_${process.pid}`;
const scratchIndex = `${scratchTable}_student_type_idx`;

beforeAll(async () => {
  // `override` because tests/setup.ts has already set DATABASE_URL to the
  // deliberately unreachable placeholder, and plain dotenv never replaces a value
  // that is already present.
  loadEnv({ override: true });

  const url = process.env.DATABASE_URL ?? "";
  if (!url || url.includes("never-connected")) {
    console.warn(
      "[badges:integration] SKIPPED — no real DATABASE_URL. These are the ONLY tests that " +
        "prove a badge is awarded exactly once; a run without them proves nothing about " +
        "duplicate awards. Provide .env or the CI DATABASE_URL.",
    );
    return;
  }

  const dbModule = await import("@/db");
  const award = await import("./award");
  pool = dbModule.pool;
  awardBadge = award.awardBadge;
  listStudentBadges = award.listStudentBadges;
  live = true;

  const present = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'badge_awards'`,
  );
  tableExists = present.rows.length > 0;

  if (!tableExists) {
    console.warn(
      "[badges:integration] `badge_awards` does not exist yet, so the live-table claims " +
        "(one row from eight concurrent awards; the index is UNIQUE) are SKIPPED, not passed. " +
        "The migration is generated once by the coordinator at the end of the wave. " +
        "The scratch-table claims below still prove the mechanism and its sensitivity.",
    );
  } else {
    // A probe student of our own, rather than borrowing a real one: deleting the
    // user cascades its awards away, so cleanup cannot orphan or over-delete.
    // cohort_id is left NULL so this row cannot appear on a cohort leaderboard
    // while the test runs.
    const inserted = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, name, role)
       values ($1, $2, $3, 'student')
       returning id`,
      [`${PROBE_PREFIX}.${process.pid}@example.test`, "not-a-real-hash", "Badge probe"],
    );
    probeStudentId = inserted.rows[0].id;
  }
});

afterAll(async () => {
  if (!live) return;

  // Scratch objects first: dropping the table takes its index with it.
  await pool.query(`drop table if exists ${scratchTable}`).catch(() => {});

  if (tableExists) {
    // By PREFIX as well as by id, so a row from a crashed earlier run is cleaned up
    // too. Deleting the user cascades `badge_awards` (ON DELETE CASCADE).
    await pool
      .query(`delete from users where email like $1`, [`${PROBE_PREFIX}.%@example.test`])
      .catch(() => {});
  }
});

// ===========================================================================
// CLAIM 3 (first, because it is the one that makes the others mean something):
// the mechanism works, AND it would fail without the index.
// ===========================================================================

describe("ON CONFLICT DO NOTHING on a UNIQUE index — the mechanism, and its sensitivity", () => {
  /**
   * The scratch table's DDL, mirroring src/db/schema.badges.ts.
   *
   * A near-copy, and the duplication is deliberate and confined to this file for
   * the same reason src/lib/queue/store.integration.test.ts:491-501 states for its
   * copy of the claim statement: the test needs to DROP the index, and it must
   * never drop the real one on a database seven other agents are using. The only
   * parts that have to match are the ones the test is about — the composite unique
   * index on (student_id, type) and the conflict target naming those two columns.
   */
  async function createScratchTable(withIndex: boolean): Promise<void> {
    await pool.query(`drop table if exists ${scratchTable}`);
    await pool.query(`
      create table ${scratchTable} (
        id          serial primary key,
        student_id  integer not null,
        type        varchar(48) not null,
        awarded_at  timestamptz not null default now(),
        evidence    jsonb
      )
    `);
    if (withIndex) {
      await pool.query(
        `create unique index ${scratchIndex} on ${scratchTable} (student_id, type)`,
      );
    }
  }

  /**
   * Fire RACERS inserts of the SAME (student_id, type) on separate CONNECTIONS, as
   * simultaneously as the client can manage, and report both how many INSERTs
   * claimed to create a row and how many rows exist afterwards.
   *
   * ONE helper used by BOTH halves of the comparison, so the two runs differ in
   * exactly one thing: whether the index exists. If the sensitivity check used
   * different code from the check it is validating, it would not validate it.
   *
   * Separate connections matter: N statements on one pooled connection are
   * serialised by the wire protocol and would not race at all. Issued via
   * Promise.all on distinct connections, they genuinely overlap on the server —
   * each in its own implicit transaction, which is how production issues them (a
   * single-statement INSERT needs no explicit BEGIN, and ./award.ts does not use
   * one).
   *
   * The pool is `max: 5` (src/db/index.ts:77), so the racers are taken in waves of
   * four rather than eight at once — eight `pool.connect()` calls would wait
   * forever for slots this same test is holding. Each wave's four inserts are
   * concurrent with each other, and both halves use the identical scheduling.
   */
  async function raceInserts(conflictClause: string): Promise<{ created: number; rows: number }> {
    const waveSize = 4;
    let created = 0;

    for (let wave = 0; wave < RACERS / waveSize; wave += 1) {
      const clients: PoolClient[] = [];
      for (let i = 0; i < waveSize; i += 1) clients.push(await pool.connect());
      try {
        const results = await Promise.all(
          clients.map((c) =>
            c
              .query<{ id: number }>(
                `insert into ${scratchTable} (student_id, type)
                 values ($1, $2)
                 ${conflictClause}
                 returning id`,
                [PROBE_STUDENT_SENTINEL, PROBE_BADGE],
              )
              .then((r) => r.rowCount ?? 0)
              // A losing racer on the INDEXED table does not error — ON CONFLICT DO
              // NOTHING absorbs it and simply returns no row.
              .catch(() => 0),
          ),
        );
        created += results.reduce((a, b) => a + b, 0);
      } finally {
        for (const c of clients) c.release();
      }
    }

    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from ${scratchTable} where student_id = $1 and type = $2`,
      [PROBE_STUDENT_SENTINEL, PROBE_BADGE],
    );
    return { created, rows: Number(rows[0].n) };
  }

  it(
    "WITH the unique index, eight concurrent inserts of one key leave ONE row",
    async () => {
      if (!live) return;
      await createScratchTable(true);

      const { created, rows } = await raceInserts(
        "on conflict (student_id, type) do nothing",
      );

      // The row count is the claim. Under READ COMMITTED, select-then-insert cannot
      // produce this: all eight would see no row and all eight would insert.
      expect(rows).toBe(1);
      // And exactly one INSERT reported creating it — Postgres naming the winner,
      // which is what `AwardResult.created` is derived from.
      expect(created).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "WITHOUT the unique index, the identical race leaves EIGHT rows",
    async () => {
      if (!live) return;
      // THE SENSITIVITY PROOF, and the reason the test above means anything. Same
      // table definition, same helper, same connection scheduling — the index is the
      // only thing removed. If this yielded 1, the test above was passing for some
      // reason other than the constraint.
      //
      // The conflict clause is dropped along with the index because `on conflict
      // (student_id, type)` cannot be PLANNED without a matching unique index —
      // Postgres rejects it outright. A bare INSERT is therefore the accurate stand-in
      // for "the constraint is gone", and it is exactly the production failure mode a
      // dropped or non-unique index would silently reintroduce.
      await createScratchTable(false);

      const { created, rows } = await raceInserts("");

      expect(created).toBe(RACERS);
      expect(rows).toBe(RACERS);
    },
    RACE_TIMEOUT_MS,
  );
});

// ===========================================================================
// CLAIMS 1 AND 2: the real table, the real index, the real awardBadge.
// ===========================================================================

describe("badge_awards_student_type_idx — the index, not an application check", () => {
  it("exists AND is unique", async () => {
    if (!live || !tableExists) return;
    // A plain index here would satisfy every query in this codebase and make every
    // other test in the repo pass, while students collected duplicate badges. The
    // catalogue is the only place the two are distinguishable.
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where tablename = 'badge_awards' and indexname = 'badge_awards_student_type_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("CREATE UNIQUE INDEX");
    expect(rows[0].indexdef).toContain("student_id");
    expect(rows[0].indexdef).toContain("type");
  });
});

describe("awardBadge — exactly once, decided by Postgres", () => {
  it("collapses EIGHT SIMULTANEOUS awards of one (student, badge) into ONE row", async () => {
    if (!live || !tableExists) return;
    // The real shape of this race: an instructor double-clicking Save is routed to
    // two serverless instances, both fire a scoring event, both evaluate the same
    // student, and both find the same criterion satisfied. Neither can see the
    // other's uncommitted insert.
    const results = await Promise.all(
      Array.from({ length: RACERS }, () =>
        awardBadge({
          studentId: probeStudentId,
          type: PROBE_BADGE,
          evidence: { submissionCount: 1 },
        }),
      ),
    );

    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from badge_awards where student_id = $1 and type = $2`,
      [probeStudentId, PROBE_BADGE],
    );
    expect(Number(rows[0].n)).toBe(1);

    // Exactly one winner, and every loser reports the WINNER'S id rather than null,
    // so a caller can still tell the student when they earned it.
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.awardId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).not.toBeNull();
    for (const r of results) expect(r.awardedAt).not.toBeNull();
  });

  it("a later award of a badge already held is a no-op, not an error", async () => {
    if (!live || !tableExists) return;
    // The steady state. After a student earns `first_submission`, EVERY subsequent
    // grading event for the rest of the course re-awards it. That must be quiet and
    // must not throw, or the grading path would start failing on a badge the student
    // already has.
    const again = await awardBadge({ studentId: probeStudentId, type: PROBE_BADGE });
    expect(again.created).toBe(false);
    expect(again.awardId).not.toBeNull();
    expect(again.awardedAt).not.toBeNull();

    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from badge_awards where student_id = $1`,
      [probeStudentId],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("awarded_at is written by the DATABASE's clock, not the app process's", async () => {
    if (!live || !tableExists) return;
    // House rule (src/lib/queue/store.ts:29-56 records the live bug it exists for).
    // `awardBadge` never sets `awardedAt`, so the column default supplies it; this
    // asserts the value really came from the server rather than from a `new Date()`
    // that a skewed app clock could have produced.
    const { rows } = await pool.query<{ skew_ms: string }>(
      `select extract(epoch from (now() - awarded_at)) * 1000 as skew_ms
         from badge_awards where student_id = $1 and type = $2`,
      [probeStudentId, PROBE_BADGE],
    );
    // Same server clock on both sides of the subtraction, so the only thing this can
    // catch is a timestamp that came from somewhere else entirely.
    const skew = Number(rows[0].skew_ms);
    expect(skew).toBeGreaterThanOrEqual(0);
    expect(skew).toBeLessThan(60_000);
  });

  it("refuses a badge type that is not in the catalogue, before touching the database", async () => {
    if (!live || !tableExists) return;
    // The column is a varchar rather than a pgEnum
    // (src/db/schema.badges.ts:126-152), so this function is the boundary that keeps
    // an unknown key out of the table.
    await expect(
      awardBadge({
        studentId: probeStudentId,
        // Cast because the whole point is a value the type system would refuse.
        type: "not_a_real_badge" as never,
      }),
    ).rejects.toThrow(/unknown badge type/);

    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from badge_awards where type = 'not_a_real_badge'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("listStudentBadges reads back what was awarded", async () => {
    if (!live || !tableExists) return;
    const badges = await listStudentBadges(probeStudentId);
    expect(badges.map((b) => b.type)).toEqual([PROBE_BADGE]);
    expect(badges[0].evidence).toMatchObject({ submissionCount: 1 });
  });

  it("drops a row whose type this build does not know about, rather than failing the read", async () => {
    if (!live || !tableExists) return;
    // Inserted directly, because `awardBadge` refuses to write one. This is the
    // forward-compatibility case: a row written by a newer deploy whose catalogue has
    // a badge this one does not. It must not render as an unnamed card and must not
    // throw on a page load.
    await pool.query(`insert into badge_awards (student_id, type) values ($1, $2)`, [
      probeStudentId,
      "from_a_future_deploy",
    ]);

    const badges = await listStudentBadges(probeStudentId);
    expect(badges.map((b) => b.type)).toEqual([PROBE_BADGE]);
  });
});
