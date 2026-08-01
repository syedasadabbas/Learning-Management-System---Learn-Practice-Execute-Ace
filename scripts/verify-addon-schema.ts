// =============================================================================
// POST-MIGRATION VERIFICATION — does the database actually match the seam?
// -----------------------------------------------------------------------------
// Owner: shared-contracts. Read-only.
//
// Wave 0 established the habit of confirming a migration with an INDEPENDENT
// client rather than trusting the migration tool's own success message: the tool
// reports what it sent, not what the server now holds. This does the same for
// the add-on migration, and additionally asserts the two properties that make it
// safe for data already in the table:
//
//   * every existing quiz kept kind = 'practice';
//   * every existing question kept points = 1.
//
// If either drifts, an exam weighting or an unlock rule is about to be computed
// from a wrong default.
// =============================================================================

import "dotenv/config";

import { pool } from "../src/db";

interface Check {
  label: string;
  sql: string;
  /** Bind parameters for this statement. Explicit per check — inferring which
   *  array a statement wanted produced an unused $1 and a 42P18 from Postgres. */
  params: unknown[];
  /** Passes when this returns true for the single result row. */
  ok: (row: Record<string, unknown>) => boolean;
  detail?: (row: Record<string, unknown>) => string;
}

const EXPECTED_NEW_TABLES = [
  "auth_tokens",
  "coding_attempts",
  "coding_problem_tests",
  "coding_problems",
  "learning_modules",
  "learning_progress",
  "learning_steps",
  "topic_videos",
];

const EXPECTED_NEW_COLUMNS: Array<[string, string]> = [
  ["quizzes", "kind"],
  ["questions", "language"],
  ["questions", "starter_code"],
  ["questions", "points"],
  ["questions", "tests"],
  ["quiz_attempts", "deadline_at"],
  ["quiz_attempts", "auto_submitted"],
  ["answers", "code_answer"],
  ["answers", "awarded"],
  ["answers", "max_points"],
  ["lectures", "topic_key"],
];

const EXPECTED_NEW_INDEXES = [
  "answers_attempt_question_idx",
  "attempts_student_quiz_number_idx",
  "auth_tokens_hash_idx",
  "coding_problems_slug_idx",
  "learning_modules_slug_idx",
  "learning_progress_student_step_idx",
  "learning_steps_module_step_idx",
  "topic_videos_topic_video_idx",
];

const CHECKS: Check[] = [
  {
    label: `${EXPECTED_NEW_TABLES.length} new tables exist`,
    sql: `SELECT count(*)::int AS n FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY($1)`,
    params: [EXPECTED_NEW_TABLES],
    ok: (r) => r.n === EXPECTED_NEW_TABLES.length,
    detail: (r) => `${r.n}/${EXPECTED_NEW_TABLES.length}`,
  },
  {
    label: `${EXPECTED_NEW_COLUMNS.length} new columns exist`,
    // Two parallel arrays plus unnest() rather than a generated IN-list: one
    // placeholder pair per column made the statement's parameter numbering
    // depend on array order, which is exactly the kind of thing that silently
    // checks the wrong column.
    sql: `SELECT count(*)::int AS n
            FROM information_schema.columns c
            JOIN unnest($1::text[], $2::text[]) AS want(tbl, col)
              ON want.tbl = c.table_name AND want.col = c.column_name
           WHERE c.table_schema = 'public'`,
    params: [EXPECTED_NEW_COLUMNS.map(([t]) => t), EXPECTED_NEW_COLUMNS.map(([, c]) => c)],
    ok: (r) => r.n === EXPECTED_NEW_COLUMNS.length,
    detail: (r) => `${r.n}/${EXPECTED_NEW_COLUMNS.length}`,
  },
  {
    label: `${EXPECTED_NEW_INDEXES.length} new indexes exist`,
    sql: `SELECT count(*)::int AS n FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = ANY($1)`,
    params: [EXPECTED_NEW_INDEXES],
    ok: (r) => r.n === EXPECTED_NEW_INDEXES.length,
    detail: (r) => `${r.n}/${EXPECTED_NEW_INDEXES.length}`,
  },
  {
    label: "question_type enum carries code_write + code_fix",
    sql: `SELECT count(*)::int AS n FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'question_type' AND e.enumlabel IN ('code_write','code_fix')`,
    params: [],
    ok: (r) => r.n === 2,
    detail: (r) => `${r.n}/2`,
  },
  // The next two checked that the migration's DEFAULTS had been applied to rows
  // that predated it: every quiz 'practice', every question worth 1 point. That
  // was the right assertion for the hour after migrating, and it went permanently
  // red the moment the wave's own seed data legitimately overwrote those defaults
  // — 4 grand quizzes and 200 exam questions at 2/3/8 points. A verifier that
  // says "the database does not match the schema" about a healthy database
  // teaches people to ignore it, and then a real drift ships unnoticed.
  //
  // Scoped to the PRACTICE curriculum, they mean what they always meant: the
  // owner's four quizzes and forty MCQs are untouched by the add-on wave.
  {
    label: "the owner's original quizzes are all still kind = practice",
    sql: `SELECT count(*)::int AS n
            FROM quizzes
           WHERE kind <> 'practice'
             AND attempts_allowed = 3
             AND time_limit_minutes IS NULL`,
    params: [],
    ok: (r) => r.n === 0,
    detail: (r) => `${r.n} practice-shaped row(s) no longer 'practice'`,
  },
  {
    label: "every practice-quiz question is still worth 1 point",
    sql: `SELECT count(*)::int AS n
            FROM questions q
            JOIN quizzes z ON z.id = q.quiz_id
           WHERE z.kind = 'practice' AND q.points <> 1`,
    params: [],
    ok: (r) => r.n === 0,
    detail: (r) => `${r.n} practice question(s) not worth 1`,
  },
  {
    label: "grand exams are one-attempt and time-limited",
    // Positive assertion about the add-on data, replacing the negative one the
    // seed made obsolete: an exam row that lost attemptsAllowed = 1 would hand a
    // student a second sitting of something the syllabus says is one-shot.
    sql: `SELECT count(*)::int AS n
            FROM quizzes
           WHERE kind = 'grand'
             AND (attempts_allowed <> 1 OR time_limit_minutes IS NULL)`,
    params: [],
    ok: (r) => r.n === 0,
    detail: (r) => `${r.n} grand exam(s) not 1-attempt/timed`,
  },
  {
    label: "no answer row breaks the no-negative-marking bound (I5)",
    sql: `SELECT count(*)::int AS n FROM answers WHERE awarded < 0 OR awarded > max_points`,
    params: [],
    ok: (r) => r.n === 0,
    detail: (r) => `${r.n} row(s) outside [0, max_points]`,
  },
];

async function main(): Promise<void> {
  let failed = 0;

  for (const check of CHECKS) {
    const { rows } = await pool.query(check.sql, check.params);
    const row = rows[0] as Record<string, unknown>;
    const passed = check.ok(row);
    if (!passed) failed += 1;
    const suffix = check.detail ? ` (${check.detail(row)})` : "";
    console.log(`${passed ? "PASS" : "FAIL"}  ${check.label}${suffix}`);
  }

  console.log(
    failed === 0
      ? "\nSchema matches the seam; existing rows kept their defaults."
      : `\n${failed} check(s) FAILED — the database does not match src/db/schema.ts.`,
  );

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
