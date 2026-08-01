// @vitest-environment node
// =============================================================================
// DATABASE CONSTRAINT NEGATIVE TESTS — proving the CHECKs and unique indexes FIRE.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS.
//
// Migrations 0006 and 0007 added 42 CHECK constraints and a dozen unique indexes
// across the live-classes, presentations and learning-enhancement tables. Before
// this file, every one of them had been verified only by SELECTing from
// `pg_constraint` — that is, verified to EXIST. Existing and firing are different
// properties. A CHECK whose expression is subtly wrong (`>=` where `>` was meant,
// a NULL-swallowing comparison, a partial index whose WHERE clause never matches)
// exists perfectly happily and rejects nothing. The application code then leans on
// a guarantee the database is not providing, and the bug surfaces as corrupt rows
// months later rather than as a failed INSERT now.
//
// So every test here attempts a write that MUST be refused, and asserts on the
// SQLSTATE and the constraint name. Asserting on the name and not merely on
// "it threw" matters: an INSERT can fail for a missing NOT NULL column or a
// foreign key and look exactly like a passing test while the constraint under
// test was never reached.
//
// WHY A SEPARATE ENV VAR, AND NOT `DATABASE_URL`.
// This suite INSERTs, and its whole point is to insert BAD data. `DATABASE_URL`
// in this repository points at the shared Neon database the team develops
// against. A suite that picked it up automatically would write to the live
// database the first time anyone ran `npm test` with a populated `.env`. The same
// reasoning, and the same shape of answer, as
// services/realtime/src/store/contract.test.ts: opting a real database into a
// destructive suite must be a deliberate act.
//
//   TEST_DATABASE_URL=postgresql://user:pass@host:port/db npx vitest run tests/integration
//
// Any throwaway Postgres 16+ with migrations 0000-0007 applied will do:
//
//   createdb lms_qa && for f in src/db/migrations/0*.sql; do psql -d lms_qa -f "$f"; done
//
// THE SKIP IS LOUD AND NAMED, for the reason given in the realtime contract
// suite: a silently-absent suite is how a module comes to have no coverage at all.
// =============================================================================

import { Pool, type DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** SQLSTATE 23514 — check_violation. */
const CHECK_VIOLATION = "23514";
/** SQLSTATE 23505 — unique_violation. Covers unique indexes and composite PKs. */
const UNIQUE_VIOLATION = "23505";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DB_URL) {
  describe("database constraints — SKIPPED: TEST_DATABASE_URL is not set", () => {
    it.skip("proves the 0006/0007 CHECK constraints and unique indexes reject bad writes", () => {
      // Intentionally empty. Its purpose is to appear in the run summary so that
      // a run which did not exercise the database says so out loud.
    });
  });
} else {
  runConstraintSuite(TEST_DB_URL);
}

/** Row shape returned by every fixture INSERT below. */
interface IdRow {
  id: number;
}

