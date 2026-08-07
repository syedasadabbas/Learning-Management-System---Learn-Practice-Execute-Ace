// =============================================================================
// SUBMISSIONS — shared types for Google Sheet ingestion.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// The skip-reason union is deliberately a closed set of string literals rather
// than free text. Ingestion runs unattended on a cron (daily, see vercel.json),
// so the only way anyone finds out a row was dropped is the per-run summary. A
// closed set means the summary can be counted and compared between runs; free
// text would make "3 rows skipped" unaggregatable.
// =============================================================================

/**
 * Why a single CSV row was not turned into a submission.
 *
 * Every one of these is per-ROW: the batch continues. A condition that aborts
 * the whole run is a `RunAbortReason` instead.
 */
export type SkipReason =
  /** Every cell empty — trailing newline or a spacer row in the sheet. */
  | "blank_row"
  /** The email column exists but this row's cell is empty. */
  | "missing_email"
  /** The email cell has content that is not a plausible address. */
  | "invalid_email"
  /** The timestamp column exists but this row's cell is empty. */
  | "missing_timestamp"
  /** The timestamp cell could not be parsed by any supported format. */
  | "malformed_timestamp"
  /**
   * Row ref derivation produced an empty value. Defensive: a NULL/empty
   * `sheetRowRef` is NOT constrained by `submissions_row_ref_idx` (Postgres
   * unique indexes do not constrain NULLs), so such a row would duplicate on
   * every single re-run. Never insert one.
   */
  | "no_row_ref"
  /** The email matched no user row. Most often a typo, or a non-enrolled guest. */
  | "unknown_student"
  /** The email matched a user whose role is not `student`. */
  | "not_a_student"
  /** Same student appears twice or more in this CSV; only the latest counts. */
  | "superseded_by_later_response"
  /** Two rows in this CSV derived the same row ref — the sheet has a literal duplicate. */
  | "duplicate_row_ref_in_batch"
  /** Insert lost an ON CONFLICT race with a concurrent run. Already ingested. */
  | "duplicate_row_ref_in_db"
  /**
   * A newer response arrived for a submission that has already been graded.
   * Overwriting would silently discard an instructor's marks, so the existing
   * grade is left alone and this is surfaced for a human to decide.
   */
  | "supersedes_graded_submission";

/** Why an entire ingestion run did no work. Not a crash — a reported no-op. */
export type RunAbortReason =
  /** `assignments.googleSheetCsvUrl` is null. Seeded state — see scripts/seed.ts. */
  | "no_csv_url"
  /** The assignment id does not exist. */
  | "assignment_not_found"
  /** Network/HTTP failure fetching the published CSV. */
  | "fetch_failed"
  /** The fetch succeeded but returned nothing. */
  | "empty_csv"
  /**
   * The fetch succeeded and returned an HTML PAGE rather than CSV.
   *
   * The single most likely real-world misconfiguration, and it used to be the
   * most misleading: "File -> Share -> Publish to web" offers "Web page" and
   * "Comma-separated values" and defaults to the former, so a sheet published
   * with two clicks instead of three answers 200 OK with a full HTML document.
   * Papa Parse happily reads that as a one-column CSV, `mapColumns` finds no
   * email column, and the run reported `no_email_column` — which sends the
   * operator to inspect their Form's question wording, the one thing that is
   * not wrong. Named separately so the report can say what to actually change.
   */
  | "html_not_csv"
  /** No recognisable email column in the header row — nothing can be matched. */
  | "no_email_column"
  /** No recognisable timestamp column — no stable row ref can be derived. */
  | "no_timestamp_column";

/** One dropped row, with enough context for a human to fix the sheet. */
export type SkippedRow = {
  /** 1-based index of the data row (header row excluded), for "row 7 of the sheet". */
  rowNumber: number;
  reason: SkipReason;
  /** Human-readable detail. Never contains the CSV URL or any secret. */
  detail: string;
  /** Email as it appeared, when one was readable. Useful for chasing a typo. */
  email?: string;
};

