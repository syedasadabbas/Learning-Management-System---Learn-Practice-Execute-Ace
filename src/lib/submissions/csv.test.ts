// =============================================================================
// Unit tests — Google Sheet CSV parsing against controlled fixtures.
// Owner: submissions stream. No database, no network.
// -----------------------------------------------------------------------------
// TODO(test): these fixtures are hand-written CSV bodies, NOT a real published
// Google Sheet. `assignments.google_form_url` and `google_sheet_csv_url` are both
// NULL in the seeded data (see the TODO(decision) in scripts/seed.ts), so no live
// sheet exists to verify against. What is therefore UNVERIFIED:
//   - the exact header text a real Form produces for each question;
//   - the timestamp format and spreadsheet timezone of the real sheet;
//   - whether the published-CSV endpoint 307-redirects as assumed in fetch-csv.ts.
// The header-alias table and parseSheetTimestamp are the two places a surprise
// will land. Re-run these tests against a real sheet export before a cohort
// depends on ingestion. No fabricated Google URL is used anywhere in this suite.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  keepLatestPerStudent,
  looksLikeEmail,
  looksLikeHtml,
  mapColumns,
  normaliseHeader,
  normaliseUrl,
  parseSheetTimestamp,
  parseSubmissionCsv,
  type ParsedSheetRow,
} from "./csv";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The shape a default Google Form response sheet is expected to export. */
const CANONICAL_CSV = [
  "Timestamp,Email Address,GitHub Repository URL,Live Site URL,Notes",
  "9/8/2026 14:03:21,ada@example.test,https://github.com/ada/week1,https://ada.example.test,All requirements done",
  "9/9/2026 09:15:00,grace@example.test,https://github.com/grace/week1,,Struggled with flexbox",
].join("\n");

/** Same data, different question wording and an ISO timestamp column. */
const VARIANT_HEADERS_CSV = [
  "Submitted At,Email Address (auto-collected),GitHub Link,Deployed URL,Comments / notes,Full Name",
  "2026-09-08 14:03:21,ADA@Example.test,github.com/ada/week1,ada.example.test,Done,Ada L",
].join("\n");

describe("normaliseHeader", () => {
  it("collapses case, spaces and punctuation", () => {
    expect(normaliseHeader("Email Address (auto-collected)")).toBe("emailaddressautocollected");
    expect(normaliseHeader("  GitHub / Repo URL  ")).toBe("githubrepourl");
  });
});