function runConstraintSuite(url: string): void {
  describe("database constraints (0006 / 0007)", () => {
    const pool = new Pool({ connectionString: url, max: 4 });

    // Fixture ids, populated in beforeAll. All descend from ONE course so that a
    // single cascading DELETE in afterAll removes everything this file created.
    let courseId = 0;
    let weekId = 0;
    let lectureId = 0;
    let assignmentId = 0;
    let instructorId = 0;
    let studentId = 0;
    let otherStudentId = 0;
    let classId = 0;
    let presentationId = 0;

    /**
     * Run a statement that MUST be rejected, and assert on WHY it was rejected.
     *
     * Asserting the constraint name is the load-bearing part. Without it a test
     * passes when the INSERT fails for an unrelated reason — a typo'd column, a
     * foreign key, a missing NOT NULL — and the constraint under test is never
     * reached. That failure mode is silent and produces a green suite that proves
     * nothing, which is the exact situation this file was written to end.
     */
    async function expectRejected(
      sql: string,
      params: unknown[],
      expected: { code: string; constraint: string },
    ): Promise<void> {
      let error: DatabaseError | undefined;
      try {
        await pool.query(sql, params);
      } catch (caught) {
        error = caught as DatabaseError;
      }
      expect(error, `expected the database to reject: ${sql}`).toBeDefined();
      expect(error?.code).toBe(expected.code);
      expect(error?.constraint).toBe(expected.constraint);
    }

    /** Assert a write the schema is supposed to ALLOW is in fact allowed. */
    async function expectAccepted(sql: string, params: unknown[]): Promise<void> {
      await expect(pool.query(sql, params)).resolves.toBeDefined();
    }

    async function insertId(sql: string, params: unknown[]): Promise<number> {
      const { rows } = await pool.query<IdRow>(sql, params);
      return rows[0].id;
    }

    beforeAll(async () => {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const users = await pool.query<IdRow>(
        `INSERT INTO users (email, password_hash, name, role) VALUES
           ($1, 'x', 'Constraint Instructor', 'instructor'),
           ($2, 'x', 'Constraint Student',    'student'),
           ($3, 'x', 'Constraint Other',      'student')
         RETURNING id`,
        [
          `constraint-i-${stamp}@example.test`,
          `constraint-s-${stamp}@example.test`,
          `constraint-o-${stamp}@example.test`,
        ],
      );
      [instructorId, studentId, otherStudentId] = users.rows.map((r) => r.id);

      courseId = await insertId(`INSERT INTO courses (title) VALUES ($1) RETURNING id`, [
        `constraints ${stamp}`,
      ]);
      weekId = await insertId(
        `INSERT INTO weeks (course_id, week_number, title) VALUES ($1, 1, 'constraints') RETURNING id`,
        [courseId],
      );
      lectureId = await insertId(
        `INSERT INTO lectures (week_id, lecture_number, title) VALUES ($1, 1, 'constraints') RETURNING id`,
        [weekId],
      );
      assignmentId = await insertId(
        `INSERT INTO assignments (week_id, title, description, due_at)
         VALUES ($1, 'constraints', 'constraints', now()) RETURNING id`,
        [weekId],
      );
      classId = await insertId(
        `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at)
         VALUES ($1, $2, 'constraints', now()) RETURNING id`,
        [weekId, instructorId],
      );
      presentationId = await insertId(
        `INSERT INTO presentations (creator_id, title, slides_json)
         VALUES ($1, 'constraints', '[]'::jsonb) RETURNING id`,
        [instructorId],
      );
    });

    afterAll(async () => {
      // Delete the COURSE, not the leaves: the cascade runs
      // course -> week -> {lecture, assignment, live_class} -> everything below.
      // Presentations hang off the creator, so the users delete takes those.
      await pool.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
        [instructorId, studentId, otherStudentId],
      ]);
      await pool.end();
    });

    // -----------------------------------------------------------------------
    // class_attendance — one row per (class, student)
    // -----------------------------------------------------------------------
    describe("class_attendance", () => {
      it("refuses a second attendance row for the same (class_id, student_id)", async () => {
        // GUARDS: double-join idempotency. The /join handler upserts on this
        // index; if the index were non-unique the upsert would silently insert a
        // duplicate and the class roster would double-count every reconnect.
        await expectAccepted(
          `INSERT INTO class_attendance (class_id, student_id) VALUES ($1, $2)`,
          [classId, studentId],
        );
        await expectRejected(
          `INSERT INTO class_attendance (class_id, student_id) VALUES ($1, $2)`,
          [classId, studentId],
          { code: UNIQUE_VIOLATION, constraint: "class_attendance_class_student_idx" },
        );
        await pool.query(`DELETE FROM class_attendance WHERE class_id = $1`, [classId]);
      });

      it("refuses a participation score above 100", async () => {
        await expectRejected(
          `INSERT INTO class_attendance (class_id, student_id, participation_score)
           VALUES ($1, $2, 101)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_attendance_participation_in_range" },
        );
      });

      it("refuses a negative participation score", async () => {
        await expectRejected(
          `INSERT INTO class_attendance (class_id, student_id, participation_score)
           VALUES ($1, $2, -1)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_attendance_participation_in_range" },
        );
      });

      it("refuses a negative time_present_minutes", async () => {
        await expectRejected(
          `INSERT INTO class_attendance (class_id, student_id, time_present_minutes)
           VALUES ($1, $2, -5)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_attendance_time_present_non_negative" },
        );
      });

      it("refuses left_at earlier than joined_at", async () => {
        await expectRejected(
          `INSERT INTO class_attendance (class_id, student_id, joined_at, left_at)
           VALUES ($1, $2, now(), now() - interval '1 hour')`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_attendance_left_after_joined" },
        );
      });

      it("refuses a negative message counter", async () => {
        await expectRejected(
          `INSERT INTO class_attendance (class_id, student_id, messages_sent)
           VALUES ($1, $2, -1)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_attendance_counters_non_negative" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // class_qa_votes — composite primary key
    // -----------------------------------------------------------------------
    describe("class_qa_votes", () => {
      let questionId = 0;

      beforeAll(async () => {
        questionId = await insertId(
          `INSERT INTO class_qa (class_id, student_id, question)
           VALUES ($1, $2, 'constraint question') RETURNING id`,
          [classId, studentId],
        );
      });

      it("refuses a second vote by the same user on the same question", async () => {
        // REGRESSION GUARD for the double-upvote bug fixed in this wave: the vote
        // endpoint originally incremented class_qa.upvotes without recording who
        // voted, so one student could upvote a question repeatedly and dominate
        // the "most upvoted" ordering the instructor triages by. The composite PK
        // is the durable half of that fix; this test proves the PK is real.
        await expectAccepted(
          `INSERT INTO class_qa_votes (question_id, user_id) VALUES ($1, $2)`,
          [questionId, studentId],
        );
        await expectRejected(
          `INSERT INTO class_qa_votes (question_id, user_id) VALUES ($1, $2)`,
          [questionId, studentId],
          { code: UNIQUE_VIOLATION, constraint: "class_qa_votes_question_id_user_id_pk" },
        );
      });

      it("allows a DIFFERENT user to vote on the same question", async () => {
        // The negative test above is only meaningful if the PK is not simply
        // rejecting every second vote. This is the control case.
        await expectAccepted(
          `INSERT INTO class_qa_votes (question_id, user_id) VALUES ($1, $2)`,
          [questionId, otherStudentId],
        );
      });
    });

    // -----------------------------------------------------------------------
    // class_qa
    // -----------------------------------------------------------------------
    describe("class_qa", () => {
      it("refuses answered_at set while is_answered is false", async () => {
        // The two columns are a single fact stored twice. The UI reads
        // is_answered; the notification job reads answered_at. Letting them
        // disagree means a question shows as open in one place and answered in
        // the other.
        await expectRejected(
          `INSERT INTO class_qa (class_id, student_id, question, is_answered, answered_at)
           VALUES ($1, $2, 'q', false, now())`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_qa_answered_consistent" },
        );
      });

      it("refuses is_answered true with no answered_at", async () => {
        await expectRejected(
          `INSERT INTO class_qa (class_id, student_id, question, is_answered, answered_at)
           VALUES ($1, $2, 'q', true, NULL)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_qa_answered_consistent" },
        );
      });

      it("refuses negative upvotes", async () => {
        await expectRejected(
          `INSERT INTO class_qa (class_id, student_id, question, upvotes)
           VALUES ($1, $2, 'q', -1)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_qa_upvotes_non_negative" },
        );
      });

      it("refuses resolved_at earlier than created_at", async () => {
        await expectRejected(
          `INSERT INTO class_qa (class_id, student_id, question, created_at, resolved_at)
           VALUES ($1, $2, 'q', now(), now() - interval '1 hour')`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_qa_resolved_after_asked" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // class_chat
    // -----------------------------------------------------------------------
    describe("class_chat", () => {
      it("refuses deleted_at set while is_deleted is false", async () => {
        // Soft-delete consistency. The history endpoint filters on is_deleted;
        // an audit query reads deleted_at. A row where only one is set is a
        // message that is deleted for one reader and visible to the other.
        await expectRejected(
          `INSERT INTO class_chat (class_id, sender_id, message, is_deleted, deleted_at)
           VALUES ($1, $2, 'm', false, now())`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_chat_deleted_consistent" },
        );
      });

      it("refuses is_deleted true with no deleted_at", async () => {
        await expectRejected(
          `INSERT INTO class_chat (class_id, sender_id, message, is_deleted, deleted_at)
           VALUES ($1, $2, 'm', true, NULL)`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_chat_deleted_consistent" },
        );
      });

      it("refuses deleted_at earlier than created_at", async () => {
        await expectRejected(
          `INSERT INTO class_chat (class_id, sender_id, message, is_deleted, created_at, deleted_at)
           VALUES ($1, $2, 'm', true, now(), now() - interval '1 hour')`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_chat_deleted_after_created" },
        );
      });

      it("refuses edited_at earlier than created_at", async () => {
        await expectRejected(
          `INSERT INTO class_chat (class_id, sender_id, message, created_at, edited_at)
           VALUES ($1, $2, 'm', now(), now() - interval '1 hour')`,
          [classId, studentId],
          { code: CHECK_VIOLATION, constraint: "class_chat_edited_after_created" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // live_classes
    // -----------------------------------------------------------------------
    describe("live_classes", () => {
      it("refuses ended_at earlier than started_at", async () => {
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, started_at, ended_at)
           VALUES ($1, $2, 'bad', now(), now(), now() - interval '1 hour')`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_ends_after_starts" },
        );
      });

      it("refuses ended_at exactly equal to started_at", async () => {
        // The CHECK is strict `>`, not `>=`. A zero-length class is a bug (a
        // double /end, or an /end that fired before /start committed), so the
        // strictness is deliberate — this test pins it so a later "relaxation"
        // to `>=` has to be an argued change rather than an accident.
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, started_at, ended_at)
           SELECT $1, $2, 'bad', now(), t, t FROM (SELECT now() AS t) s`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_ends_after_starts" },
        );
      });

      it("refuses a zero or negative duration", async () => {
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, duration_minutes)
           VALUES ($1, $2, 'bad', now(), 0)`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_duration_positive" },
        );
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, duration_minutes)
           VALUES ($1, $2, 'bad', now(), -30)`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_duration_positive" },
        );
      });

      it("refuses max_participants of zero", async () => {
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, max_participants)
           VALUES ($1, $2, 'bad', now(), 0)`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_max_participants_positive" },
        );
      });

      it("refuses an engagement score above 100", async () => {
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, engagement_score)
           VALUES ($1, $2, 'bad', now(), 100.01)`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_engagement_in_range" },
        );
      });

      it("refuses a negative attendance_count", async () => {
        await expectRejected(
          `INSERT INTO live_classes (week_id, instructor_id, title, scheduled_at, attendance_count)
           VALUES ($1, $2, 'bad', now(), -1)`,
          [weekId, instructorId],
          { code: CHECK_VIOLATION, constraint: "live_classes_attendance_non_negative" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // class_recordings
    // -----------------------------------------------------------------------
    describe("class_recordings", () => {
      it("refuses a second recording row for the same class", async () => {
        await expectAccepted(`INSERT INTO class_recordings (class_id) VALUES ($1)`, [classId]);
        await expectRejected(
          `INSERT INTO class_recordings (class_id) VALUES ($1)`,
          [classId],
          { code: UNIQUE_VIOLATION, constraint: "class_recordings_class_idx" },
        );
        await pool.query(`DELETE FROM class_recordings WHERE class_id = $1`, [classId]);
      });

      it("refuses a negative duration", async () => {
        await expectRejected(
          `INSERT INTO class_recordings (class_id, duration_seconds) VALUES ($1, -1)`,
          [classId],
          { code: CHECK_VIOLATION, constraint: "class_recordings_duration_non_negative" },
        );
      });

      it("refuses recording_ended_at earlier than recording_started_at", async () => {
        await expectRejected(
          `INSERT INTO class_recordings (class_id, recording_started_at, recording_ended_at)
           VALUES ($1, now(), now() - interval '1 hour')`,
          [classId],
          { code: CHECK_VIOLATION, constraint: "class_recordings_ends_after_starts" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // presentation_slides
    // -----------------------------------------------------------------------
    describe("presentation_slides", () => {
      it("refuses a duplicate slide number within one presentation", async () => {
        // GUARDS slide reordering: the editor rewrites slide_number in bulk, and
        // a reorder that computes the same index twice would otherwise persist
        // two slides claiming position 3 — after which the deck renders in
        // nondeterministic order.
        await expectAccepted(
          `INSERT INTO presentation_slides (presentation_id, slide_number, type)
           VALUES ($1, 1, 'content')`,
          [presentationId],
        );
        await expectRejected(
          `INSERT INTO presentation_slides (presentation_id, slide_number, type)
           VALUES ($1, 1, 'content')`,
          [presentationId],
          { code: UNIQUE_VIOLATION, constraint: "presentation_slides_number_idx" },
        );
        await pool.query(`DELETE FROM presentation_slides WHERE presentation_id = $1`, [
          presentationId,
        ]);
      });

      it("refuses slide number zero — decks are 1-indexed", async () => {
        await expectRejected(
          `INSERT INTO presentation_slides (presentation_id, slide_number, type)
           VALUES ($1, 0, 'content')`,
          [presentationId],
          { code: CHECK_VIOLATION, constraint: "presentation_slides_number_positive" },
        );
      });

      it("refuses a malformed hex colour", async () => {
        // The colour lands in a `style` attribute in the rendered deck. The
        // regex CHECK is the last line of defence against a stored value that
        // breaks out of the attribute, so a test that proves the regex actually
        // runs is a security test as much as a data-integrity one.
        await expectRejected(
          `INSERT INTO presentation_slides (presentation_id, slide_number, type, background_color)
           VALUES ($1, 2, 'content', 'red')`,
          [presentationId],
          { code: CHECK_VIOLATION, constraint: "presentation_slides_hex_colors" },
        );
      });

      it("refuses a 3-digit hex shorthand — the CHECK demands 6 digits", async () => {
        await expectRejected(
          `INSERT INTO presentation_slides (presentation_id, slide_number, type, text_color)
           VALUES ($1, 3, 'content', '#fff')`,
          [presentationId],
          { code: CHECK_VIOLATION, constraint: "presentation_slides_hex_colors" },
        );
      });

      it("accepts a well-formed 6-digit hex colour", async () => {
        // Control case: proves the regex is not rejecting everything.
        await expectAccepted(
          `INSERT INTO presentation_slides (presentation_id, slide_number, type, background_color, text_color)
           VALUES ($1, 4, 'content', '#0A1B2C', '#ffffff')`,
          [presentationId],
        );
        await pool.query(`DELETE FROM presentation_slides WHERE presentation_id = $1`, [
          presentationId,
        ]);
      });
    });

    // -----------------------------------------------------------------------
    // presentations
    // -----------------------------------------------------------------------
    describe("presentations", () => {
      it("refuses is_published true with no published_at", async () => {
        await expectRejected(
          `INSERT INTO presentations (creator_id, title, slides_json, is_published, published_at)
           VALUES ($1, 'p', '[]'::jsonb, true, NULL)`,
          [instructorId],
          { code: CHECK_VIOLATION, constraint: "presentations_published_consistent" },
        );
      });

      it("refuses published_at set while is_published is false", async () => {
        await expectRejected(
          `INSERT INTO presentations (creator_id, title, slides_json, is_published, published_at)
           VALUES ($1, 'p', '[]'::jsonb, false, now())`,
          [instructorId],
          { code: CHECK_VIOLATION, constraint: "presentations_published_consistent" },
        );
      });

      it("refuses a negative view counter", async () => {
        await expectRejected(
          `INSERT INTO presentations (creator_id, title, slides_json, view_count)
           VALUES ($1, 'p', '[]'::jsonb, -1)`,
          [instructorId],
          { code: CHECK_VIOLATION, constraint: "presentations_counters_non_negative" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // presentation_submissions
    // -----------------------------------------------------------------------
    describe("presentation_submissions", () => {
      it("refuses a score above 100", async () => {
        await expectRejected(
          `INSERT INTO presentation_submissions
             (assignment_id, presentation_id, student_id, score, graded_at)
           VALUES ($1, $2, $3, 101, now())`,
          [assignmentId, presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_submissions_score_in_range" },
        );
      });

      it("refuses a negative score", async () => {
        await expectRejected(
          `INSERT INTO presentation_submissions
             (assignment_id, presentation_id, student_id, score, graded_at)
           VALUES ($1, $2, $3, -1, now())`,
          [assignmentId, presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_submissions_score_in_range" },
        );
      });

      it("refuses a score with no graded_at — a grade with no grader event", async () => {
        await expectRejected(
          `INSERT INTO presentation_submissions
             (assignment_id, presentation_id, student_id, score)
           VALUES ($1, $2, $3, 80)`,
          [assignmentId, presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_submissions_grade_consistent" },
        );
      });

      it("refuses graded_at with no score", async () => {
        await expectRejected(
          `INSERT INTO presentation_submissions
             (assignment_id, presentation_id, student_id, graded_at)
           VALUES ($1, $2, $3, now())`,
          [assignmentId, presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_submissions_grade_consistent" },
        );
      });

      it("refuses graded_at earlier than submitted_at", async () => {
        await expectRejected(
          `INSERT INTO presentation_submissions
             (assignment_id, presentation_id, student_id, score, submitted_at, graded_at)
           VALUES ($1, $2, $3, 80, now(), now() - interval '1 hour')`,
          [assignmentId, presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_submissions_graded_after_submitted" },
        );
      });

      it("refuses a negative video duration", async () => {
        await expectRejected(
          `INSERT INTO presentation_submissions
             (assignment_id, presentation_id, student_id, video_duration_seconds)
           VALUES ($1, $2, $3, -1)`,
          [assignmentId, presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_submissions_duration_non_negative" },
        );
      });

      it("refuses a second submission by the same student for one assignment", async () => {
        await expectAccepted(
          `INSERT INTO presentation_submissions (assignment_id, presentation_id, student_id)
           VALUES ($1, $2, $3)`,
          [assignmentId, presentationId, studentId],
        );
        await expectRejected(
          `INSERT INTO presentation_submissions (assignment_id, presentation_id, student_id)
           VALUES ($1, $2, $3)`,
          [assignmentId, presentationId, studentId],
          {
            code: UNIQUE_VIOLATION,
            constraint: "presentation_submissions_assignment_student_idx",
          },
        );
        await pool.query(`DELETE FROM presentation_submissions WHERE assignment_id = $1`, [
          assignmentId,
        ]);
      });
    });

    // -----------------------------------------------------------------------
    // presentation_feedback
    // -----------------------------------------------------------------------
    describe("presentation_feedback", () => {
      it("refuses a rating of zero — the scale starts at 1", async () => {
        await expectRejected(
          `INSERT INTO presentation_feedback (presentation_id, from_user_id, to_user_id, comment, rating)
           VALUES ($1, $2, $3, 'c', 0)`,
          [presentationId, studentId, otherStudentId],
          { code: CHECK_VIOLATION, constraint: "presentation_feedback_rating_in_range" },
        );
      });

      it("refuses a rating above 5", async () => {
        await expectRejected(
          `INSERT INTO presentation_feedback (presentation_id, from_user_id, to_user_id, comment, rating)
           VALUES ($1, $2, $3, 'c', 6)`,
          [presentationId, studentId, otherStudentId],
          { code: CHECK_VIOLATION, constraint: "presentation_feedback_rating_in_range" },
        );
      });

      it("refuses self-addressed feedback typed as 'peer'", async () => {
        // Peer-review integrity: a student rating themselves through the peer
        // channel would inflate the peer average that instructors read.
        await expectRejected(
          `INSERT INTO presentation_feedback (presentation_id, from_user_id, to_user_id, comment, feedback_type)
           VALUES ($1, $2, $2, 'c', 'peer')`,
          [presentationId, studentId],
          { code: CHECK_VIOLATION, constraint: "presentation_feedback_self_typed" },
        );
      });

      it("refuses feedback typed 'self' that is addressed to someone else", async () => {
        await expectRejected(
          `INSERT INTO presentation_feedback (presentation_id, from_user_id, to_user_id, comment, feedback_type)
           VALUES ($1, $2, $3, 'c', 'self')`,
          [presentationId, studentId, otherStudentId],
          { code: CHECK_VIOLATION, constraint: "presentation_feedback_self_typed" },
        );
      });

      it("accepts genuine self-reflection typed 'self'", async () => {
        await expectAccepted(
          `INSERT INTO presentation_feedback (presentation_id, from_user_id, to_user_id, comment, feedback_type)
           VALUES ($1, $2, $2, 'c', 'self')`,
          [presentationId, studentId],
        );
        await pool.query(`DELETE FROM presentation_feedback WHERE presentation_id = $1`, [
          presentationId,
        ]);
      });
    });

    // -----------------------------------------------------------------------
    // interview_questions — the exactly-one-parent rule
    // -----------------------------------------------------------------------
    describe("interview_questions", () => {
      const INSERT = `INSERT INTO interview_questions
        (lecture_id, week_id, title, question_text, sample_answer, question_order)
        VALUES ($1, $2, 'q', 'qt', 'sa', $3)`;

      it("refuses a question with NEITHER a lecture nor a week", async () => {
        await expectRejected(
          INSERT,
          [null, null, 0],
          { code: CHECK_VIOLATION, constraint: "interview_questions_exactly_one_parent" },
        );
      });

      it("refuses a question with BOTH a lecture and a week", async () => {
        await expectRejected(
          INSERT,
          [lectureId, weekId, 0],
          { code: CHECK_VIOLATION, constraint: "interview_questions_exactly_one_parent" },
        );
      });

      it("refuses a duplicate question_order within one lecture", async () => {
        await expectAccepted(INSERT, [lectureId, null, 1]);
        await expectRejected(
          INSERT,
          [lectureId, null, 1],
          { code: UNIQUE_VIOLATION, constraint: "interview_questions_lecture_order_idx" },
        );
      });

      it("refuses a duplicate question_order within one week", async () => {
        await expectAccepted(INSERT, [null, weekId, 1]);
        await expectRejected(
          INSERT,
          [null, weekId, 1],
          { code: UNIQUE_VIOLATION, constraint: "interview_questions_week_order_idx" },
        );
      });

      it("allows the SAME order under a lecture and under a week independently", async () => {
        // Proves the two indexes are PARTIAL and do not collide. If either had
        // been created without its WHERE clause, the lecture index would see
        // every week-parented row as (NULL, order) and the two families would
        // fight over the same slots.
        await expectAccepted(INSERT, [lectureId, null, 7]);
        await expectAccepted(INSERT, [null, weekId, 7]);
        await pool.query(`DELETE FROM interview_questions WHERE lecture_id = $1 OR week_id = $2`, [
          lectureId,
          weekId,
        ]);
      });

      it("refuses a negative question_order", async () => {
        await expectRejected(
          INSERT,
          [lectureId, null, -1],
          { code: CHECK_VIOLATION, constraint: "interview_questions_order_non_negative" },
        );
      });
    });

    // -----------------------------------------------------------------------
    // practice_problems / assignment_samples / lecture_visualizations
    // -----------------------------------------------------------------------
    describe("learning-enhancement ordering", () => {
      const PRACTICE = `INSERT INTO practice_problems
        (lecture_id, title, problem_context, problem_statement, hints, problem_order)
        VALUES ($1, 'p', 'ctx', 'stmt', '[]'::jsonb, $2)`;

      it("refuses a negative practice problem order", async () => {
        await expectRejected(
          PRACTICE,
          [lectureId, -1],
          { code: CHECK_VIOLATION, constraint: "practice_problems_order_non_negative" },
        );
      });

      it("refuses two practice problems at the same order in one lecture", async () => {
        await expectAccepted(PRACTICE, [lectureId, 1]);
        await expectRejected(
          PRACTICE,
          [lectureId, 1],
          { code: UNIQUE_VIOLATION, constraint: "practice_problems_order_idx" },
        );
        await pool.query(`DELETE FROM practice_problems WHERE lecture_id = $1`, [lectureId]);
      });

      it("refuses two assignment samples at the same order", async () => {
        const SAMPLE = `INSERT INTO assignment_samples (assignment_id, title, sample_order)
                        VALUES ($1, 's', 1)`;
        await expectAccepted(SAMPLE, [assignmentId]);
        await expectRejected(
          SAMPLE,
          [assignmentId],
          { code: UNIQUE_VIOLATION, constraint: "assignment_samples_order_idx" },
        );
        await pool.query(`DELETE FROM assignment_samples WHERE assignment_id = $1`, [assignmentId]);
      });

      it("refuses a zero-width visualization", async () => {
        await expectRejected(
          `INSERT INTO lecture_visualizations (lecture_id, type, title, width_px)
           VALUES ($1, 'diagram', 'v', 0)`,
          [lectureId],
          { code: CHECK_VIOLATION, constraint: "lecture_visualizations_size_positive" },
        );
      });

      it("refuses two visualizations at the same order in one lecture", async () => {
        const VIZ = `INSERT INTO lecture_visualizations (lecture_id, type, title, order_index)
                     VALUES ($1, 'diagram', 'v', 2)`;
        await expectAccepted(VIZ, [lectureId]);
        await expectRejected(
          VIZ,
          [lectureId],
          { code: UNIQUE_VIOLATION, constraint: "lecture_visualizations_order_idx" },
        );
        await pool.query(`DELETE FROM lecture_visualizations WHERE lecture_id = $1`, [lectureId]);
      });
    });
  });
}
