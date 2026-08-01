// @vitest-environment node
// =============================================================================
// `presentation_grade_events` — the append-only grade history, proved against a
// REAL Postgres. Owner: the API stream (defect remediation wave).
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS FOR. Security review Finding 2
// (SECURITY_REVIEW_ADDON_WAVE.md:160) is that POST
// /api/presentations/submissions/:id/grade is not owner-scoped, so any
// instructor may overwrite any other's mark, and that the overwrite left NO
// trace — `graded_by` was replaced along with the score, so the previous grade
// and its author were simply gone. The owner-scoping half cannot be fixed
// without an owning-instructor column on `assignments`, which is a
// shared-contracts change. The trace half is fixed by this table, and the
// property that has to hold is exactly one sentence:
//
//   AFTER INSTRUCTOR B REGRADES INSTRUCTOR A'S SUBMISSION, INSTRUCTOR A'S MARK
//   AND INSTRUCTOR A'S IDENTITY ARE STILL READABLE.
//
// That is asserted below against real rows, because it is a property of the
// data and not of the handler: a unit test with a mocked database would prove
// only that the code calls `insert`, which is the easy half.
//
// WHY A REAL DATABASE AND WHY NOT `DATABASE_URL`. Same reasoning, and the same
// shape of answer, as tests/integration/db/constraints.test.ts: `DATABASE_URL`
// points at the shared Neon database the team develops against, and a suite
// that picked it up automatically would write to it the first time anyone ran
// `npm test` with a populated `.env`. Opting a real database in is a deliberate
// act:
//
//   TEST_DATABASE_URL=postgresql://user:pass@host:port/db npx vitest run src/db
//
// Any throwaway Postgres 16+ with migrations 0000-0008 applied will do.
//
// THE SKIP IS LOUD AND NAMED, for the same reason it is there: a silently
// absent suite is how a module comes to have no coverage at all.
//
// The CHECK assertion follows the constraints-suite idiom of asserting on the
// SQLSTATE **and** the constraint name. "It threw" is not evidence: an INSERT
// that fails on a missing NOT NULL column or a foreign key looks identical to a
// passing test while the constraint under test was never reached.
// =============================================================================

import { Pool, type DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** SQLSTATE 23514 — check_violation. */
const CHECK_VIOLATION = "23514";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DB_URL) {
  describe("presentation_grade_events — SKIPPED: TEST_DATABASE_URL is not set", () => {
    it.skip("proves a regrade cannot destroy the previous grade or its author", () => {
      // Intentionally empty. Its purpose is to appear in the run summary so a
      // run that did not exercise the database says so out loud.
    });
  });
} else {
  runGradeHistorySuite(TEST_DB_URL);
}

interface IdRow {
  id: number;
}

/** One grading event, as the dispute-resolution query would read it. */
interface EventRow {
  score: number;
  feedback: string | null;
  graded_by: number | null;
  graded_at: Date;
}

