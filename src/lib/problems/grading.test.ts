// =============================================================================
// UNIT TESTS — output comparison. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// The SQL block is the one that earns its keep. `sql.js` in the browser renders a
// padded ASCII table with a header, a dashed separator and a "(2 rows)" footer;
// Piston's `sqlite3` prints bare `value|value` lines. A student whose query is
// correct in the browser must not fail on Submit, so both renderings have to
// canonicalise to the same string — and that is asserted directly here, one
// against the other, rather than each against a hand-written constant.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  buildRunRequest,
  canonicalise,
  canonicaliseSqlOutput,
  comparisonModeFor,
  gradeTest,
  isExecutable,
  normaliseOutput,
  outputMatches,
  tallyTests,
  type GradedTest,
} from "./grading";

const OK = { ok: true, stderr: "", exitCode: 0, runtimeMs: 12 };

describe("comparisonModeFor", () => {
  it("routes SQL to the dialect-agnostic comparator and everything else to text", () => {
    expect(comparisonModeFor("sql")).toBe("sql");
    expect(comparisonModeFor("SQLite3")).toBe("sql");
    expect(comparisonModeFor("javascript")).toBe("text");
    expect(comparisonModeFor("python")).toBe("text");
    expect(comparisonModeFor("cpp")).toBe("text");
  });
});

describe("normaliseOutput", () => {
  it("treats CRLF and LF as the same output", () => {
    expect(normaliseOutput("a\r\nb\r\n")).toBe(normaliseOutput("a\nb\n"));
  });

  it("ignores trailing spaces and the trailing newline print() adds", () => {
    expect(normaliseOutput("42   \n")).toBe("42");
    expect(normaliseOutput("42\n\n\n")).toBe("42");
  });

  it("keeps a LEADING blank line — that is different output, not formatting", () => {
    expect(normaliseOutput("\n42")).toBe("\n42");
    expect(normaliseOutput("\n42")).not.toBe(normaliseOutput("42"));
  });

  it("keeps interior blank lines", () => {
    expect(normaliseOutput("a\n\nb\n")).toBe("a\n\nb");
  });

  it("maps null and undefined to the empty string rather than crashing", () => {
    expect(normaliseOutput(null)).toBe("");
    expect(normaliseOutput(undefined)).toBe("");
  });
});

describe("canonicaliseSqlOutput", () => {
  // What sql.js prints (see src/lib/execution/browser/sqljs-worker.ts).
  const BROWSER = [
    "name  | score",
    "------+------",
    "Ada   | 91",
    "Grace | 88",
    "(2 rows)",
  ].join("\n");

  // What Piston's sqlite3 prints for the same query.
  const SERVER = ["Ada|91", "Grace|88"].join("\n");

  it("reduces both renderings of the same rows to one string", () => {
    expect(canonicaliseSqlOutput(BROWSER)).toBe(canonicaliseSqlOutput(SERVER));
  });

  it("produces the authored `cell|cell` form", () => {
    expect(canonicaliseSqlOutput(BROWSER)).toBe("Ada|91\nGrace|88");
  });

  it("drops the header only when a separator follows it", () => {
    // No separator: sqlite3's first data line must survive.
    expect(canonicaliseSqlOutput("Ada|91")).toBe("Ada|91");
  });

  it("drops the (N rows) footer, singular and plural", () => {
    expect(canonicaliseSqlOutput("Ada|91\n(1 row)")).toBe("Ada|91");
    expect(canonicaliseSqlOutput("Ada|91\nGrace|88\n(2 rows)")).toBe("Ada|91\nGrace|88");
  });

  it("still distinguishes different rows", () => {
    expect(canonicaliseSqlOutput("Ada|91")).not.toBe(canonicaliseSqlOutput("Ada|92"));
  });

  it("keeps NULL as a value rather than collapsing it to empty", () => {
    expect(canonicaliseSqlOutput("Ada | NULL")).toBe("Ada|NULL");
  });
});

describe("outputMatches", () => {
  it("accepts formatting differences in text mode", () => {
    expect(outputMatches("6\n", "6", "text")).toBe(true);
  });

  it("rejects a different answer", () => {
    expect(outputMatches("7", "6", "text")).toBe(false);
  });

  it("accepts the browser table against an authored sqlite row in sql mode", () => {
    const browser = ["total", "-----", "6", "(1 row)"].join("\n");
    expect(outputMatches(browser, "6", "sql")).toBe(true);
    // ...and the same strings must NOT match under the text comparator, which is
    // why the mode exists at all.
    expect(outputMatches(browser, "6", "text")).toBe(false);
  });

  it("canonicalise is the single entry point both modes go through", () => {
    expect(canonicalise("a \n", "text")).toBe("a");
    expect(canonicalise("a | b", "sql")).toBe("a|b");
  });
});

