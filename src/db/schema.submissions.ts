// =============================================================================
// SUBMISSIONS-STREAM TABLES — the ingest-run record. Owner: submissions stream.
// -----------------------------------------------------------------------------
// WHY A SIBLING MODULE RATHER THAN AN APPEND TO src/db/schema.ts
//
// schema.ts says it plainly at line 12 of drizzle.config.ts: "a stream that needs
// a table of its own adds a sibling module and one entry here rather than
// appending to the hot file, which is how two agents' appends collide in the same
// commit." src/db/schema.access.ts is the existing precedent. This file is the
// second, and it is registered in drizzle.config.ts's `schema` array so that
// `drizzle-kit push` and `generate` see it — a table declared outside that array
// would be treated as unknown and DROPPED by the next push.
//
// WHY THE TABLE EXISTS AT ALL
//
// Ingestion is unattended. It runs hourly from Vercel cron (vercel.json) and
// writes its outcome to `console.info`, which on a serverless deployment means a
// log line nobody reads. Every failure mode the parser and the fetcher are careful
// to report — a sheet published as HTML instead of CSV, a header row whose
// question text was edited past recognition, a respondent whose email matches no
// student — was therefore INVISIBLE to the only two people who can fix it, the
// instructor and the admin. A pipeline that fails invisibly has not been made
// robust by adding more skip reasons to it; the reasons have to arrive somewhere a
// human looks.
//
// ONE ROW PER ASSIGNMENT, NOT A HISTORY
//
// `assignment_id` is UNIQUE and each run UPSERTs over it, so this table holds "the
// last ingest result per assignment" and nothing else. A history table would need
// a retention rule, and an hourly cron across four assignments would write ~35 000
// rows a year for a surface whose entire question is "did the most recent run
// work?". The previous run is not diagnostically interesting once the current one
// has the same answer; when it differs, the operator is looking at the surface
// already.
//
// NOTHING IN THIS TABLE IS AUTHORITATIVE. It is a report about work that was
// already committed to `submissions`. Recording it is best-effort and its failure
// is swallowed (see recordIngestRun in src/lib/submissions/ingest-log.ts): losing
// the audit line must never roll back an ingest the students can already see.
// =============================================================================

import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { assignments } from "./schema";

export const submissionIngestRuns = pgTable(
  "submission_ingest_runs",
  {
    id: serial("id").primaryKey(),
    /**
     * The assignment whose sheet was read. CASCADE on delete: this row is a
     * report about that assignment and is meaningless without it, unlike a
     * submission (which a cascade would also remove, but which carries a grade).
     */
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    /** When the run finished. Named `ran_at` rather than `created_at` because an UPSERT rewrites it. */
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * "manual" (an instructor pressed re-ingest) or "cron" (the hourly sweep).
     * varchar, not a pgEnum: an enum here would be a migration in the shared
     * enum namespace for a diagnostic label, and an unrecognised value is
     * rendered verbatim rather than crashing the page.
     */
    triggeredBy: varchar("triggered_by", { length: 16 }).notNull(),
    /**
     * Whether the URL the run read was an instructor-supplied one or this
     * repository's own stand-in. Stored, not derived at read time, because the
     * URL can change between the run and someone looking at the report — and a
     * report that silently relabels a past run is worse than no report.
     */
    sheetSource: varchar("sheet_source", { length: 16 }).notNull(),
    /** `RunAbortReason` when the run was a no-op, NULL when it parsed rows. */
    aborted: varchar("aborted", { length: 32 }),
    /** The abort's human-readable explanation, or a summary line. Never holds the sheet URL — it is a capability token. */
    detail: text("detail"),
    rowsSeen: integer("rows_seen").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    /** `Partial<Record<SkipReason, number>>` — the aggregatable summary. */
    skipReasonCounts: jsonb("skip_reason_counts").notNull().default({}),
    /**
     * The individual skipped rows, TRUNCATED before write (see
     * MAX_STORED_SKIPPED_ROWS). A cohort that all mistypes the same thing would
     * otherwise put 80 objects in one jsonb column every hour; the counts above
     * carry the aggregate, and the samples exist to show an operator what one
     * looks like.
     */
    skippedSample: jsonb("skipped_sample").notNull().default([]),
    /** Wall-clock duration of the run in milliseconds (metric units, per house rules). */
    durationMs: integer("duration_ms").notNull().default(0),
  },
  (t) => ({
    /**
     * THE UPSERT ARBITER. `ON CONFLICT` needs a single unique constraint to name,
     * and this being unique is what makes the table "the last run" rather than an
     * unbounded log. Removing it does not degrade the surface, it changes what the
     * surface means.
     */
    assignmentIdx: uniqueIndex("submission_ingest_runs_assignment_idx").on(t.assignmentId),
  }),
);

export type SubmissionIngestRun = typeof submissionIngestRuns.$inferSelect;
export type NewSubmissionIngestRun = typeof submissionIngestRuns.$inferInsert;
