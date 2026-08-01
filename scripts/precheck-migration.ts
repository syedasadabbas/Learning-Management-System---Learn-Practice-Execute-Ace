// =============================================================================
// PRE-MIGRATION SAFETY CHECK — would a new UNIQUE index fail on existing rows?
// -----------------------------------------------------------------------------
// Owner: shared-contracts. Read-only: writes nothing, safe against any database.
//
// WHY THIS EXISTS
// An additive migration is usually safe by construction — a new nullable column
// or a new table cannot conflict with anything already stored. A new UNIQUE
// index is the exception: it is validated against every existing row, so it
// either succeeds or aborts the whole migration partway through. On a live
// database that is a bad way to find out.
//
// `drizzle-kit migrate` gives no dry run, so this script answers the one
// question the generated SQL cannot: does the data already satisfy the
// constraint? Run it before applying any migration that adds a unique index.
//
// Exit code 0 = safe to apply. 1 = duplicates exist, resolve them first.
// =============================================================================

import "dotenv/config";

import { pool } from "../src/db";

interface UniqueCheck {
  /** Human-readable name of the index being added. */
  label: string;
  /** Selects one row per duplicate GROUP, so an empty result means safe. */
  sql: string;
}

/**
 * The unique indexes introduced by the add-on migration.
 *
 * `quiz_attempts (student_id, quiz_id, attempt_number)` is what makes the
 * grand quiz's one-attempt rule an integrity constraint rather than a
 * convention — see invariant I1 in docs/GRAND_QUIZ_INVARIANTS.md.
 *
 * `answers (attempt_id, question_id)` is what lets autosave be an idempotent
 * upsert: a student typing in question 7 for the fifth time must update one
 * row, not accumulate five.
 */
const CHECKS: UniqueCheck[] = [
  {
    label: "quiz_attempts (student_id, quiz_id, attempt_number)",
    sql: `SELECT student_id, quiz_id, attempt_number, count(*) AS n
            FROM quiz_attempts
           GROUP BY 1, 2, 3
          HAVING count(*) > 1`,
  },
  {
    label: "answers (attempt_id, question_id)",
    sql: `SELECT attempt_id, question_id, count(*) AS n
            FROM answers
           GROUP BY 1, 2
          HAVING count(*) > 1`,
  },
];

async function main(): Promise<void> {
  let failures = 0;

  for (const check of CHECKS) {
    const { rows } = await pool.query(check.sql);
    if (rows.length === 0) {
      console.log(`PASS  ${check.label}`);
      continue;
    }
    failures += 1;
    console.log(`FAIL  ${check.label} — ${rows.length} duplicate group(s):`);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  }

  const { rows: counts } = await pool.query(
    `SELECT (SELECT count(*)::int FROM quiz_attempts) AS attempts,
            (SELECT count(*)::int FROM answers)       AS answers,
            (SELECT count(*)::int FROM quizzes)       AS quizzes,
            (SELECT count(*)::int FROM questions)     AS questions`,
  );

  console.log(`\nexisting rows: ${JSON.stringify(counts[0])}`);
  console.log(
    failures === 0
      ? "\nSAFE — every new unique index is already satisfied by the stored data."
      : "\nNOT SAFE — resolve the duplicates above before migrating.",
  );

  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
