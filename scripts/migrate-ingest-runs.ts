// =============================================================================
// MIGRATION — create `submission_ingest_runs`. Owner: submissions stream.
// -----------------------------------------------------------------------------
// WHY THIS EXISTS RATHER THAN `npm run db:push`
//
// `drizzle-kit push` diffs the WHOLE schema snapshot against the live database
// and applies everything it finds. On this repository that is not a safe thing to
// run for one additive table: nine streams share one database, drizzle.config.ts
// sets `strict: true` (so push wants an interactive confirmation, which a
// non-interactive agent cannot give), and any pending change another stream has
// committed to src/db/schema.ts would be applied as a side effect of adding this
// one table. So this script sends exactly the one statement, idempotently.
//
// `db:push` remains the canonical path for a fresh checkout: the table is
// declared in src/db/schema.submissions.ts and that file is listed in
// drizzle.config.ts's `schema` array, so a normal push creates it too. This script
// exists so an ALREADY-SEEDED database can be brought up to date without a full
// push, and it is safe to run any number of times.
//
// It is also NOT required for correctness. `recordIngestRun` swallows a write
// failure (src/lib/submissions/ingest-log.ts), so a database that has never seen
// this migration still ingests normally — it just has no operator report, and
// says so on the report page.
//
// Run with:  npx tsx scripts/migrate-ingest-runs.ts
// =============================================================================

import "dotenv/config";

import { pool } from "../src/db";

/**
 * One statement, `IF NOT EXISTS` throughout.
 *
 * Written as raw SQL rather than generated, so that what reaches the database is
 * reviewable here. It must stay in step with src/db/schema.submissions.ts;
 * `verifyShape` below is what actually enforces that rather than a comment asking
 * the next person to remember.
 */
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS submission_ingest_runs (
    id                  serial PRIMARY KEY,
    assignment_id       integer NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    ran_at              timestamptz NOT NULL DEFAULT now(),
    triggered_by        varchar(16) NOT NULL,
    sheet_source        varchar(16) NOT NULL,
    aborted             varchar(32),
    detail              text,
    rows_seen           integer NOT NULL DEFAULT 0,
    inserted            integer NOT NULL DEFAULT 0,
    updated             integer NOT NULL DEFAULT 0,
    unchanged           integer NOT NULL DEFAULT 0,
    skipped_count       integer NOT NULL DEFAULT 0,
    skip_reason_counts  jsonb NOT NULL DEFAULT '{}'::jsonb,
    skipped_sample      jsonb NOT NULL DEFAULT '[]'::jsonb,
    duration_ms         integer NOT NULL DEFAULT 0
  );
`;

const CREATE_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS submission_ingest_runs_assignment_idx
    ON submission_ingest_runs (assignment_id);
`;

/** Every column the ORM selects. A missing one is a silent runtime 42703. */
const EXPECTED_COLUMNS = [
  "id",
  "assignment_id",
  "ran_at",
  "triggered_by",
  "sheet_source",
  "aborted",
  "detail",
  "rows_seen",
  "inserted",
  "updated",
  "unchanged",
  "skipped_count",
  "skip_reason_counts",
  "skipped_sample",
  "duration_ms",
] as const;

async function verifyShape(): Promise<void> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'submission_ingest_runs'`,
  );
  const present = new Set(rows.map((r) => r.column_name));
  const missing = EXPECTED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `submission_ingest_runs exists but is missing: ${missing.join(", ")}. ` +
        "The table was created by an older revision of this script; drop it and re-run, " +
        "or add the columns by hand.",
    );
  }

  const { rows: idx } = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'submission_ingest_runs'`,
  );
  if (!idx.some((r) => r.indexname === "submission_ingest_runs_assignment_idx")) {
    throw new Error(
      "submission_ingest_runs_assignment_idx is absent. Without it the per-assignment " +
        "UPSERT has no conflict arbiter and the table becomes an unbounded log.",
    );
  }
}

async function main(): Promise<void> {
  await pool.query(CREATE_TABLE);
  await pool.query(CREATE_INDEX);
  await verifyShape();
  console.log("submission_ingest_runs is present and correctly shaped.");
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