describe("mapColumns — header variations", () => {
  it("maps the canonical Google Forms header row", () => {
    const map = mapColumns([
      "Timestamp",
      "Email Address",
      "GitHub Repository URL",
      "Live Site URL",
      "Notes",
    ]);
    expect(map).toMatchObject({
      timestamp: 0,
      email: 1,
      githubUrl: 2,
      liveUrl: 3,
      description: 4,
      respondentName: -1,
    });
  });

  it("maps reworded questions via aliases and substring fallback", () => {
    const map = mapColumns([
      "Submitted At",
      "Email Address (auto-collected)",
      "GitHub Link",
      "Deployed URL",
      "Comments / notes",
      "Full Name",
    ]);
    expect(map).toMatchObject({
      timestamp: 0,
      email: 1,
      githubUrl: 2,
      liveUrl: 3,
      description: 4,
      respondentName: 5,
    });
  });

  it("prefers the more specific alias when both a loose and a specific column exist", () => {
    const map = mapColumns(["Timestamp", "Email", "Email Address"]);
    // "emailaddress" is tried before the looser "email", so the auto-collected
    // address wins over a free-text one the student typed.
    expect(map.email).toBe(2);
  });

  it("reports absent optional columns as -1 instead of guessing", () => {
    const map = mapColumns(["Timestamp", "Email Address"]);
    expect(map.githubUrl).toBe(-1);
    expect(map.liveUrl).toBe(-1);
    expect(map.description).toBe(-1);
  });

  it("never assigns one physical column to two logical fields", () => {
    const map = mapColumns(["Timestamp", "Email Address", "GitHub URL"]);
    const claimed = Object.values(map).filter((i) => i !== -1);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});

describe("parseSheetTimestamp", () => {
  it("parses the Google Forms US default, 24-hour", () => {
    expect(parseSheetTimestamp("9/8/2026 14:03:21")?.toISOString()).toBe(
      "2026-09-08T14:03:21.000Z",
    );
  });

  it("parses the US default with a comma separator and no seconds", () => {
    expect(parseSheetTimestamp("9/8/2026, 14:03")?.toISOString()).toBe("2026-09-08T14:03:00.000Z");
  });

  it("parses a 12-hour clock with a meridiem", () => {
    expect(parseSheetTimestamp("9/8/2026 2:03:21 PM")?.toISOString()).toBe(
      "2026-09-08T14:03:21.000Z",
    );
    expect(parseSheetTimestamp("9/8/2026 12:30:00 AM")?.toISOString()).toBe(
      "2026-09-08T00:30:00.000Z",
    );
    expect(parseSheetTimestamp("9/8/2026 12:30:00 PM")?.toISOString()).toBe(
      "2026-09-08T12:30:00.000Z",
    );
  });

  it("parses a zoneless ISO timestamp as UTC (the documented decision)", () => {
    expect(parseSheetTimestamp("2026-09-08 14:03:21")?.toISOString()).toBe(
      "2026-09-08T14:03:21.000Z",
    );
  });

  it("respects an explicit offset when the sheet provides one", () => {
    expect(parseSheetTimestamp("2026-09-08T14:03:21+05:30")?.toISOString()).toBe(
      "2026-09-08T08:33:21.000Z",
    );
    expect(parseSheetTimestamp("2026-09-08T14:03:21Z")?.toISOString()).toBe(
      "2026-09-08T14:03:21.000Z",
    );
  });

  it("rejects free text rather than inventing a date via Date.parse", () => {
    for (const bad of [
      "not a date",
      "yesterday",
      "n/a",
      "-",
      "0",
      "8 September 2026",
      "2026-13-01 00:00:00",
      "2026-02-30 00:00:00",
      "9/8/2026 25:00:00",
      "9/8/2026 13:00:00 PM",
      "2026/09/08 14:03",
    ]) {
      expect(parseSheetTimestamp(bad), `expected "${bad}" to be rejected`).toBeNull();
    }
  });

  it("returns null for an empty cell", () => {
    expect(parseSheetTimestamp("")).toBeNull();
    expect(parseSheetTimestamp("   ")).toBeNull();
  });
});

describe("looksLikeEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(looksLikeEmail("ada@example.test")).toBe(true);
    expect(looksLikeEmail("a.b+week1@sub.example.co")).toBe(true);
  });

  it("rejects the junk students actually type", () => {
    for (const bad of ["n/a", "-", "none", "ada", "ada@", "@example.test", "https://x.test", "a b@c.test"]) {
      expect(looksLikeEmail(bad), `expected "${bad}" to be rejected`).toBe(false);
    }
  });
});

describe("normaliseUrl", () => {
  it("keeps an absolute https URL", () => {
    expect(normaliseUrl("https://github.com/ada/week1")).toBe("https://github.com/ada/week1");
  });

  it("upgrades a bare host to https, because students paste it that way", () => {
    expect(normaliseUrl("github.com/ada/week1")).toBe("https://github.com/ada/week1");
    expect(normaliseUrl("ada.example.test")).toBe("https://ada.example.test");
  });

  it("returns null for an empty or non-URL cell", () => {
    expect(normaliseUrl("")).toBeNull();
    expect(normaliseUrl(undefined)).toBeNull();
    expect(normaliseUrl("will do it later")).toBeNull();
  });

  it("drops a URL longer than the varchar(500) column instead of truncating it", () => {
    expect(normaliseUrl(`https://x.test/${"a".repeat(600)}`)).toBeNull();
  });
});

