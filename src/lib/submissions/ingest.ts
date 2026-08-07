// =============================================================================
// INGESTION — write path from a published Google Sheet into `submissions`.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// Called by two route handlers with deliberately different authorization:
//   POST /api/assignments/:assignmentId/ingest   ROUTE_AUTH "instructor"
//   POST /api/cron/ingest-submissions            ROUTE_AUTH "cron" (CRON_SECRET)
// Neither is reachable anonymously. See src/lib/contracts/api.ts.
//
// WHY THERE IS NO SURROUNDING TRANSACTION
//
// Each row is persisted by its own independent statement. A single transaction
// around the batch would be actively harmful: in Postgres, one failing statement
// aborts the whole transaction, so a single unexpected constraint violation on
// row 7 would roll back the 40 valid submissions before it and every student in
// the batch would appear not to have submitted. Per-row statements mean a bad row
// costs exactly that row, which is the stated requirement. Ingestion is
// idempotent, so a partially completed run is repaired by running it again —
// which the daily cron does anyway.
//
// IDEMPOTENCY rests on `submissions_row_ref_idx`, the unique index on
// (assignment_id, sheet_row_ref). Note the Postgres subtlety that makes the
// `no_row_ref` skip reason non-negotiable: a unique index does NOT constrain
// NULLs, so two rows with `sheet_row_ref = NULL` both insert happily and would
// keep doing so on every run. Rows without a derivable ref are skipped, and
// `assertUsableRowRef` throws if one ever reaches the insert.
// =============================================================================

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { assignments, cohorts, submissions, users } from "@/db/schema";

import { parseSubmissionCsv, type ParsedSheetRow } from "./csv";
import { fetchPublishedCsv } from "./fetch-csv";
import { recordIngestRun, type IngestTrigger } from "./ingest-log";
import { computeLateness } from "./lateness";
import { assertUsableRowRef } from "./row-ref";
import {
  abortedReport,
  countSkipReasons,
  type IngestReport,
  type SkippedRow,
  type SweepReport,
} from "./types";

/** Resolved student, with the grace window their cohort grants them. */
type StudentMatch = {
  id: number;
  email: string;
  role: string;
  cohortId: number | null;
  gracePeriodDays: number | null;
};

export type IngestOptions = {
  /** Injectable clock, for tests and for a deterministic sweep. */
  now?: Date;
  /** Injectable fetch, so ingestion can be driven against a fixture CSV. */
  fetchImpl?: typeof fetch;
  /** Per-fetch network timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Who asked for this run. Recorded on the operator surface so that "ran two
   * minutes ago" can be told apart from "an instructor pressed the button two
   * minutes ago"; the scheduled cron running is evidence the scheduler is alive,
   * a manual run is not.
   *
   * Defaults to "manual": a caller that did not say is not the scheduler.
   */
  triggeredBy?: IngestTrigger;
  /**
   * Skip the write to `submission_ingest_runs`.
   *
   * Exists for a unit test that drives ingestion against a live database and
   * must not disturb the operator surface's real content. NOT for production —
   * the whole point of the table is that an unattended run is recorded.
   */
  skipRunLog?: boolean;
};

/**
 * Ingest one assignment's published response sheet.
 *
 * Never throws for an expected condition — a missing CSV URL, an unreachable
 * sheet, a header with no email column, and every per-row problem are all
 * reported in the returned `IngestReport`. The caller turns that into an HTTP
 * response; nothing here decides status codes.
 */
