// =============================================================================
// GOOGLE SHEET CSV PARSING — pure, no database, no network.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// This module turns the text of a published Google Form response sheet into
// candidate submissions plus a list of rows it refused, each with a reason.
//
// DESIGN RULE: one bad row never aborts the batch. A cohort of 50-80 students
// files one response each; if a single malformed timestamp threw, the other 79
// submissions would silently fail to appear and the students would be marked as
// having missed the deadline. Every per-row failure is therefore a `SkippedRow`,
// and only a problem with the SHEET AS A WHOLE (no header, no email column)
// aborts the run.
//
// Everything here is deliberately free of `db` and `fetch` imports so it can be
// unit-tested against fixture strings — which matters more than usual, because
// the real Sheet URLs do not exist yet (see the TODO(decision) in scripts/seed.ts)
// and fixture tests are the only verification available.
// =============================================================================

import Papa from "papaparse";

import { deriveRowRef } from "./row-ref";
import {
  countSkipReasons,
  type RunAbortReason,
  type SkipReason,
  type SkippedRow,
} from "./types";

// ---------------------------------------------------------------------------
// Shape detection — is this even a CSV?
// ---------------------------------------------------------------------------

/**
 * Does this body look like an HTML document rather than CSV?
 *
 * THE FAILURE THIS CATCHES IS THE LIKELIEST ONE IN THE WHOLE PIPELINE. Google's
 * "Publish to web" dialog defaults to "Entire document / Web page"; choosing CSV
 * is a second dropdown that is easy to miss. A sheet published as a web page
 * answers 200 OK with a complete HTML document, and everything downstream then
 * behaves reasonably and reports the WRONG cause: Papa Parse reads the markup as
 * a one-column CSV, `mapColumns` finds no email column, and the run aborted with
 * `no_email_column` — which sends the operator to inspect their Form's question
 * wording, the one thing that is not wrong. See `html_not_csv` in types.ts.
 *
 * Content-type is checked FIRST but is not sufficient on its own: Google's publish
 * endpoint has been observed answering `text/plain` for some documents, and a
 * proxy can rewrite the header. So the body is sniffed too — but only its LEADING
 * bytes, because a legitimate CSV cell can contain any of these strings ("<html>"
 * is a perfectly valid answer to "anything else you want us to know?"), and such
 * a cell cannot appear before the header row.
 *
 * Lives here rather than in fetch-csv.ts so this module stays free of any import
 * that touches the network, which is the property that makes it unit-testable
 * against fixture strings. fetch-csv.ts imports it, not the other way round.
 */
export function looksLikeHtml(body: string, contentType?: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml")) return true;

  // 512 characters is past any doctype, XML prolog or BOM, and far short of the
  // first data row of even a wide sheet's header.
  const head = body.slice(0, 512).replace(/^﻿/, "").trimStart().toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<?xml") ||
    head.startsWith("<head") ||
    // Some published-page templates open with a <style>, <meta> or <script>
    // before <html>.
    /^<(style|meta|link|script|body)[\s>]/.test(head)
  );
}

// ---------------------------------------------------------------------------
// Header matching
// ---------------------------------------------------------------------------

/**
 * Collapse a header cell to a comparison key: lowercase, alphanumerics only.
 *
 * Google Forms names a response column after the question text verbatim, so the
 * same logical field arrives as "Email Address", "Email address", "Your Email",
 * or "Email Address (auto-collected)" depending on how the form was authored.
 * Stripping case, spaces, and punctuation makes all of those comparable without
 * a per-cohort configuration file.
 */
export function normaliseHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Alias lists per logical field, most specific first.
 *
 * Matching is two-pass — exact key, then substring — so "emailaddress" wins over
 * a looser "email" match on a sheet that happens to contain both columns.
 *
 * A COLUMN THAT IS DELIBERATELY ABSENT FROM THIS LIST
 *
 * The real week 1 response sheet (verified 2026-08-01 against the published CSV)
 * emits seven columns. Six map exactly on the first pass. The seventh,
 * "Upload your Assignment File(s)", normalises to "uploadyourassignmentfiles" and
 * matches nothing here ON PURPOSE — the course owner chose to keep collecting the
 * uploads while leaving them out of the pipeline. The cell is read and discarded;
 * the Drive links live only in the sheet.
 *
 * So this is NOT a missing alias to be helpfully added. Capturing it would need a
 * new `submissions.attachment_url` column, which is an edit to src/db/schema.ts —
 * a frozen shared seam — plus a migration, changes in persistRow, the instructor
 * queue and GradeForm, and a deliberate EXCLUSION from the peer-review field
 * allowlist (src/lib/peer-review/visibility.ts), because a Drive link exposes its
 * uploader's identity and would de-anonymise the reviewed work. Raise it with the
 * course owner before adding it, not as a drive-by fix.
 */
