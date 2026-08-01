// =============================================================================
// COMPLIANCE EXPORT (CSV). Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// The roadmap asks for "Compliance export (CSV)". Two things about a CSV that
// leaves this system matter more than the formatting:
//
// 1. FORMULA INJECTION. A CSV is opened in Excel or Sheets, and a cell beginning
//    `=`, `+`, `-`, `@`, TAB or CR is evaluated as a FORMULA by both. That is
//    CVE-class behaviour with a long history of exfiltrating data via
//    `=HYPERLINK(...)` and `=WEBSERVICE(...)`. This table's cells are mostly enum
//    values and integers — but `entity_type`, `error_code`, `client_family` and
//    every key and value inside `details` are strings that ultimately derive from
//    a request, and `clientFamily` stores "Unrecognised client" for a hostile
//    User-Agent precisely because the raw header must never travel. Every field is
//    neutralised here, unconditionally, rather than "where it could matter" — the
//    version of this check that reasons about which columns are trusted is the
//    version that is wrong after the next schema change.
//
// 2. IT IS AN EGRESS EVENT, NOT A REPORT. The export carries the actor identities
//    the table deliberately does not store — the admin's own view joins `users` to
//    show them — so a downloaded file is more sensitive than the table itself. The
//    route records an `activity_export` row BEFORE emitting any bytes and refuses
//    to export if that row cannot be written; the argument is in the route.
//
// Everything here is pure: no database, no Response. That is what lets the
// injection rules be tested exhaustively in csv.test.ts.
// =============================================================================

/** The exported columns, in order. */
export const CSV_COLUMNS = [
  "occurred_at",
  "action",
  "status",
  "actor_id",
  "actor_name",
  "actor_email",
  "actor_role",
  "entity_type",
  "entity_id",
  "ip_prefix",
  "client_family",
  "error_code",
  "correlation_id",
  "details",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** One export row: already joined to `users`, already redacted at write time. */
export interface ExportRow {
  occurredAt: Date;
  action: string;
  status: string;
  actorId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: number | null;
  ipPrefix: string | null;
  clientFamily: string | null;
  errorCode: string | null;
  correlationId: string | null;
  details: unknown;
}

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * TAB and CR belong on the published version of this list and are absent here only
 * because `csvCell` strips every C0 control character except newline BEFORE this
 * test runs, so a leading TAB or CR cannot survive to be evaluated. Stated rather
 * than left implicit: if that strip is ever relaxed, these two must come back.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@"];

/**
 * C0 control characters (plus DEL) except newline, 0x0A.
 *
 * A NUL, a vertical tab or a bare CR inside a field either breaks the row
 * structure or hides content from a reviewer scrolling a spreadsheet. Newline
 * survives and is handled by quoting, because a legitimate multi-line value should
 * still be readable.
 */
const CONTROL_CHARS = /[\x00-\x09\x0B-\x1F\x7F]/g;

/**
 * Neutralise one cell.
 *
 * A leading formula character is prefixed with an apostrophe, which both Excel and
 * Sheets treat as "this is text" and which is the OWASP-recommended mitigation.
 * The alternative — stripping the character — silently corrupts legitimate values
 * such as a negative number, and this file exports integers.
 *
 * Then ordinary RFC 4180 quoting: a field containing a quote, comma or newline is
 * wrapped in quotes with internal quotes doubled.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) {
    // ISO-8601 UTC, always. A locale-formatted timestamp in a compliance export is
    // ambiguous about both the offset and day/month order.
    text = value.toISOString();
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  text = text.replace(CONTROL_CHARS, "");

  if (FORMULA_LEADERS.some((leader) => text.startsWith(leader))) {
    text = `'${text}`;
  }

  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** One CSV line from a row, in `CSV_COLUMNS` order. */
export function csvLine(row: ExportRow): string {
  const cells: unknown[] = [
    row.occurredAt,
    row.action,
    row.status,
    row.actorId,
    row.actorName,
    row.actorEmail,
    row.actorRole,
    row.entityType,
    row.entityId,
    row.ipPrefix,
    row.clientFamily,
    row.errorCode,
    row.correlationId,
    row.details,
  ];
  return cells.map(csvCell).join(",");
}

/**
 * The whole document, header included.
 *
 * CRLF line endings, per RFC 4180 — LF-only files are mis-parsed by older Excel
 * builds on Windows, which is the environment a compliance officer is most likely
 * to be using.
 */
export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [CSV_COLUMNS.join(","), ...rows.map(csvLine)];
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Filename for the download, carrying the generation instant so two exports never
 * collide in a downloads folder and an auditor can see when it was taken.
 */
export function csvFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `activity-log-${stamp}.csv`;
}
