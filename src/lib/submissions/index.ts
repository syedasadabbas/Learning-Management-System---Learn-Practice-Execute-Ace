// =============================================================================
// SUBMISSIONS BARREL — the surface other streams import.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// NOTE FOR UNIT TESTS: this barrel re-exports the database-backed modules, so
// importing it pulls in `@/db` and therefore the `pg` Pool. The pure modules
// (csv, row-ref, lateness, types) have no database import at all — test those by
// importing the module directly, e.g. `from "./csv"`, not through here.
// =============================================================================

// --- Pure: CSV parsing, row-ref derivation, lateness maths -------------------
export {
  keepLatestPerStudent,
  looksLikeEmail,
  mapColumns,
  normaliseHeader,
  normaliseUrl,
  parseSheetTimestamp,
  parseSubmissionCsv,
  type ColumnMap,
  type ParseCsvResult,
  type ParsedSheetRow,
  type SheetField,
} from "./csv";

export {
  ROW_REF_MAX_LENGTH,
  ROW_REF_VERSION,
  assertUsableRowRef,
  deriveRowRef,
  normaliseEmail,
  type RowRefResult,
} from "./row-ref";

export {
  DAY_MS,
  computeLateness,
  deadlineHasPassed,
  effectiveDueAt,
  normaliseGraceDays,
  pointsForSubmission,
  type Lateness,
} from "./lateness";

export {
  abortedReport,
  countSkipReasons,
  type IngestReport,
  type RunAbortReason,
  type SkipReason,
  type SkippedRow,
  type SweepReport,
} from "./types";

// --- Network ----------------------------------------------------------------
export {
  CSV_FETCH_TIMEOUT_MS,
  fetchPublishedCsv,
  isAllowedCsvUrl,
  type CsvFetchResult,
} from "./fetch-csv";

// --- Database-backed --------------------------------------------------------
export { ingestAllAssignments, ingestAssignment, type IngestOptions } from "./ingest";
export {
  deriveGradeScoreForSubmission,
  gradeSubmission,
  persistPenaltyDecisions,
  recordGrade,
  type GradeResult,
  type Tx,
} from "./grade";
export {
  getAssignmentForWeek,
  getAssignmentHistory,
  graceDaysForStudent,
  toHistoryItem,
  type AssignmentHistoryItem,
  type HistoryRow,
  type SubmissionState,
} from "./history";
export {
  listMissingSubmitters,
  persistMissedDeadlinePenalties,
} from "./deadline-penalties";