describe("gradeTest", () => {
  const test = { name: "example 1", input: "1 2", expectedOutput: "3", hidden: false };

  it("passes on matching output and a clean exit", () => {
    const graded = gradeTest(test, { ...OK, stdout: "3\n" }, "text");
    expect(graded.passed).toBe(true);
    expect(graded.expected).toBe("3");
    expect(graded.actual).toBe("3");
  });

  it("fails on the right output with a non-zero exit code", () => {
    // A program that printed the answer and then crashed has not passed. The
    // execution contract makes a non-zero exit a gradeable fact, not a failure of
    // the runner, so this is where it becomes a verdict.
    expect(gradeTest(test, { ...OK, stdout: "3\n", exitCode: 1 }, "text").passed).toBe(false);
  });

  it("fails when the run itself produced no trustworthy status", () => {
    expect(
      gradeTest(test, { ok: false, stdout: "3", stderr: "timeout", exitCode: null, runtimeMs: 5000 }, "text")
        .passed,
    ).toBe(false);
  });

  it("carries the hidden flag through so the payload can suppress the diff", () => {
    expect(gradeTest({ ...test, hidden: true }, { ...OK, stdout: "3" }, "text").hidden).toBe(true);
  });
});

describe("tallyTests", () => {
  const pass = (name: string): GradedTest => ({ name, hidden: false, passed: true, actual: "x", expected: "x" });
  const fail = (name: string): GradedTest => ({ name, hidden: true, passed: false, actual: "y", expected: "x" });

  it("counts passes and reports a full pass", () => {
    const tally = tallyTests([pass("a"), pass("b")]);
    expect(tally).toMatchObject({ passedCount: 2, totalCount: 2, passed: true });
  });

  it("reports a partial pass as not passed", () => {
    expect(tallyTests([pass("a"), fail("b")])).toMatchObject({
      passedCount: 1,
      totalCount: 2,
      passed: false,
    });
  });

  it("refuses to call an EMPTY test list a pass", () => {
    // 0 === 0 is arithmetically true and would mark a content bug as solved.
    expect(tallyTests([])).toMatchObject({ passedCount: 0, totalCount: 0, passed: false });
  });
});

describe("buildRunRequest", () => {
  it("passes a text problem's input as stdin, unchanged, on both targets", () => {
    for (const target of ["browser", "server"] as const) {
      expect(
        buildRunRequest({ language: "python", code: "print(1)", input: "1 2", mode: "text", target }),
      ).toEqual({ language: "python", source: "print(1)", stdin: "1 2" });
    }
  });

  it("treats a null input as empty stdin rather than the string 'null'", () => {
    expect(
      buildRunRequest({ language: "javascript", code: "x", input: null, mode: "text", target: "browser" }),
    ).toEqual({ language: "javascript", source: "x", stdin: "" });
  });

  it("gives the SQL setup to the browser as stdin, which is where sql.js reads it", () => {
    expect(
      buildRunRequest({
        language: "sql",
        code: "select 1;",
        input: "create table t(a int);",
        mode: "sql",
        target: "browser",
      }),
    ).toEqual({ language: "sql", source: "select 1;", stdin: "create table t(a int);" });
  });

  it("INLINES the SQL setup for the server, because sqlite3 runs one script", () => {
    // Getting this wrong is the failure that motivates the function: the query
    // would run against an empty database and every test would fail on Submit
    // while passing in the browser.
    expect(
      buildRunRequest({
        language: "sql",
        code: "select 1;",
        input: "create table t(a int);",
        mode: "sql",
        target: "server",
      }),
    ).toEqual({ language: "sql", source: "create table t(a int);\nselect 1;", stdin: "" });
  });

  it("does not prepend an empty setup", () => {
    expect(
      buildRunRequest({ language: "sql", code: "select 1;", input: "  ", mode: "sql", target: "server" })
        .source,
    ).toBe("select 1;");
  });
});

describe("isExecutable", () => {
  it("treats only `none` as reference-only", () => {
    expect(isExecutable("browser")).toBe(true);
    expect(isExecutable("piston")).toBe(true);
    expect(isExecutable("none")).toBe(false);
  });
});