export async function ingestAssignment(
  assignmentId: number,
  options: IngestOptions = {},
): Promise<IngestReport> {
  const startedAt = Date.now();

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  if (!assignment) {
    // NOT recorded on the operator surface, and cannot be: `submission_ingest_runs`
    // has a foreign key to `assignments`, so there is no row to hang the report on.
    // A caller asking about an assignment that does not exist is a caller bug, not
    // a pipeline failure, and the route turns it into a 404.
    return abortedReport(assignmentId, `#${assignmentId}`, "assignment_not_found", Date.now() - startedAt);
  }

  /**
   * Record the outcome and hand the report back unchanged.
   *
   * Wrapped so that EVERY return path below goes through it. The two abort paths
   * are the ones that matter most: an ingest that did no work is precisely the
   * outcome nobody currently finds out about, and an early `return` that forgot to
   * log would put the most important case back in the dark.
   */
  const finish = async (report: IngestReport): Promise<IngestReport> => {
    if (options.skipRunLog !== true) {
      await recordIngestRun({
        report,
        triggeredBy: options.triggeredBy ?? "manual",
        sheetUrl: assignment.googleSheetCsvUrl,
        now: options.now,
      });
    }
    return report;
  };

  const fetched = await fetchPublishedCsv(assignment.googleSheetCsvUrl, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (!fetched.ok) {
    // A clear, logged no-op — not a crash. `no_csv_url` is the seeded state of
    // every assignment today, so this is the expected path until the real Form
    // and Sheet URLs are supplied.
    console.info(
      `[submissions/ingest] assignment ${assignment.id} ("${assignment.title}") ` +
        `no-op: ${fetched.reason} — ${fetched.detail}`,
    );
    return finish({
      ...abortedReport(assignment.id, assignment.title, fetched.reason, Date.now() - startedAt),
      // The fetcher's detail is the actionable half of the report ("re-publish as
      // CSV", "a private sheet returns 401/403"). Carried through so the operator
      // surface shows the instruction and not just the reason code.
      abortDetail: fetched.detail,
    });
  }

  const parsed = parseSubmissionCsv(fetched.text);
  if (parsed.aborted) {
    console.warn(
      `[submissions/ingest] assignment ${assignment.id} ("${assignment.title}") ` +
        `no-op: ${parsed.aborted}. The published sheet is not a usable response sheet.`,
    );
    // `abortedReport` already attaches ABORT_ADVICE for the reason.
    return finish(
      abortedReport(assignment.id, assignment.title, parsed.aborted, Date.now() - startedAt),
    );
  }

  const skipped: SkippedRow[] = [...parsed.skipped];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  const studentsByEmail = await resolveStudents(parsed.rows.map((r) => r.email));

  for (const row of parsed.rows) {
    const student = studentsByEmail.get(row.email);
    if (!student) {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: "unknown_student",
        detail:
          `No enrolled user has the email "${row.email}". Most often a typo in the ` +
          "Form response, or someone who filled in the Form without being enrolled.",
        email: row.email,
      });
      continue;
    }
    if (student.role !== "student") {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: "not_a_student",
        detail: `"${row.email}" is a ${student.role} account, not a student.`,
        email: row.email,
      });
      continue;
    }

    const lateness = computeLateness({
      submittedAt: row.submittedAt,
      dueAt: assignment.dueAt,
      gracePeriodDays: student.gracePeriodDays,
    });

    try {
      const outcome = await persistRow({
        assignmentId: assignment.id,
        student,
        row,
        isLate: lateness.isLate,
      });
      if (outcome.kind === "inserted") inserted += 1;
      else if (outcome.kind === "updated") updated += 1;
      else if (outcome.kind === "unchanged") unchanged += 1;
      else skipped.push(outcome.skipped);
    } catch (error) {
      // A genuinely unexpected database error on one row. Report it as a skip so
      // the remaining rows still ingest, which is the whole point of not wrapping
      // the batch in a transaction.
      const message = error instanceof Error ? error.message : String(error);
      skipped.push({
        rowNumber: row.rowNumber,
        reason: "no_row_ref",
        detail: `Persisting this row failed: ${message}`,
        email: row.email,
      });
    }
  }

  const report: IngestReport = {
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
    aborted: null,
    abortDetail: null,
    rowsSeen: parsed.rowsSeen,
    inserted,
    updated,
    unchanged,
    skipped,
    skipReasonCounts: countSkipReasons(skipped),
    durationMs: Date.now() - startedAt,
  };

  console.info(
    `[submissions/ingest] assignment ${assignment.id} ("${assignment.title}"): ` +
      `${report.rowsSeen} rows seen, ${inserted} inserted, ${updated} updated, ` +
      `${unchanged} unchanged, ${skipped.length} skipped ` +
      `(${JSON.stringify(report.skipReasonCounts)}) in ${report.durationMs} ms`,
  );

  return finish(report);
}

