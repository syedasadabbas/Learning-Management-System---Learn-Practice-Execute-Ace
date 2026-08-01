// =============================================================================
// THE CONTRACT SUITE, RUN AGAINST BOTH IMPLEMENTATIONS.
// -----------------------------------------------------------------------------
// ./memory.ts always. ./pg.ts when — and only when — a database is pointed at it.
//
// WHY A SEPARATE ENV VAR AND NOT `DATABASE_URL`. These tests INSERT and DELETE.
// `DATABASE_URL` in this repository points at the shared Neon database the team
// develops against; a suite that picked it up automatically would write to it the
// first time anyone ran `npm test` with a populated `.env`, and would delete rows
// on teardown. `REALTIME_TEST_DATABASE_URL` has to be set deliberately, which is
// the point: opting a real database into a destructive suite should be an act,
// not a side effect of having configured the app.
//
// THE SKIP IS LOUD AND NAMED. When the variable is absent the pg suite is
// registered as a skipped `describe` whose title says why, so a run that did not
// exercise Postgres reports "skipped" in the summary rather than reporting
// nothing. A silently-absent suite is how ./pg.ts came to have no coverage at all.
// =============================================================================

import { Pool } from "pg";
import { afterAll, describe, it } from "vitest";

import { runStoreContract, type EngagementSnapshot, type StoreHarness } from "./contract";
import { createMemoryStore } from "./memory";
import { createPgStore } from "./pg";

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------

runStoreContract("memory", {
  async setup(): Promise<StoreHarness> {
    const store = createMemoryStore();
    return {
      store,
      // Any integers will do: the memory store has no referential integrity to
      // satisfy. The pg harness below is where these have to be real rows.
      classId: 10,
      userA: 1,
      userB: 2,
      async readEngagement(classId: number, userId: number): Promise<EngagementSnapshot | null> {
        const record = store
          .flushedEngagement()
          .find((r) => r.classId === classId && r.userId === userId);
        if (!record) return null;
        return {
          messagesSent: record.messagesSent,
          questionsAsked: record.questionsAsked,
          // The memory store keeps milliseconds (this package's unit); the
          // database column is minutes (the schema's unit). Converting HERE, the
          // same way ./pg.ts does, is what makes the two comparable — the
          // contract asserts on minutes because that is what is durable.
          timePresentMinutes: Math.floor(record.connectedMs / 60_000),
          score: record.score,
        };
      },
    };
  },
  async teardown(harness): Promise<void> {
    await harness.store.close();
  },
});

// ---------------------------------------------------------------------------
// postgres
// ---------------------------------------------------------------------------

const PG_URL = process.env.REALTIME_TEST_DATABASE_URL;

if (!PG_URL) {
  describe("store contract [postgres] — SKIPPED: REALTIME_TEST_DATABASE_URL is not set", () => {
    it.skip("runs the full store contract against a real database", () => {
      // Intentionally empty. Its purpose is to appear in the run summary.
    });
  });
} else {
  describe("store contract [postgres]", () => {
    // A pool of its own for FIXTURES, separate from the one inside the store. The
    // store is the thing under test; setting up its inputs through it would make
    // a broken store look like a broken fixture.
    const fixtures = new Pool({ connectionString: PG_URL, max: 4 });
    const store = createPgStore(PG_URL);

    afterAll(async () => {
      await store.close();
      await fixtures.end();
    });

    runStoreContract("postgres", {
      async setup(): Promise<StoreHarness> {
        // A FRESH CLASS AND TWO FRESH USERS PER TEST. Reusing rows across tests
        // would make `qa.list` see another test's questions, and the ordering
        // assertions would then depend on execution order.
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const users = await fixtures.query<{ id: number }>(
          `INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'x', 'Contract A', 'student'), ($2, 'x', 'Contract B', 'instructor')
           RETURNING id`,
          [`contract-a-${stamp}@example.test`, `contract-b-${stamp}@example.test`],
        );
        const [userA, userB] = users.rows.map((r) => r.id);

        const course = await fixtures.query<{ id: number }>(
          `INSERT INTO courses (title) VALUES ($1) RETURNING id`,
          [`contract ${stamp}`],
        );
        const week = await fixtures.query<{ id: number }>(
          `INSERT INTO weeks (course_id, week_number, title) VALUES ($1, 1, 'contract')
           RETURNING id`,
          [course.rows[0].id],
        );
        const cls = await fixtures.query<{ id: number }>(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at)
           VALUES ($1, $2, 'contract', now()) RETURNING id`,
          [week.rows[0].id, userB],
        );

        return {
          store,
          classId: cls.rows[0].id,
          userA,
          userB,
          async readEngagement(classId, userId): Promise<EngagementSnapshot | null> {
            const { rows } = await fixtures.query<{
              messages_sent: number;
              questions_asked: number;
              time_present_minutes: number | null;
              participation_score: number;
            }>(
              `SELECT messages_sent, questions_asked, time_present_minutes, participation_score
                 FROM class_attendance WHERE class_id = $1 AND student_id = $2`,
              [classId, userId],
            );
            const row = rows[0];
            if (!row) return null;
            return {
              messagesSent: row.messages_sent,
              questionsAsked: row.questions_asked,
              timePresentMinutes: row.time_present_minutes ?? 0,
              score: row.participation_score,
            };
          },
        };
      },

      async teardown(harness): Promise<void> {
        // Delete the COURSE, not the class: the cascade runs course -> week ->
        // live_class -> chat / Q&A / votes / attendance, so one statement removes
        // everything this test created and nothing it did not. Leaving the course
        // behind would accumulate one orphan row per test per run.
        await fixtures.query(
          `DELETE FROM courses WHERE id = (
             SELECT w.course_id FROM live_classes c JOIN weeks w ON w.id = c.week_id
              WHERE c.id = $1)`,
          [harness.classId],
        );
        await fixtures.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
          [harness.userA, harness.userB],
        ]);
      },
    });
  });
}