/** Per-assignment ingestion outcome. Aggregated by the cron sweep. */
export type IngestReport = {
  assignmentId: number;
  assignmentTitle: string;
  /** Set when the run was a no-op; `null` on a run that parsed rows. */
  aborted: RunAbortReason | null;
  /**
   * What to DO about the abort, in prose. Null on a run that parsed rows.
   *
   * Separate from `aborted` because the reason code is for aggregation and this is
   * for the human reading the operator surface. A reason code alone put the
   * operator in the position of having to know that `html_not_csv` means "change a
   * dropdown in the publish dialog", which is knowledge that lives in this
   * repository and nowhere in their head. Never contains the sheet URL — that is a
   * capability token (see fetch-csv.ts).
   */
  abortDetail?: string | null;
  /** Data rows seen in the CSV (header excluded). */
  rowsSeen: number;
  /** New submission rows created. */
  inserted: number;
  /** Existing rows whose captured fields or row ref were refreshed. */
  updated: number;
  /** Rows that resolved to an identical existing submission — the idempotent path. */
  unchanged: number;
  skipped: SkippedRow[];
  /** Counts by reason, so a run can be compared to the previous one at a glance. */
  skipReasonCounts: Partial<Record<SkipReason, number>>;
  /** Wall-clock duration of this assignment's ingestion, in milliseconds (metric). */
  durationMs: number;
};

/** The cron sweep's aggregate across every assignment it touched. */
export type SweepReport = {
  assignmentsConsidered: number;
  assignmentsIngested: number;
  assignmentsSkipped: number;
  totalInserted: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalSkippedRows: number;
  /** Missed-deadline penalties persisted during this sweep. */
  missedDeadlinePenalties: number;
  reports: IngestReport[];
  durationMs: number;
};

/**
 * What an operator should DO about each abort reason.
 *
 * One place, so the advice cannot differ between the log line, the API response
 * and the page. `fetchPublishedCsv` composes its own richer detail for the two
 * reasons it owns (`no_csv_url`, `html_not_csv`, `fetch_failed`) and that wins when
 * present; these are the fallbacks and the parser's own reasons.
 *
 * `empty_csv` is worth reading twice: it means the URL answered with NOTHING, which
 * is a broken or unpublished sheet. A sheet nobody has answered yet still has its
 * header row and does NOT abort — it reports `rowsSeen: 0` and is healthy.
 */
export const ABORT_ADVICE: Readonly<Record<RunAbortReason, string>> = {
  no_csv_url:
    "No response-sheet URL is stored on this assignment, so there is nothing to read. " +
    "Set it in the admin console (Assignments) or via SUBMISSIONS_SHEET_CSV_URL_WEEK_<n>.",
  assignment_not_found: "The assignment no longer exists.",
  fetch_failed:
    "The response sheet could not be fetched. Check that the URL is still published " +
    "and that it is a Google Sheets published-to-web address.",
  empty_csv:
    "The response sheet URL returned an empty body. That is an unpublished, deleted or " +
    "wrongly-scoped sheet — a Form nobody has answered yet still returns its header row.",
  html_not_csv:
    'The sheet is published as a WEB PAGE, not CSV. In the sheet: File -> Share -> ' +
    'Publish to web -> select the response sheet -> change "Web page" to ' +
    '"Comma-separated values (.csv)" -> Publish, then store the new URL.',
  no_email_column:
    "No column in the header row could be recognised as the respondent's email address, " +
    "and email is the only field a response can be matched to a student by. Add an " +
    '"Email Address" question to the Form, or rename the existing one to contain "email".',
  no_timestamp_column:
    "No column in the header row could be recognised as a timestamp. Google Forms adds " +
    'one automatically and names it "Timestamp"; if the column was renamed or deleted, ' +
    "restore it — without it there is no submission time and no stable row reference.",
};

/** Empty report helper so every abort path returns the same shape. */
export function abortedReport(
  assignmentId: number,
  assignmentTitle: string,
  aborted: RunAbortReason,
  durationMs: number,
): IngestReport {
  return {
    assignmentId,
    assignmentTitle,
    aborted,
    abortDetail: ABORT_ADVICE[aborted],
    rowsSeen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    skipReasonCounts: {},
    durationMs,
  };
}

/** Tally skip reasons for the summary. Kept here so both csv and ingest use one. */
export function countSkipReasons(
  skipped: readonly SkippedRow[],
): Partial<Record<SkipReason, number>> {
  const counts: Partial<Record<SkipReason, number>> = {};
  for (const row of skipped) {
    counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  }
  return counts;
}
