// =============================================================================
// OPERATOR VISIBILITY — persist and read the LAST ingest result per assignment.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// WHAT THIS FIXES
//
// Ingestion was already careful: `fetchPublishedCsv` names every transport
// failure, `parseSubmissionCsv` names every unusable-sheet condition, and every
// dropped row carries a closed-set `SkipReason` with a human-readable detail. All
// of it went to `console.info` / `console.warn` and nowhere else. The scheduled cron
// runs on Vercel, so "somewhere else" means a platform log an instructor has no
// access to and an admin will not read. A sheet that was published as a web PAGE
// instead of CSV would have reported itself perfectly, every run, to nobody, while
// every student in the cohort appeared not to have submitted.
//
// So the report is written to the database and rendered at
// /assignments/ingest-status. The console lines are KEPT — they are what you have
// when the database write is the thing that failed.
//
// FAIL-SOFT, DELIBERATELY
//
// `recordIngestRun` never throws and never propagates. Two reasons, and the second
// is the important one:
//
//   1. The table may not exist. `submission_ingest_runs` is additive and arrived
//      after the seam was frozen (src/db/schema.submissions.ts explains why it is
//      a sibling module); a checkout that has not run `npm run db:push` or
//      scripts/migrate-ingest-runs.ts would otherwise have every ingest fail with
//      a 42P01 for the sake of an audit line.
//   2. The rows are ALREADY COMMITTED when this runs. Ingestion writes one
//      statement per row precisely so a bad row costs one row (see the header of
//      ingest.ts). Letting the report — a description of work that is already done
//      and already visible to students — turn a successful run into a 500 would
//      invert that.
//
// The cost of fail-soft is that a missing report is ambiguous between "never ran"
// and "ran but could not be recorded". The page states that ambiguity instead of
// resolving it silently, and the console line is the tie-breaker.
// =============================================================================

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, weeks } from "@/db/schema";
import { submissionIngestRuns } from "@/db/schema.submissions";

import {
  MAX_STORED_SKIPPED_ROWS,
  selectSkippedSample,
  summariseReport,
} from "./ingest-status-view";
import { isStandInUrl } from "./stand-in";
import type { IngestReport, SkippedRow } from "./types";

/** Who asked for the run. Mirrors the two route handlers that can trigger one. */
export type IngestTrigger = "manual" | "cron";

/**
 * Persist one run as THE last run for its assignment.
 *
 * `onConflictDoUpdate` on the unique `assignment_id`, so the table stays one row
 * per assignment. Never throws — see the header.
 */