describe("parseSubmissionCsv — happy path", () => {
  it("parses the canonical sheet into one row per response", () => {
    const result = parseSubmissionCsv(CANONICAL_CSV);
    expect(result.aborted).toBeNull();
    expect(result.rowsSeen).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.rows).toHaveLength(2);

    expect(result.rows[0]).toMatchObject({
      rowNumber: 1,
      email: "ada@example.test",
      githubUrl: "https://github.com/ada/week1",
      liveUrl: "https://ada.example.test",
      description: "All requirements done",
    });
    expect(result.rows[0].submittedAt.toISOString()).toBe("2026-09-08T14:03:21.000Z");
    expect(result.rows[0].rowRef).toMatch(/^v1:[0-9a-f]{32}$/);

    // An empty optional cell is null, not "".
    expect(result.rows[1].liveUrl).toBeNull();
  });

  it("parses reworded headers, lowercases the email, and upgrades bare hosts", () => {
    const result = parseSubmissionCsv(VARIANT_HEADERS_CSV);
    expect(result.aborted).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      email: "ada@example.test",
      githubUrl: "https://github.com/ada/week1",
      liveUrl: "https://ada.example.test",
      respondentName: "Ada L",
    });
  });

  it("is stable across re-parses — the same CSV yields the same row refs", () => {
    const first = parseSubmissionCsv(CANONICAL_CSV).rows.map((r) => r.rowRef);
    const second = parseSubmissionCsv(CANONICAL_CSV).rows.map((r) => r.rowRef);
    expect(second).toEqual(first);
  });

  it("row refs survive the sheet being re-sorted — position is not part of the key", () => {
    const lines = CANONICAL_CSV.split("\n");
    const reordered = [lines[0], lines[2], lines[1]].join("\n");
    const original = new Set(parseSubmissionCsv(CANONICAL_CSV).rows.map((r) => r.rowRef));
    const shuffled = new Set(parseSubmissionCsv(reordered).rows.map((r) => r.rowRef));
    expect(shuffled).toEqual(original);
  });

  it("tolerates CRLF line endings and a UTF-8 BOM", () => {
    const withBom = `﻿${CANONICAL_CSV.split("\n").join("\r\n")}`;
    const result = parseSubmissionCsv(withBom);
    expect(result.aborted).toBeNull();
    expect(result.rows).toHaveLength(2);
  });

  it("tolerates quoted fields containing commas and newlines", () => {
    const csv = [
      "Timestamp,Email Address,GitHub Repository URL,Live Site URL,Notes",
      '9/8/2026 14:03:21,ada@example.test,https://github.com/ada/w1,,"Did the nav, the hero,',
      'and the footer"',
    ].join("\n");
    const result = parseSubmissionCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].description).toContain("the footer");
  });
});

describe("parseSubmissionCsv — whole-sheet aborts", () => {
  it("reports empty_csv for an empty body", () => {
    expect(parseSubmissionCsv("").aborted).toBe("empty_csv");
    expect(parseSubmissionCsv("   \n\n").aborted).toBe("empty_csv");
  });

  it("reports no_email_column when nothing can be matched to a student", () => {
    const result = parseSubmissionCsv(
      ["Timestamp,GitHub Repository URL", "9/8/2026 14:03:21,https://github.com/ada/w1"].join("\n"),
    );
    expect(result.aborted).toBe("no_email_column");
    expect(result.rows).toEqual([]);
  });

  it("reports no_timestamp_column, because no stable row ref can be derived without it", () => {
    const result = parseSubmissionCsv(
      ["Email Address,GitHub Repository URL", "ada@example.test,https://github.com/ada/w1"].join(
        "\n",
      ),
    );
    expect(result.aborted).toBe("no_timestamp_column");
  });
});

