// =============================================================================
// CSV EXPORT — instructor-admin stream.
// -----------------------------------------------------------------------------
// Pure string building, no database, no framework: unit-testable in isolation,
// which matters because a broken quoting rule in an export is discovered by
// someone else's spreadsheet, not by a stack trace.
//
// Two safety properties, both tested in csv.test.ts:
//  1. FIELD ESCAPING. Values containing a comma, a quote or a newline are quoted
//     and internal quotes doubled (RFC 4180). Student names contain commas.
//  2. NO CREDENTIALS. `EXPORT_COLUMNS` is an explicit allow-list of column keys.
//     `buildCsv` reads only those keys, so passing it a row that happens to carry
//     a `passwordHash` cannot emit one. `assertNoSecretColumns` fails loudly if a
//     future edit adds a credential-looking header.
// =============================================================================

/** Column keys that must never appear in an export, whatever the caller passes. */
const FORBIDDEN_COLUMN_PATTERN = /pass(word)?|hash|secret|token|salt/i;

export interface CsvColumn<T> {
  /** Header text written to the file. */
  header: string;
  /** How to render the cell. Returning null/undefined writes an empty field. */
  value: (row: T) => string | number | boolean | Date | null | undefined;
}

/**
 * Escape one field per RFC 4180.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with a single quote: Excel and
 * Sheets treat those as formulas, and a grade export is a document, not a
 * program. This is CSV injection mitigation, not cosmetics.
 */
export function escapeCsvField(
  value: string | number | boolean | Date | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date ? value.toISOString() : String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Throws if any header looks like a credential. Called by buildCsv. */
export function assertNoSecretColumns(headers: readonly string[]): void {
  const offender = headers.find((h) => FORBIDDEN_COLUMN_PATTERN.test(h));
  if (offender) {
    throw new Error(
      `Refusing to export column "${offender}": exports must never contain credentials.`,
    );
  }
}

/**
 * Render rows to CSV text with CRLF line endings (what Excel expects).
 * Returns just the header line when `rows` is empty — an empty export is a valid
 * answer ("nobody has been graded yet"), not an error.
 */
export function buildCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const headers = columns.map((c) => c.header);
  assertNoSecretColumns(headers);

  const lines: string[] = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(c.value(row))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

export interface GradeExportRow {
  studentName: string;
  studentEmail: string;
  cohortName: string | null;
  weekNumber: number;
  assignmentTitle: string;
  status: string;
  score: number | null;
  stars: number | null;
  isLate: boolean;
  submittedAt: Date;
  gradedAt: Date | null;
  instructorName: string | null;
}

export const GRADE_EXPORT_COLUMNS: readonly CsvColumn<GradeExportRow>[] = [
  { header: "Student", value: (r) => r.studentName },
  { header: "Email", value: (r) => r.studentEmail },
  { header: "Cohort", value: (r) => r.cohortName },
  { header: "Week", value: (r) => r.weekNumber },
  { header: "Assignment", value: (r) => r.assignmentTitle },
  { header: "Status", value: (r) => r.status },
  { header: "Score (of 40)", value: (r) => r.score },
  { header: "Stars (of 5)", value: (r) => r.stars },
  { header: "Late", value: (r) => (r.isLate ? "yes" : "no") },
  { header: "Submitted at (UTC)", value: (r) => r.submittedAt },
  { header: "Graded at (UTC)", value: (r) => r.gradedAt },
  { header: "Graded by", value: (r) => r.instructorName },
];

/** Filename for a download, stamped with the UTC date. */
export function exportFilename(prefix: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `${prefix}-${stamp}.csv`;
}