export async function recordIngestRun(input: {
  report: IngestReport;
  triggeredBy: IngestTrigger;
  /** The URL the run actually read, so the row can say whether Google was involved. */
  sheetUrl: string | null | undefined;
  /** Injectable clock, so a test can assert the timestamp it wrote. */
  now?: Date;
}): Promise<boolean> {
  const { report, triggeredBy } = input;
  const url = (input.sheetUrl ?? "").trim();
  const sheetSource = url === "" ? "unset" : isStandInUrl(url) ? "stand-in" : "configured";

  const values = {
    assignmentId: report.assignmentId,
    ranAt: input.now ?? new Date(),
    triggeredBy,
    sheetSource,
    aborted: report.aborted,
    detail: summariseReport(report),
    rowsSeen: report.rowsSeen,
    inserted: report.inserted,
    updated: report.updated,
    unchanged: report.unchanged,
    skippedCount: report.skipped.length,
    skipReasonCounts: report.skipReasonCounts,
    skippedSample: selectSkippedSample(report.skipped),
    durationMs: report.durationMs,
  };

  try {
    await db
      .insert(submissionIngestRuns)
      .values(values)
      .onConflictDoUpdate({
        target: submissionIngestRuns.assignmentId,
        set: {
          ranAt: values.ranAt,
          triggeredBy: values.triggeredBy,
          sheetSource: values.sheetSource,
          aborted: values.aborted,
          detail: values.detail,
          rowsSeen: values.rowsSeen,
          inserted: values.inserted,
          updated: values.updated,
          unchanged: values.unchanged,
          skippedCount: values.skippedCount,
          skipReasonCounts: values.skipReasonCounts,
          skippedSample: values.skippedSample,
          durationMs: values.durationMs,
        },
      });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[submissions/ingest-log] could not record the run for assignment ` +
        `${report.assignmentId}: ${message}. The ingest itself is unaffected; run ` +
        "npx tsx scripts/migrate-ingest-runs.ts if the table is missing.",
    );
    return false;
  }
}

/** One assignment plus its last ingest result, for the operator surface. */
export type IngestStatusRow = {
  assignmentId: number;
  assignmentTitle: string;
  weekNumber: number;
  /** True when a URL is stored at all. False means nothing can ever be ingested. */
  sheetConfigured: boolean;
  /** Whether the STORED url is this app's stand-in. Independent of any past run. */
  sheetIsStandIn: boolean;
  /** Null when this assignment has never recorded a run. */
  lastRun: {
    ranAt: Date;
    triggeredBy: string;
    sheetSource: string;
    aborted: string | null;
    detail: string | null;
    rowsSeen: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skippedCount: number;
    skipReasonCounts: Partial<Record<string, number>>;
    skippedSample: SkippedRow[];
    durationMs: number;
  } | null;
};

/** Coerce the jsonb columns defensively — they are `unknown` at the type level. */
function toSkipCounts(value: unknown): Partial<Record<string, number>> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<string, number>> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function toSkippedSample(value: unknown): SkippedRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is SkippedRow =>
      row != null &&
      typeof row === "object" &&
      typeof (row as SkippedRow).reason === "string" &&
      typeof (row as SkippedRow).rowNumber === "number",
  );
}

/**
 * Every assignment with its last ingest result, ordered by week.
 *
 * A LEFT JOIN, so an assignment that has NEVER been ingested still appears with
 * `lastRun: null`. That is the single most important row on the surface: an
 * assignment nobody has ever swept is indistinguishable from a healthy one if it
 * is simply absent from the list.
 *
 * Returns an empty array if the run table does not exist, rather than throwing —
 * same fail-soft rule as the writer, so a page that shows nothing is still a page.
 */
export async function getIngestStatus(): Promise<{ rows: IngestStatusRow[]; available: boolean }> {
  try {
    const rows = await db
      .select({
        assignmentId: assignments.id,
        assignmentTitle: assignments.title,
        weekNumber: weeks.weekNumber,
        sheetUrl: assignments.googleSheetCsvUrl,
        ranAt: submissionIngestRuns.ranAt,
        triggeredBy: submissionIngestRuns.triggeredBy,
        sheetSource: submissionIngestRuns.sheetSource,
        aborted: submissionIngestRuns.aborted,
        detail: submissionIngestRuns.detail,
        rowsSeen: submissionIngestRuns.rowsSeen,
        inserted: submissionIngestRuns.inserted,
        updated: submissionIngestRuns.updated,
        unchanged: submissionIngestRuns.unchanged,
        skippedCount: submissionIngestRuns.skippedCount,
        skipReasonCounts: submissionIngestRuns.skipReasonCounts,
        skippedSample: submissionIngestRuns.skippedSample,
        durationMs: submissionIngestRuns.durationMs,
      })
      .from(assignments)
      .innerJoin(weeks, eq(assignments.weekId, weeks.id))
      .leftJoin(submissionIngestRuns, eq(submissionIngestRuns.assignmentId, assignments.id))
      .orderBy(weeks.weekNumber, desc(assignments.dueAt));

    return {
      available: true,
      rows: rows.map((row) => ({
        assignmentId: row.assignmentId,
        assignmentTitle: row.assignmentTitle,
        weekNumber: row.weekNumber,
        sheetConfigured: (row.sheetUrl ?? "").trim() !== "",
        sheetIsStandIn: isStandInUrl(row.sheetUrl),
        lastRun:
          row.ranAt == null
            ? null
            : {
                ranAt: row.ranAt,
                triggeredBy: row.triggeredBy ?? "unknown",
                sheetSource: row.sheetSource ?? "unknown",
                aborted: row.aborted ?? null,
                detail: row.detail ?? null,
                rowsSeen: row.rowsSeen ?? 0,
                inserted: row.inserted ?? 0,
                updated: row.updated ?? 0,
                unchanged: row.unchanged ?? 0,
                skippedCount: row.skippedCount ?? 0,
                skipReasonCounts: toSkipCounts(row.skipReasonCounts),
                skippedSample: toSkippedSample(row.skippedSample),
                durationMs: row.durationMs ?? 0,
              },
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[submissions/ingest-log] could not read ingest status: ${message}`);
    return { available: false, rows: [] };
  }
}

// Re-exported so a caller that already imports the writer does not need to know
// the pure helpers live in a sibling module.
export { MAX_STORED_SKIPPED_ROWS, selectSkippedSample, summariseReport };