describe("parseSubmissionCsv — one bad row never aborts the batch", () => {
  const MESSY_CSV = [
    "Timestamp,Email Address,GitHub Repository URL,Live Site URL,Notes",
    // 1 — fine
    "9/8/2026 09:00:00,ada@example.test,https://github.com/ada/w1,,ok",
    // 2 — completely blank row (a spacer, or a trailing newline artefact)
    ",,,,",
    // 3 — no email
    "9/8/2026 10:00:00,,https://github.com/nobody/w1,,ok",
    // 4 — junk in the email cell
    "9/8/2026 11:00:00,n/a,https://github.com/nobody/w1,,ok",
    // 5 — malformed timestamp
    "sometime last week,grace@example.test,https://github.com/grace/w1,,ok",
    // 6 — missing timestamp
    ",linus@example.test,https://github.com/linus/w1,,ok",
    // 7 — fine
    "9/8/2026 12:00:00,grace@example.test,https://github.com/grace/w1,,ok",
    // 8 — fine, and a second response from Ada (later than row 1)
    "9/8/2026 13:00:00,ada@example.test,https://github.com/ada/w1-fixed,,resubmitted",
    // 9 — literal duplicate of row 7 (same student, same second)
    "9/8/2026 12:00:00,grace@example.test,https://github.com/grace/w1,,ok",
  ].join("\n");

  const result = parseSubmissionCsv(MESSY_CSV);

  it("does not abort", () => {
    expect(result.aborted).toBeNull();
    expect(result.rowsSeen).toBe(9);
  });

  it("still ingests the good rows", () => {
    // Ada's later response and Grace's single valid response.
    expect(result.rows.map((r) => r.email).sort()).toEqual(["ada@example.test", "grace@example.test"]);
    expect(result.rows.find((r) => r.email === "ada@example.test")?.githubUrl).toBe(
      "https://github.com/ada/w1-fixed",
    );
  });

  it("skips each bad row with a specific, actionable reason", () => {
    const byRow = new Map(result.skipped.map((s) => [s.rowNumber, s.reason]));
    expect(byRow.get(2)).toBe("blank_row");
    expect(byRow.get(3)).toBe("missing_email");
    expect(byRow.get(4)).toBe("invalid_email");
    expect(byRow.get(5)).toBe("malformed_timestamp");
    expect(byRow.get(6)).toBe("missing_timestamp");
    expect(byRow.get(9)).toBe("duplicate_row_ref_in_batch");
    // Ada's earlier response lost to her later one.
    expect(byRow.get(1)).toBe("superseded_by_later_response");
  });

  it("reports a per-run skip tally", () => {
    expect(result.skipReasonCounts).toEqual({
      blank_row: 1,
      missing_email: 1,
      invalid_email: 1,
      malformed_timestamp: 1,
      missing_timestamp: 1,
      duplicate_row_ref_in_batch: 1,
      superseded_by_later_response: 1,
    });
    expect(result.rowsSeen).toBe(result.rows.length + result.skipped.length);
  });

  it("names the row number and the email so the sheet can be corrected", () => {
    const malformed = result.skipped.find((s) => s.reason === "malformed_timestamp");
    expect(malformed).toMatchObject({ rowNumber: 5, email: "grace@example.test" });
    expect(malformed?.detail).toContain("sometime last week");
  });

  it("never produces a row without a usable row ref", () => {
    for (const row of result.rows) {
      expect(row.rowRef).toBeTruthy();
      expect(row.rowRef.trim()).not.toBe("");
    }
  });
});