/**
 * Look up every email in the batch in one query, with the cohort grace window.
 *
 * One `IN` query rather than a lookup per row: at 50-80 students an N+1 pattern
 * would be 80 round trips to Neon through PgBouncer for what is one index scan.
 *
 * Matching is case-insensitive because a Form captures whatever the respondent
 * typed, while `users.email` holds what they registered with. `users_email_idx`
 * is a plain unique index on the column, so `lower(email)` cannot use it; at
 * cohort scale that is a sub-millisecond sequential scan and not worth a schema
 * change (which would be a frozen-seam edit anyway).
 */
async function resolveStudents(emails: readonly string[]): Promise<Map<string, StudentMatch>> {
  const unique = [...new Set(emails)];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      cohortId: users.cohortId,
      gracePeriodDays: cohorts.gracePeriodDays,
    })
    .from(users)
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(inArray(sql`lower(${users.email})`, unique));

  const map = new Map<string, StudentMatch>();
  for (const row of rows) {
    map.set(row.email.toLowerCase(), {
      id: row.id,
      email: row.email,
      role: row.role,
      cohortId: row.cohortId,
      gracePeriodDays: row.gracePeriodDays ?? null,
    });
  }
  return map;
}

type PersistOutcome =
  | { kind: "inserted" }
  | { kind: "updated" }
  | { kind: "unchanged" }
  | { kind: "skipped"; skipped: SkippedRow };

/**
 * Persist one parsed row, keeping exactly one submission per (assignment, student).
 *
 * The four cases, and why each behaves as it does:
 *
 *  1. No submission yet -> INSERT with `onConflictDoNothing` on the row-ref
 *     index. The conflict target matters: two overlapping runs (the scheduled cron
 *     and an instructor pressing the sync button) can reach this line at the same
 *     moment, and losing that race must be a no-op, not a 500.
 *
 *  2. Same row ref -> the idempotent path. Captured fields are refreshed if the
 *     sheet changed (a corrected URL) and `is_late` is recomputed, because the
 *     cohort's grace period may have been adjusted since the last run. Grading
 *     columns are never touched here.
 *
 *  3. Different row ref, not yet graded -> a resubmission supersedes. The
 *     existing row is updated in place rather than a second row inserted, so the
 *     instructor queue shows one current submission per student. This also heals
 *     a legacy row whose `sheet_row_ref` is NULL by adopting a real ref.
 *
 *  4. Different row ref, already graded -> refuse. Overwriting would discard an
 *     instructor's stars and feedback silently. Reported as
 *     `supersedes_graded_submission` for a human to resolve.
 */
