// =============================================================================
// Tests for the compliance export.
//
// The formula-injection cases are the reason this file exists. A CSV from an audit
// log is opened in Excel by the person least likely to notice that a cell has
// executed something.
// =============================================================================

import { describe, it, expect } from "vitest";

import { CSV_COLUMNS, csvCell, csvFilename, csvLine, toCsv, type ExportRow } from "./csv";

const ROW: ExportRow = {
  occurredAt: new Date("2026-07-31T09:15:00.000Z"),
  action: "login",
  status: "success",
  actorId: 7,
  actorName: "Demo Student",
  actorEmail: "student@codequeenshub.test",
  actorRole: "student",
  entityType: "user",
  entityId: 7,
  ipPrefix: "203.0.113.0/24",
  clientFamily: "Chrome on Windows",
  errorCode: null,
  correlationId: "iad1::abc123",
  details: { weekId: 3 },
};

describe("formula injection is neutralised in every field", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["=HYPERLINK(\"http://evil\",\"click\")", null],
    ["+1234567890", "'+1234567890"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["-2+3", "'-2+3"],
    ["=cmd|'/c calc'!A0", null],
  ])("prefixes a leading formula character in %s", (input, expected) => {
    const cell = csvCell(input);
    // Either the exact expected value, or (for cases containing quotes/commas that
    // then get RFC-4180 quoted) at least the apostrophe immediately inside.
    if (expected) {
      expect(cell).toBe(expected);
    } else {
      expect(cell.startsWith("\"'") || cell.startsWith("'")).toBe(true);
    }
  });

  it("does not mangle a legitimate negative number's value", () => {
    // Stripping the character instead of quoting it would silently corrupt data,
    // and this table exports integers.
    expect(csvCell(-5)).toBe("'-5");
    expect(csvCell(-5).replace(/^'/, "")).toBe("-5");
  });

  it("leaves an ordinary value untouched", () => {
    expect(csvCell("login")).toBe("login");
    expect(csvCell(441)).toBe("441");
  });

  it("neutralises a formula that arrived inside details", () => {
    // details is jsonb, so it is serialised — and JSON.stringify's output starts
    // with `{`, which is safe. The values inside are still quoted by the CSV rules.
    const cell = csvCell({ slug: "=1+1" });
    expect(cell.startsWith("\"{")).toBe(true);
    expect(cell).toContain("=1+1");
    // The cell as a whole cannot be evaluated, because it does not START with a
    // formula character.
    expect(cell.startsWith("=")).toBe(false);
  });
});

describe("RFC 4180 quoting", () => {
  it("quotes and doubles an embedded quote", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field containing a comma", () => {
    expect(csvCell("Doe, Jane")).toBe('"Doe, Jane"');
  });

  it("quotes a field containing a newline", () => {
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("renders null and undefined as an empty field, not the word null", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("control characters cannot break the row structure", () => {
  it("strips a NUL, a bare CR and a vertical tab", () => {
    const hostile = "a" + String.fromCharCode(0) + "b" + String.fromCharCode(13) + "c" + String.fromCharCode(11) + "d";
    expect(csvCell(hostile)).toBe("abcd");
  });

  it("strips a leading TAB, which would otherwise be a formula leader", () => {
    expect(csvCell("\t=1+1")).toBe("'=1+1");
  });

  it("keeps a newline, which quoting handles and a reviewer should still see", () => {
    expect(csvCell("a\nb")).toContain("\n");
  });
});

describe("timestamps", () => {
  it("are ISO-8601 UTC, never locale-formatted", () => {
    expect(csvCell(new Date("2026-07-31T09:15:00Z"))).toBe("2026-07-31T09:15:00.000Z");
  });
});

describe("document shape", () => {
  it("starts with the header row in column order", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("uses CRLF endings and terminates the last line", () => {
    const csv = toCsv([ROW]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("emits one cell per declared column", () => {
    // Guards the hand-maintained cell list in csvLine against the column list
    // drifting away from it — a shifted column in a compliance export silently
    // mislabels every value after it.
    const cells = csvLine(ROW).split(",").length;
    // "Demo Student" has no comma, so a plain split is a valid count for this row.
    expect(cells).toBe(CSV_COLUMNS.length);
  });

  it("renders an empty export as a header and nothing else", () => {
    expect(toCsv([])).toBe(`${CSV_COLUMNS.join(",")}\r\n`);
  });
});

describe("filename", () => {
  it("carries the generation instant so two exports never collide", () => {
    const name = csvFilename(new Date("2026-07-31T09:15:00Z"));
    expect(name).toBe("activity-log-2026-07-31T09-15-00.csv");
  });

  it("contains no character that needs escaping in a Content-Disposition header", () => {
    expect(csvFilename()).toMatch(/^activity-log-[0-9T:-]+\.csv$/);
  });
});