describe("keepLatestPerStudent", () => {
  const row = (email: string, iso: string, rowNumber: number): ParsedSheetRow => ({
    rowNumber,
    email,
    submittedAt: new Date(iso),
    rowRef: `ref-${rowNumber}`,
    githubUrl: null,
    liveUrl: null,
    description: null,
    respondentName: null,
  });

  it("keeps the latest response per student and reports the rest", () => {
    const { kept, superseded } = keepLatestPerStudent([
      row("ada@example.test", "2026-09-08T09:00:00Z", 1),
      row("ada@example.test", "2026-09-08T13:00:00Z", 2),
      row("grace@example.test", "2026-09-08T10:00:00Z", 3),
    ]);
    expect(kept.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({ rowNumber: 1, reason: "superseded_by_later_response" });
  });

  it("breaks a timestamp tie with the later physical row, matching sheet append order", () => {
    const { kept } = keepLatestPerStudent([
      row("ada@example.test", "2026-09-08T09:00:00Z", 1),
      row("ada@example.test", "2026-09-08T09:00:00Z", 2),
    ]);
    expect(kept.map((r) => r.rowNumber)).toEqual([2]);
  });

  it("returns kept rows in sheet order", () => {
    const { kept } = keepLatestPerStudent([
      row("grace@example.test", "2026-09-08T09:00:00Z", 1),
      row("ada@example.test", "2026-09-08T10:00:00Z", 2),
      row("grace@example.test", "2026-09-08T11:00:00Z", 3),
    ]);
    expect(kept.map((r) => r.rowNumber)).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// REAL-WORLD SHEET SHAPES — added 2026-07-31
// ---------------------------------------------------------------------------
// Everything above was written against a sheet this repository shapes itself. The
// group below is the list of things a REAL published Google Sheet does that the
// stand-in never will. Each case has exactly one requirement: a clear, reported,
// non-fatal outcome — never a crash, never a silent drop.
// ---------------------------------------------------------------------------

describe("looksLikeHtml — the wrong publish setting", () => {
  it("recognises a full HTML document", () => {
    expect(looksLikeHtml("<!DOCTYPE html>\n<html><body>x</body></html>")).toBe(true);
    expect(looksLikeHtml("<html><head><title>Sheet</title></head></html>")).toBe(true);
  });

  it("recognises markup that opens with something other than <html>", () => {
    // Google's published-page templates do this.
    expect(looksLikeHtml('<meta charset="utf-8"><table>...')).toBe(true);
    expect(looksLikeHtml("<style>#t{}</style><html>")).toBe(true);
    expect(looksLikeHtml('<?xml version="1.0"?><feed>')).toBe(true);
  });

  it("tolerates a leading BOM and whitespace, which a published body often carries", () => {
    expect(looksLikeHtml("﻿  \n<!doctype html><html>")).toBe(true);
  });

  it("trusts an explicit text/html content type even when the body is inconclusive", () => {
    expect(looksLikeHtml("nothing conclusive here", "text/html; charset=utf-8")).toBe(true);
  });

  it("does NOT flag a real CSV whose CELLS contain markup", () => {
    // THE FALSE POSITIVE THAT WOULD MATTER. "Anything else you want us to know?" is
    // a free-text question, and a student pasting a tag into it must not take the
    // whole cohort's ingest down. Only the LEADING bytes are sniffed, and a cell
    // cannot precede the header row.
    const csv = [
      "Timestamp,Email Address,Notes",
      '9/8/2026 14:03:21,ada@example.test,"I used <html> and <body> tags"',
    ].join("\n");
    expect(looksLikeHtml(csv)).toBe(false);
    expect(looksLikeHtml(csv, "text/csv; charset=utf-8")).toBe(false);
    expect(parseSubmissionCsv(csv).aborted).toBeNull();
  });

  it("does not flag an ordinary CSV", () => {
    expect(looksLikeHtml(CANONICAL_CSV)).toBe(false);
    expect(looksLikeHtml("")).toBe(false);
  });
});

describe("parseSubmissionCsv — a sheet published as a web page", () => {
  it("reports html_not_csv rather than the misleading no_email_column", () => {
    // BEFORE THIS EXISTED the run aborted with `no_email_column`, which told the
    // operator to go and inspect their Form's question wording — the one thing that
    // was not wrong. This is the single likeliest real misconfiguration of the two
    // URLs, because Google's publish dialog defaults to "Web page".
    const html = [
      "<!DOCTYPE html>",
      '<html><head><meta charset="utf-8"><title>Week 1 responses</title></head>',
      "<body><table><tr><td>Timestamp</td><td>Email Address</td></tr></table></body></html>",
    ].join("\n");
    const result = parseSubmissionCsv(html);
    expect(result.aborted).toBe("html_not_csv");
    expect(result.rows).toEqual([]);
    expect(result.rowsSeen).toBe(0);
  });
});

describe("parseSubmissionCsv — an empty response sheet", () => {
  it("a header row with no responses is HEALTHY, not an abort", () => {
    // The steady state of a Form nobody has answered yet. Aborting here would put
    // the hourly cron into permanent alarm over a sheet that is working perfectly,
    // and an operator who learns to ignore the report page cannot be told anything
    // by it later.
    const result = parseSubmissionCsv("Timestamp,Email Address,GitHub Repository URL\n");
    expect(result.aborted).toBeNull();
    expect(result.rows).toEqual([]);
    // The columns still resolved, which is what proves the header was read at all.
    expect(result.columns.email).toBe(1);

    // rowsSeen is 1, not 0, and that is CORRECT rather than a rounding error: a
    // published sheet ends with a newline, so there is one physically present final
    // row and it is empty. It is reported as `blank_row` rather than being silently
    // discounted, because "rows seen" means rows the sheet contained and a reader
    // comparing this figure against the sheet must get the same answer. Nothing
    // downstream treats it as a response.
    expect(result.rowsSeen).toBe(1);
    expect(result.skipReasonCounts).toEqual({ blank_row: 1 });
    expect(result.skipped.filter((s) => s.reason !== "blank_row")).toEqual([]);
  });

  it("a header row with no trailing newline sees no rows at all", () => {
    const result = parseSubmissionCsv("Timestamp,Email Address");
    expect(result.aborted).toBeNull();
    expect(result.rowsSeen).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("a body with no bytes at all is empty_csv, which is a BROKEN sheet", () => {
    expect(parseSubmissionCsv("").aborted).toBe("empty_csv");
  });
});

describe("parseSubmissionCsv — reordered and rewritten headers", () => {
  it("resolves fields by header text, so column ORDER is irrelevant", () => {
    // A course owner who drags a Form question above another changes the sheet's
    // column order. Nothing here is positional, so this must simply work.
    const reordered = [
      "Live Site URL,Anything else you want us to know?,Email Address,Timestamp,GitHub Repository URL",
      "https://ada.example.test,All done,ada@example.test,2026-09-08 14:03:21,https://github.com/ada/w1",
    ].join("\n");
    const result = parseSubmissionCsv(reordered);
    expect(result.aborted).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      email: "ada@example.test",
      githubUrl: "https://github.com/ada/w1",
      liveUrl: "https://ada.example.test",
      description: "All done",
    });
  });

  it("survives question text edited past the exact alias, via the substring pass", () => {
    const edited = [
      "Timestamp,What is your email address?,Paste your GitHub repository URL here (public please),Where is your live site URL hosted?,Anything else?",
      "2026-09-08 14:03:21,ada@example.test,https://github.com/ada/w1,https://ada.example.test,ok",
    ].join("\n");
    const result = parseSubmissionCsv(edited);
    expect(result.aborted).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe("ada@example.test");
    expect(result.rows[0].githubUrl).toBe("https://github.com/ada/w1");
    expect(result.rows[0].liveUrl).toBe("https://ada.example.test");
  });

  it("aborts CLEARLY when the edit went too far for email to be found", () => {
    // The honest limit of the tolerance above. Better a named abort than a run that
    // reports "0 responses" against a sheet full of them.
    const result = parseSubmissionCsv(
      ["Timestamp,How can we reach you?,Repo", "2026-09-08 14:03:21,ada@example.test,x"].join("\n"),
    );
    expect(result.aborted).toBe("no_email_column");
  });

  it("ignores extra columns Google or the owner added", () => {
    const extra = [
      "Timestamp,Email Address,Score,Reviewed by,GitHub Repository URL,Internal notes",
      "2026-09-08 14:03:21,ada@example.test,7,Bob,https://github.com/ada/w1,n/a",
    ].join("\n");
    const result = parseSubmissionCsv(extra);
    expect(result.aborted).toBeNull();
    expect(result.rows[0].githubUrl).toBe("https://github.com/ada/w1");
  });
});

describe("parseSubmissionCsv — one respondent answering more than once", () => {
  // THE DECISION, STATED: LAST WINS. A student who resubmits meant the second one;
  // treating the first as final would mark work they had already replaced. The
  // losers are REPORTED (`superseded_by_later_response`), never dropped quietly, so
  // "I resubmitted" can be checked against the report rather than argued about.
  const twice = [
    "Timestamp,Email Address,GitHub Repository URL,Live Site URL,Notes",
    "2026-09-08 09:00:00,ada@example.test,https://github.com/ada/first,,First attempt",
    "2026-09-09 18:30:00,ada@example.test,https://github.com/ada/second,,Second attempt",
  ].join("\n");

  it("keeps the LATEST response and reports the earlier one", () => {
    const result = parseSubmissionCsv(twice);
    expect(result.aborted).toBeNull();
    expect(result.rowsSeen).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].githubUrl).toBe("https://github.com/ada/second");
    expect(result.skipReasonCounts.superseded_by_later_response).toBe(1);
    // The report names the WINNING row, so a human can reconcile the two.
    const superseded = result.skipped.find((s) => s.reason === "superseded_by_later_response");
    expect(superseded?.detail).toContain("2026-09-09T18:30:00.000Z");
    expect(superseded?.email).toBe("ada@example.test");
  });

  it("is order-independent: the later timestamp wins even when listed first", () => {
    const reversed = [
      "Timestamp,Email Address,GitHub Repository URL",
      "2026-09-09 18:30:00,ada@example.test,https://github.com/ada/second",
      "2026-09-08 09:00:00,ada@example.test,https://github.com/ada/first",
    ].join("\n");
    expect(parseSubmissionCsv(reversed).rows[0].githubUrl).toBe("https://github.com/ada/second");
  });

  it("does not confuse a LITERAL duplicate with a resubmission", () => {
    // Identical to its predecessor, so the derived row ref collides and last-wins
    // cannot tell them apart. Reported as `duplicate_row_ref_in_batch` — a different
    // fact about the sheet, and one the owner should fix.
    const literal = [
      "Timestamp,Email Address,GitHub Repository URL",
      "2026-09-08 09:00:00,ada@example.test,https://github.com/ada/w1",
      "2026-09-08 09:00:00,ada@example.test,https://github.com/ada/w1",
    ].join("\n");
    const result = parseSubmissionCsv(literal);
    expect(result.rows).toHaveLength(1);
    expect(result.skipReasonCounts.duplicate_row_ref_in_batch).toBe(1);
    expect(result.skipReasonCounts.superseded_by_later_response).toBeUndefined();
  });

  it("does not let one student's duplicate affect another student's row", () => {
    const mixed = [
      "Timestamp,Email Address,GitHub Repository URL",
      "2026-09-08 09:00:00,ada@example.test,https://github.com/ada/first",
      "2026-09-08 10:00:00,grace@example.test,https://github.com/grace/only",
      "2026-09-09 18:30:00,ada@example.test,https://github.com/ada/second",
    ].join("\n");
    const result = parseSubmissionCsv(mixed);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.email).sort()).toEqual([
      "ada@example.test",
      "grace@example.test",
    ]);
    expect(result.rows.find((r) => r.email === "ada@example.test")?.githubUrl).toBe(
      "https://github.com/ada/second",
    );
  });
});