const FIELD_ALIASES = {
  timestamp: ["timestamp", "submittedat", "submissiontime", "datesubmitted", "submitteddate"],
  email: ["emailaddress", "email", "youremail", "studentemail", "emailid"],
  githubUrl: [
    "githubrepositoryurl",
    "githubrepourl",
    "githubrepositorylink",
    "githuburl",
    "githublink",
    "repositoryurl",
    "repourl",
    "repolink",
  ],
  liveUrl: [
    "livesiteurl",
    "liveurl",
    "deployedurl",
    "deploymenturl",
    "livesitelink",
    "livelink",
    "hostedurl",
    "livedemo",
    "demourl",
  ],
  description: [
    "description",
    "additionalnotes",
    "notes",
    "comments",
    "anythingelseyouwantustoknow",
    "message",
  ],
  respondentName: ["fullname", "yourname", "studentname", "name"],
} as const;

export type SheetField = keyof typeof FIELD_ALIASES;

/** Resolved column index per logical field. `-1` means the column is absent. */
export type ColumnMap = Record<SheetField, number>;

/**
 * Map header cells to logical fields.
 *
 * `githubUrl` intentionally accepts a loose "github" substring match, which will
 * also catch a hypothetical "GitHub Username" column. That is the accepted
 * trade-off for tolerating unknown question wording: a wrong URL in the captured
 * field is visible to the instructor at grading time, whereas a missed column is
 * invisible. If a cohort's form has both, add the exact header to the alias list
 * above rather than loosening the rule further.
 */
