// =============================================================================
// CSV EXPORT TESTS — instructor-admin stream.
// -----------------------------------------------------------------------------
// Two properties matter: the file is well-formed for a spreadsheet, and it never
// carries a credential. The second is asserted directly, because "never expose
// password hashes" is a rule that only holds if something checks it.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  assertNoSecretColumns,
  buildCsv,
  escapeCsvField,
  exportFilename,
  GRADE_EXPORT_COLUMNS,
  type CsvColumn,
  type GradeExportRow,
} from "./csv";

const ROW: GradeExportRow = {
  studentName: "Ada Lovelace",
  studentEmail: "ada@example.test",
  cohortName: "Cohort 1",
  weekNumber: 2,
  assignmentTitle: "Responsive layout",
  status: "graded",
  score: 36,
  stars: 4,
  isLate: false,
  submittedAt: new Date("2026-09-14T10:30:00Z"),
  gradedAt: new Date("2026-09-15T09:00:00Z"),
  instructorName: "Demo Instructor",
};

describe("escapeCsvField", () => {
  it("leaves a plain value alone", () => {
    expect(escapeCsvField("Ada")).toBe("Ada");
    expect(escapeCsvField(36)).toBe("36");
  });

  it("renders null and undefined as an empty field", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes a value containing a comma — student names do", () => {
    expect(escapeCsvField("Lovelace, Ada")).toBe('"Lovelace, Ada"');
  });

  it("doubles internal quotes per RFC 4180", () => {
    expect(escapeCsvField('She said "good"')).toBe('"She said ""good"""');
  });

  it("quotes a value containing a newline so feedback cannot break the row", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises a formula so a spreadsheet does not execute it", () => {
    // CSV injection: =HYPERLINK(...) or =cmd|... in a cell is executed by Excel.
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
    expect(escapeCsvField("+44 20 1234")).toBe("'+44 20 1234");
    expect(escapeCsvField("@handle")).toBe("'@handle");
    expect(escapeCsvField("-5")).toBe("'-5");
  });

  it("serialises a Date as ISO 8601 UTC", () => {
    expect(escapeCsvField(new Date("2026-09-14T10:30:00Z"))).toBe(
      "2026-09-14T10:30:00.000Z",
    );
  });

  it("renders booleans", () => {
    expect(escapeCsvField(true)).toBe("true");
    expect(escapeCsvField(false)).toBe("false");
  });
});

describe("assertNoSecretColumns — the credential deny-list", () => {
  it("throws on a passwordHash column", () => {
    expect(() => assertNoSecretColumns(["Student", "passwordHash"])).toThrow(
      /never contain credentials/,
    );
  });

  it("throws on any casing or wording of the same thing", () => {
    for (const header of [
      "Password",
      "password_hash",
      "PASSWORD",
      "Hash",
      "auth token",
      "session secret",
      "salt",
    ]) {
      expect(() => assertNoSecretColumns([header]), header).toThrow();
    }
  });

  it("accepts the real export headers", () => {
    expect(() =>
      assertNoSecretColumns(GRADE_EXPORT_COLUMNS.map((c) => c.header)),
    ).not.toThrow();
  });
});

describe("buildCsv", () => {
  it("writes a header row and one line per record, CRLF terminated", () => {
    const csv = buildCsv(GRADE_EXPORT_COLUMNS, [ROW]);
    const lines = csv.split("\r\n").filter((l) => l !== "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Student");
    expect(lines[1]).toContain("Ada Lovelace");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("returns just the header line when there is nothing to export", () => {
    // An empty export is a valid answer ("nobody has been graded yet"), not an
    // error, and a header-only file tells the reader what they would have got.
    const csv = buildCsv(GRADE_EXPORT_COLUMNS, []);
    expect(csv.split("\r\n").filter((l) => l !== "")).toHaveLength(1);
  });

  it("NEVER emits a password hash, even when the row carries one", () => {
    // Simulates a careless future projection that selected the whole users row.
    const contaminated = {
      ...ROW,
      passwordHash: "$2a$10$notarealhashbutlookslikeone",
    };
    const csv = buildCsv(GRADE_EXPORT_COLUMNS, [contaminated]);
    expect(csv).not.toContain("$2a$10$");
    expect(csv).not.toContain("passwordHash");
  });

  it("refuses to build a report whose columns include a credential", () => {
    const badColumns: CsvColumn<{ passwordHash: string }>[] = [
      { header: "passwordHash", value: (r) => r.passwordHash },
    ];
    expect(() => buildCsv(badColumns, [{ passwordHash: "x" }])).toThrow();
  });

  it("renders a missing score as an empty field rather than 0", () => {
    const ungraded: GradeExportRow = {
      ...ROW,
      status: "submitted",
      score: null,
      stars: null,
      gradedAt: null,
      instructorName: null,
    };
    const csv = buildCsv(GRADE_EXPORT_COLUMNS, [ungraded]);
    const dataLine = csv.split("\r\n")[1];
    // Four empty trailing-ish fields: score, stars, gradedAt, instructorName.
    expect(dataLine).toContain(",,");
    expect(dataLine).not.toContain(",0,");
  });

  it("keeps a comma-bearing name inside one field", () => {
    const csv = buildCsv(GRADE_EXPORT_COLUMNS, [
      { ...ROW, studentName: "Lovelace, Ada" },
    ]);
    expect(csv).toContain('"Lovelace, Ada"');
  });
});

describe("exportFilename", () => {
  it("stamps the UTC date", () => {
    expect(exportFilename("grades", new Date("2026-07-29T23:59:00Z"))).toBe(
      "grades-2026-07-29.csv",
    );
  });
});