async function persistRow(input: {
  assignmentId: number;
  student: StudentMatch;
  row: ParsedSheetRow;
  isLate: boolean;
}): Promise<PersistOutcome> {
  const { assignmentId, student, row, isLate } = input;
  const rowRef = assertUsableRowRef(row.rowRef);

  const [existing] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, student.id)))
    .orderBy(desc(submissions.submittedAt))
    .limit(1);

  if (!existing) {
    const created = await db
      .insert(submissions)
      .values({
        studentId: student.id,
        assignmentId,
        githubUrl: row.githubUrl,
        liveUrl: row.liveUrl,
        sheetRowRef: rowRef,
        description: row.description,
        submittedAt: row.submittedAt,
        isLate,
        status: "submitted",
      })
      .onConflictDoNothing({
        target: [submissions.assignmentId, submissions.sheetRowRef],
      })
      .returning({ id: submissions.id });

    if (created.length === 0) {
      return {
        kind: "skipped",
        skipped: {
          rowNumber: row.rowNumber,
          reason: "duplicate_row_ref_in_db",
          detail:
            "This sheet row is already ingested under the same row reference — a " +
            "concurrent ingestion run inserted it first. Nothing to do.",
          email: row.email,
        },
      };
    }
    return { kind: "inserted" };
  }

  if (existing.sheetRowRef === rowRef) {
    const changed =
      existing.githubUrl !== row.githubUrl ||
      existing.liveUrl !== row.liveUrl ||
      existing.description !== row.description ||
      existing.isLate !== isLate ||
      existing.submittedAt.getTime() !== row.submittedAt.getTime();

    if (!changed) return { kind: "unchanged" };

    await db
      .update(submissions)
      .set({
        githubUrl: row.githubUrl,
        liveUrl: row.liveUrl,
        description: row.description,
        submittedAt: row.submittedAt,
        isLate,
      })
      .where(eq(submissions.id, existing.id));
    return { kind: "updated" };
  }

  if (existing.status === "graded") {
    return {
      kind: "skipped",
      skipped: {
        rowNumber: row.rowNumber,
        reason: "supersedes_graded_submission",
        detail:
          `Submission ${existing.id} for this student is already graded. A newer Form ` +
          "response exists but was NOT applied, because doing so would discard the " +
          "instructor's stars and feedback. Resolve manually.",
        email: row.email,
      },
    };
  }

  await db
    .update(submissions)
    .set({
      sheetRowRef: rowRef,
      githubUrl: row.githubUrl,
      liveUrl: row.liveUrl,
      description: row.description,
      submittedAt: row.submittedAt,
      isLate,
    })
    .where(eq(submissions.id, existing.id));
  return { kind: "updated" };
}

// ---------------------------------------------------------------------------
// Cron sweep
// ---------------------------------------------------------------------------

/**
 * Ingest every assignment that has a sheet configured.
 *
 * Runs sequentially, not in parallel. Four assignments is a tiny batch, and
 * `db` holds a pool capped at 5 connections (see src/db/index.ts) which a
 * parallel fan-out would contend for while also hitting Google's publish
 * endpoint with a burst.
 *
 * Assignments with no `googleSheetCsvUrl` are counted as skipped and reported;
 * that is the seeded state today, so a sweep that reports "4 considered, 0
 * ingested, 4 skipped: no_csv_url" is the correct, honest outcome rather than an
 * error.
 */
export async function ingestAllAssignments(options: IngestOptions = {}): Promise<SweepReport> {
  const startedAt = Date.now();

  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .orderBy(assignments.dueAt);

  const reports: IngestReport[] = [];
  for (const { id } of rows) {
    // "cron" unless the caller says otherwise. This is the sweep; the only other
    // thing that calls it is a test.
    reports.push(await ingestAssignment(id, { triggeredBy: "cron", ...options }));
  }

  const sweep: SweepReport = {
    assignmentsConsidered: rows.length,
    assignmentsIngested: reports.filter((r) => r.aborted === null).length,
    assignmentsSkipped: reports.filter((r) => r.aborted !== null).length,
    totalInserted: reports.reduce((n, r) => n + r.inserted, 0),
    totalUpdated: reports.reduce((n, r) => n + r.updated, 0),
    totalUnchanged: reports.reduce((n, r) => n + r.unchanged, 0),
    totalSkippedRows: reports.reduce((n, r) => n + r.skipped.length, 0),
    missedDeadlinePenalties: 0,
    reports,
    durationMs: Date.now() - startedAt,
  };

  console.info(
    `[submissions/sweep] ${sweep.assignmentsConsidered} assignment(s) considered, ` +
      `${sweep.assignmentsIngested} ingested, ${sweep.assignmentsSkipped} skipped, ` +
      `${sweep.totalInserted} submissions inserted, ${sweep.totalUpdated} updated, ` +
      `${sweep.totalSkippedRows} rows skipped in ${sweep.durationMs} ms`,
  );

  return sweep;
}