export function mapColumns(header: readonly string[]): ColumnMap {
  const keys = header.map(normaliseHeader);
  const map: ColumnMap = {
    timestamp: -1,
    email: -1,
    githubUrl: -1,
    liveUrl: -1,
    description: -1,
    respondentName: -1,
  };
  const claimed = new Set<number>();

  // Pass 1 — exact alias match.
  for (const field of Object.keys(FIELD_ALIASES) as SheetField[]) {
    for (const alias of FIELD_ALIASES[field]) {
      const i = keys.findIndex((k, idx) => k === alias && !claimed.has(idx));
      if (i !== -1) {
        map[field] = i;
        claimed.add(i);
        break;
      }
    }
  }

  // Pass 2 — substring match for columns still unresolved.
  for (const field of Object.keys(FIELD_ALIASES) as SheetField[]) {
    if (map[field] !== -1) continue;
    for (const alias of FIELD_ALIASES[field]) {
      const i = keys.findIndex((k, idx) => !claimed.has(idx) && k !== "" && k.includes(alias));
      if (i !== -1) {
        map[field] = i;
        claimed.add(i);
        break;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Timestamp parsing
// ---------------------------------------------------------------------------

/**
 * TIMEZONE DECISION (stated, not hidden)
 *
 * A Google Form timestamp carries no offset — it is rendered in the sheet
 * owner's spreadsheet timezone. There is nothing in the CSV that says which
 * timezone that is, so a naive timestamp is interpreted as UTC.
 *
 * Consequence: for a cohort whose sheet is set to, say, UTC+5, a response filed
 * just before midnight local time is read as ~5 hours earlier. Because
 * `daysLate` rounds UP to whole days, that can only ever move a submission
 * EARLIER, i.e. it can never manufacture lateness that did not happen. The
 * cohort grace period (2 days, `cohorts.grace_period_days`) absorbs the rest.
 *
 * TODO(decision): once the real response sheet exists, confirm its spreadsheet
 * timezone and either set it to UTC or pass an offset in here. Do not guess.
 */
const NAIVE_TIMESTAMP_IS_UTC = true;

/** ISO 8601 with an explicit zone — unambiguous, hand straight to Date. */
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** ISO-shaped but zoneless: "2026-09-08 14:03:21" (Sheets ISO date format). */
const ISO_NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Google Forms' US default: "9/8/2026 14:03:21" or "9/8/2026 2:03:21 PM".
 * Month first. A dd/mm sheet would be misread — see the TODO below.
 */
const US_SLASHED =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?$/;

/**
 * Parse a Google Sheet timestamp cell.
 *
 * Returns `null` for anything not matched by an explicit format. There is
 * deliberately NO bare `new Date(raw)` fallback: `Date.parse` accepts strings
 * like "not a date 2026" in some engines and silently invents a value, which
 * would produce a confident but wrong lateness calculation and a row ref that
 * changes between Node versions.
 *
 * TODO(decision): only month-first slashed dates are accepted. A sheet whose
 * locale renders 8/9/2026 as 8 September would be read as 9 August. With the
 * real sheet in hand, verify the locale; day-first would need its own regex and
 * cannot be told apart from month-first for days 1-12.
 */
export function parseSheetTimestamp(raw: string): Date | null {
  const value = raw.trim();
  if (value === "") return null;

  const zoned = ISO_WITH_ZONE.exec(value);
  if (zoned) {
    const normalised = value.replace(" ", "T");
    const d = new Date(normalised);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const naive = ISO_NAIVE.exec(value);
  if (naive) {
    return buildUtc(
      Number(naive[1]),
      Number(naive[2]),
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6] ?? 0),
    );
  }

  const us = US_SLASHED.exec(value);
  if (us) {
    let hour = Number(us[4]);
    const meridiem = us[7]?.toLowerCase();
    if (meridiem === "p" && hour < 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
    // A 12-hour clock cannot express hour 13+, so "13:00 PM" is malformed.
    if (meridiem && Number(us[4]) > 12) return null;
    return buildUtc(
      Number(us[3]),
      Number(us[1]),
      Number(us[2]),
      hour,
      Number(us[5]),
      Number(us[6] ?? 0),
    );
  }

  return null;
}

/**
 * Build a UTC Date and verify it round-trips.
 *
 * `Date.UTC` rolls overflow forward, so 2026-02-30 becomes 2 March rather than
 * failing. Comparing the components back out rejects impossible calendar dates
 * instead of accepting a date the sheet never contained.
 */
function buildUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (!NAIVE_TIMESTAMP_IS_UTC) {
    // Unreachable while the decision above stands; kept so the assumption is a
    // named constant rather than an unmarked line of code.
    throw new Error("Non-UTC naive timestamp handling is not implemented.");
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Field cleaning
// ---------------------------------------------------------------------------

/**
 * Is this plausibly an email address?
 *
 * Deliberately loose. The authoritative check is whether the address matches a
 * row in `users`; this only screens out obvious junk ("n/a", "-", a URL) so that
 * such rows get the accurate `invalid_email` reason instead of the misleading
 * `unknown_student`.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(value);
}

/** Max length of `submissions.github_url` / `live_url` (varchar(500) in schema). */
const URL_MAX_LENGTH = 500;

/**
 * Clean a URL cell into something storable, or null.
 *
 * Students routinely paste "github.com/me/repo" without a scheme, so a bare
 * host is upgraded to https. Anything longer than the column is dropped rather
 * than truncated: a truncated URL looks valid and is not, which is worse for the
 * grading instructor than an empty field they can ask about.
 */
export function normaliseUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  const withScheme = /^https?:\/\//i.test(value)
    ? value
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)
      ? `https://${value}`
      : null;
  if (withScheme === null) return null;
  if (withScheme.length > URL_MAX_LENGTH) return null;
  return withScheme;
}

// ---------------------------------------------------------------------------
// Row extraction
// ---------------------------------------------------------------------------

/** One CSV row that survived parsing and has a usable row ref. */
export type ParsedSheetRow = {
  /** 1-based index among DATA rows (the header row is not counted). */
  rowNumber: number;
  /** Lowercased, trimmed. Matched against `users.email`. */
  email: string;
  submittedAt: Date;
  /** Stable idempotency key — see row-ref.ts. Never null or empty. */
  rowRef: string;
  githubUrl: string | null;
  liveUrl: string | null;
  description: string | null;
  respondentName: string | null;
};

export type ParseCsvResult = {
  /** Set when the sheet as a whole is unusable; no rows are returned. */
  aborted: RunAbortReason | null;
  /** Data rows seen, including ones that were skipped. */
  rowsSeen: number;
  /** Candidate rows, deduplicated so at most one survives per student. */
  rows: ParsedSheetRow[];
  skipped: SkippedRow[];
  skipReasonCounts: Partial<Record<SkipReason, number>>;
  /** Which column index each logical field resolved to, for diagnostics. */
  columns: ColumnMap;
};

/**
 * Parse a published-CSV body into candidate submissions.
 *
 * Papa Parse runs with `header: false` on purpose. With `header: true` it keys
 * rows by header text, which silently drops one of two identically-named columns
 * and loses the physical row number that a skip report needs in order to say
 * "row 7 of the sheet".
 *
 * THE REAL-WORLD SHEET SHAPES THIS IS BUILT TO SURVIVE, and what each produces.
 * Every one is a REPORTED outcome; none is a crash and none is a silent drop.
 *
 *   Header question text edited     `mapColumns` matches on a normalised key and
 *                                   then on a substring, so "Your GitHub repo
 *                                   link (public!)" still resolves to githubUrl.
 *                                   A column that matches nothing is simply
 *                                   absent, and only email/timestamp are fatal.
 *   Columns reordered               Irrelevant by construction: fields are
 *                                   resolved to INDICES from the header, never
 *                                   assumed positional.
 *   Extra columns Google adds       Ignored. Nothing here enumerates the sheet.
 *   Same respondent twice           LAST WINS — `keepLatestPerStudent`. The
 *                                   losers are reported as
 *                                   `superseded_by_later_response`, never
 *                                   dropped quietly. Read that function's
 *                                   comment for why last and not first.
 *   Same respondent, same second    `duplicate_row_ref_in_batch`: a literal
 *                                   duplicate row, which last-wins cannot tell
 *                                   apart from the winner because the row ref is
 *                                   derived from (email, timestamp).
 *   Sheet with no bytes             `aborted: "empty_csv"`.
 *   Sheet with a header and no      NOT an abort. `rowsSeen: 0`, `rows: []`,
 *   data rows                       `aborted: null` — that is the correct steady
 *                                   state of a Form nobody has answered yet, and
 *                                   making it an abort would put the scheduled cron
 *                                   into permanent alarm over a healthy sheet.
 *   Sheet published as a web page   `aborted: "html_not_csv"` with the fix in the
 *                                   detail. See `looksLikeHtml`.
 *   Email matching no student       `unknown_student`, decided in ingest.ts
 *                                   because it needs the database. Per-row, so
 *                                   the rest of the cohort still ingests.
 */
export function parseSubmissionCsv(csvText: string): ParseCsvResult {
  const empty: ParseCsvResult = {
    aborted: null,
    rowsSeen: 0,
    rows: [],
    skipped: [],
    skipReasonCounts: {},
    columns: {
      timestamp: -1,
      email: -1,
      githubUrl: -1,
      liveUrl: -1,
      description: -1,
      respondentName: -1,
    },
  };

  if (csvText.trim() === "") return { ...empty, aborted: "empty_csv" };

  // DEFENCE IN DEPTH. fetchPublishedCsv already refuses an HTML body, but this
  // function is also called directly (by tests, and by any future caller that has
  // a body from somewhere else). Checking here means the misleading
  // `no_email_column` verdict cannot come back through a second door. No
  // content-type is available at this layer, so this is the body sniff alone.
  if (looksLikeHtml(csvText)) return { ...empty, aborted: "html_not_csv" };

  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    // Blank lines are kept so they can be reported as `blank_row` rather than
    // vanishing — a sheet full of spacer rows is a sheet someone should fix.
    skipEmptyLines: false,
    // Every value is treated as text. Dynamic typing would coerce a timestamp
    // cell to a number on some locales and defeat parseSheetTimestamp.
    dynamicTyping: false,
  });

  const allRows = (parsed.data ?? []).map((row) => (Array.isArray(row) ? row : []));
  const headerIndex = allRows.findIndex((row) => row.some((cell) => (cell ?? "").trim() !== ""));
  if (headerIndex === -1) return { ...empty, aborted: "empty_csv" };

  const header = allRows[headerIndex].map((c) => c ?? "");
  const columns = mapColumns(header);

  if (columns.email === -1) return { ...empty, aborted: "no_email_column", columns };
  if (columns.timestamp === -1) return { ...empty, aborted: "no_timestamp_column", columns };

  const dataRows = allRows.slice(headerIndex + 1);
  const skipped: SkippedRow[] = [];
  const candidates: ParsedSheetRow[] = [];
  const seenRowRefs = new Map<string, number>();

  const cell = (row: readonly string[], index: number): string =>
    index === -1 ? "" : (row[index] ?? "").trim();

  dataRows.forEach((row, i) => {
    const rowNumber = i + 1;

    if (!row.some((c) => (c ?? "").trim() !== "")) {
      skipped.push({ rowNumber, reason: "blank_row", detail: "Every cell in the row is empty." });
      return;
    }

    const rawEmail = cell(row, columns.email);
    if (rawEmail === "") {
      skipped.push({
        rowNumber,
        reason: "missing_email",
        detail: `The "${header[columns.email]}" cell is empty, so the row cannot be matched to a student.`,
      });
      return;
    }
    if (!looksLikeEmail(rawEmail)) {
      skipped.push({
        rowNumber,
        reason: "invalid_email",
        detail: `"${rawEmail}" is not a usable email address.`,
        email: rawEmail,
      });
      return;
    }
    const email = rawEmail.toLowerCase();

    const rawTimestamp = cell(row, columns.timestamp);
    if (rawTimestamp === "") {
      skipped.push({
        rowNumber,
        reason: "missing_timestamp",
        detail:
          `The "${header[columns.timestamp]}" cell is empty. Without a timestamp there is no ` +
          "stable row reference and no submission time to check against the deadline.",
        email,
      });
      return;
    }
    const submittedAt = parseSheetTimestamp(rawTimestamp);
    if (submittedAt === null) {
      skipped.push({
        rowNumber,
        reason: "malformed_timestamp",
        detail: `"${rawTimestamp}" is not a recognised timestamp format.`,
        email,
      });
      return;
    }

    const ref = deriveRowRef({ email, submittedAt });
    if (!ref.ok) {
      skipped.push({
        rowNumber,
        reason: ref.reason === "missing_email" ? "missing_email" : "no_row_ref",
        detail: "Could not derive a stable sheet row reference for this row.",
        email,
      });
      return;
    }

    const firstSeenAt = seenRowRefs.get(ref.rowRef);
    if (firstSeenAt !== undefined) {
      skipped.push({
        rowNumber,
        reason: "duplicate_row_ref_in_batch",
        detail:
          `Identical to row ${firstSeenAt} (same student, same timestamp to the second). ` +
          "The sheet contains a literal duplicate row.",
        email,
      });
      return;
    }
    seenRowRefs.set(ref.rowRef, rowNumber);

    candidates.push({
      rowNumber,
      email,
      submittedAt,
      rowRef: ref.rowRef,
      githubUrl: normaliseUrl(cell(row, columns.githubUrl)),
      liveUrl: normaliseUrl(cell(row, columns.liveUrl)),
      description: cell(row, columns.description) || null,
      respondentName: cell(row, columns.respondentName) || null,
    });
  });

  const { kept, superseded } = keepLatestPerStudent(candidates);
  skipped.push(...superseded);

  return {
    aborted: null,
    rowsSeen: dataRows.length,
    rows: kept,
    skipped,
    skipReasonCounts: countSkipReasons(skipped),
    columns,
  };
}

/**
 * Collapse multiple responses from one student to their latest.
 *
 * A Google Form set to allow edits or simply filled in twice produces several
 * rows for the same person. Ingesting all of them would give one student several
 * submission rows for one assignment, and the instructor queue would show
 * duplicates with no way to tell which is current.
 *
 * The LATEST response wins, because that is what the student most recently chose
 * to hand in. Losers are reported as `superseded_by_later_response` rather than
 * dropped quietly, so a student claiming "I resubmitted" can be checked. Ties on
 * the timestamp are broken by the later physical row, matching the sheet's own
 * append order.
 */
export function keepLatestPerStudent(rows: readonly ParsedSheetRow[]): {
  kept: ParsedSheetRow[];
  superseded: SkippedRow[];
} {
  const winners = new Map<string, ParsedSheetRow>();
  for (const row of rows) {
    const current = winners.get(row.email);
    if (
      !current ||
      row.submittedAt.getTime() > current.submittedAt.getTime() ||
      (row.submittedAt.getTime() === current.submittedAt.getTime() &&
        row.rowNumber > current.rowNumber)
    ) {
      winners.set(row.email, row);
    }
  }

  const keptRefs = new Set([...winners.values()].map((r) => r.rowRef));
  const superseded: SkippedRow[] = rows
    .filter((r) => !keptRefs.has(r.rowRef))
    .map((r) => {
      const winner = winners.get(r.email)!;
      return {
        rowNumber: r.rowNumber,
        reason: "superseded_by_later_response" as const,
        detail:
          `This student also submitted at ${winner.submittedAt.toISOString()} (row ` +
          `${winner.rowNumber}), which is the response that counts.`,
        email: r.email,
      };
    });

  // Preserve sheet order for the kept rows; a Map iterates in insertion order,
  // which is first-seen-per-student, not sheet order of the winning row.
  const kept = [...winners.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  return { kept, superseded };
}