function runGradeHistorySuite(url: string): void {
  describe("presentation_grade_events (migration 0008)", () => {
    const pool = new Pool({ connectionString: url, max: 4 });

    let courseId = 0;
    let assignmentId = 0;
    let instructorAId = 0;
    let instructorBId = 0;
    let studentId = 0;
    let submissionId = 0;

    async function insertId(sql: string, params: unknown[]): Promise<number> {
      const { rows } = await pool.query<IdRow>(sql, params);
      return rows[0].id;
    }

    /**
     * Grade the submission the way the handler does: update the submission row
     * and append the event, in ONE transaction. Reproduced here rather than
     * imported because the handler is a Next.js route that needs a session; the
     * property under test is the shape of the two writes, and that shape is
     * asserted directly.
     */
    async function grade(graderId: number, score: number, feedback: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE presentation_submissions
              SET score = $2, feedback = $3, graded_by = $4, graded_at = now(), status = 'graded'
            WHERE id = $1`,
          [submissionId, score, feedback, graderId],
        );
        await client.query(
          `INSERT INTO presentation_grade_events (submission_id, score, feedback, graded_by, graded_at)
           SELECT id, score, feedback, graded_by, graded_at
             FROM presentation_submissions WHERE id = $1`,
          [submissionId],
        );
        await client.query("COMMIT");
      } catch (caught) {
        await client.query("ROLLBACK");
        throw caught;
      } finally {
        client.release();
      }
    }

    async function history(): Promise<EventRow[]> {
      const { rows } = await pool.query<EventRow>(
        `SELECT score, feedback, graded_by, graded_at
           FROM presentation_grade_events
          WHERE submission_id = $1
          ORDER BY graded_at, id`,
        [submissionId],
      );
      return rows;
    }

    beforeAll(async () => {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const users = await pool.query<IdRow>(
        `INSERT INTO users (email, password_hash, name, role) VALUES
           ($1, 'x', 'Grade History A', 'instructor'),
           ($2, 'x', 'Grade History B', 'instructor'),
           ($3, 'x', 'Grade History S', 'student')
         RETURNING id`,
        [
          `grade-hist-a-${stamp}@example.test`,
          `grade-hist-b-${stamp}@example.test`,
          `grade-hist-s-${stamp}@example.test`,
        ],
      );
      [instructorAId, instructorBId, studentId] = users.rows.map((r) => r.id);

      courseId = await insertId(`INSERT INTO courses (title) VALUES ($1) RETURNING id`, [
        `grade history ${stamp}`,
      ]);
      const weekId = await insertId(
        `INSERT INTO weeks (course_id, week_number, title) VALUES ($1, 1, 'grade history') RETURNING id`,
        [courseId],
      );
      assignmentId = await insertId(
        `INSERT INTO assignments (week_id, title, description, due_at)
         VALUES ($1, 'grade history', 'grade history', now()) RETURNING id`,
        [weekId],
      );
      const presentationId = await insertId(
        `INSERT INTO presentations (creator_id, title, slides_json)
         VALUES ($1, 'grade history', '[]'::jsonb) RETURNING id`,
        [studentId],
      );
      submissionId = await insertId(
        `INSERT INTO presentation_submissions (assignment_id, presentation_id, student_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [assignmentId, presentationId, studentId],
      );
    });

    afterAll(async () => {
      // Delete the COURSE, not the leaves: the cascade runs
      // course -> week -> assignment -> submission -> grade events.
      // Presentations hang off their creator, so the users delete takes those.
      await pool.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
        [instructorAId, instructorBId, studentId],
      ]);
      await pool.end();
    });

    it("keeps instructor A's mark and identity after instructor B regrades", async () => {
      // THE REGRESSION. Before migration 0008 the only record of a grade was on
      // `presentation_submissions`, so the second UPDATE below erased both the
      // 82 and the fact that A gave it. Grades feed the leaderboard, which is
      // why an unattributable change to one matters.
      await grade(instructorAId, 82, "Strong delivery, thin evidence.");
      await grade(instructorBId, 55, "Regraded.");

      const rows = await history();
      expect(rows).toHaveLength(2);

      expect(rows[0].score).toBe(82);
      expect(rows[0].graded_by).toBe(instructorAId);
      expect(rows[0].feedback).toBe("Strong delivery, thin evidence.");

      expect(rows[1].score).toBe(55);
      expect(rows[1].graded_by).toBe(instructorBId);

      // And the submission row still reports the CURRENT grade, which is the
      // behaviour the original author chose and this change does not alter.
      const { rows: current } = await pool.query<{ score: number; graded_by: number }>(
        `SELECT score, graded_by FROM presentation_submissions WHERE id = $1`,
        [submissionId],
      );
      expect(current[0].score).toBe(55);
      expect(current[0].graded_by).toBe(instructorBId);
    });

    it("records the FIRST grade too, so 'no history' is never ambiguous", async () => {
      // If only supersessions were recorded, an empty history would mean either
      // "graded once" or "never graded" and a dispute could not tell them apart.
      const rows = await history();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].score).toBe(82);
    });

    it("refuses a score outside 0-100, by CHECK and not by convention", async () => {
      let error: DatabaseError | undefined;
      try {
        await pool.query(
          `INSERT INTO presentation_grade_events (submission_id, score, graded_by, graded_at)
           VALUES ($1, 101, $2, now())`,
          [submissionId, instructorAId],
        );
      } catch (caught) {
        error = caught as DatabaseError;
      }
      expect(error, "the database accepted a score of 101").toBeDefined();
      // SQLSTATE **and** name: without the name this passes when the INSERT
      // failed for a missing column and the CHECK was never reached.
      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(error?.constraint).toBe("presentation_grade_events_score_in_range");
    });

    it("survives the grader's account being deleted, minus the attribution", async () => {
      // The documented compromise on `graded_by` (ON DELETE SET NULL, mirroring
      // presentation_submissions.graded_by). Asserted so that a later change to
      // RESTRICT — which would make an audit row block an account deletion — is
      // a deliberate act with a failing test in front of it.
      const throwaway = await insertId(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, 'x', 'Grade History T', 'instructor') RETURNING id`,
        [`grade-hist-t-${Date.now()}@example.test`],
      );
      await pool.query(
        `INSERT INTO presentation_grade_events (submission_id, score, graded_by, graded_at)
         VALUES ($1, 70, $2, now())`,
        [submissionId, throwaway],
      );
      await pool.query(`DELETE FROM users WHERE id = $1`, [throwaway]);

      const { rows } = await pool.query<EventRow>(
        `SELECT score, feedback, graded_by, graded_at FROM presentation_grade_events
          WHERE submission_id = $1 AND score = 70`,
        [submissionId],
      );
      expect(rows).toHaveLength(1);
      // The event survives; only the name attached to it does not.
      expect(rows[0].graded_by).toBeNull();
    });
  });
}
