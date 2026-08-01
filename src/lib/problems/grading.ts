// =============================================================================
// OUTPUT COMPARISON — pure. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// A test passes when the program's stdout matches `expected_output`. "Matches"
// cannot be `===` on raw strings, for two measured reasons:
//
//   1. TRAILING WHITESPACE AND LINE ENDINGS. `print()` adds a newline, Piston
//      returns "\r\n" from some runtimes, and a student who pads a column has not
//      got the answer wrong. So both sides are normalised: CRLF -> LF, trailing
//      spaces per line stripped, trailing blank lines dropped.
//
//   2. SQL PRINTS THE SAME ROWS IN TWO SHAPES. The in-browser runner (sql.js,
//      src/lib/execution/browser/sqljs-worker.ts) renders a padded ASCII table
//      with a header, a dashed separator and a "(3 rows)" footer. Piston's
//      `sqlite3` prints bare `value|value` lines with none of that. Grading SQL
//      with the generic comparator would mean a query that is correct in the
//      browser fails on Submit — the worst possible failure mode, because the
//      student has no way to see why.
//
//      `canonicaliseSqlOutput` reduces BOTH shapes to one `cell|cell` form:
//        - a line of only dashes, spaces and plus signs is a separator and is
//          dropped;
//        - the line IMMEDIATELY BEFORE a separator is a column header and is
//          dropped (this is what makes header detection deterministic rather than
//          a guess — sqlite3 emits no separator, so it loses no data line);
//        - a "(N rows)" footer is dropped;
//        - every remaining line is split on `|` and rejoined with single pipes.
//      Seed `expected_output` for a SQL problem is therefore authored in that
//      canonical `cell|cell` form and matches whichever backend ran it.
//
// Nothing in this file touches a database, a runtime or the network, so every
// branch below is unit-testable without either.
// =============================================================================

import type { ExecutionMode } from "@/db/schema";
import { hasBrowserBackend } from "@/lib/execution/languages";

import {
  evaluateMarkupTest,
  isMarkupLanguage,
  parseMarkupAssertions,
  summariseExpectations,
  summariseResults,
} from "./markup";

/**
 * How a submission is compared.
 *
 * "markup" is NOT an output comparison at all, and naming it here anyway is
 * deliberate: this enum is the single question "how is this language judged?", and
 * a third answer that lived somewhere else would let a caller choose "text" for
 * HTML by omission. Every branch that consumes a ComparisonMode now has to say
 * what it does with "markup", and the compiler enforces that.
 */
export type ComparisonMode = "text" | "sql" | "markup";

/**
 * SQL needs the dialect-agnostic comparator; HTML and CSS are not run at all and
 * are judged by structural assertion (src/lib/problems/markup.ts); everything else
 * is plain text.
 */
export function comparisonModeFor(language: string): ComparisonMode {
  const key = language.trim().toLowerCase();
  if (isMarkupLanguage(key)) return "markup";
  return key.startsWith("sql") || key.startsWith("sqlite") ? "sql" : "text";
}

/**
 * Generic normalisation: line endings, trailing whitespace, trailing blank lines.
 * Leading blank lines are KEPT — a program that prints an unexpected empty first
 * line has produced different output and should be told so.
 */
export function normaliseOutput(raw: string | null | undefined): string {
  if (raw == null) return "";
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

const SQL_SEPARATOR = /^[-+\s]+$/;
const SQL_ROW_COUNT = /^\(\d+ rows?\)$/;

/**
 * Reduce either SQL runner's rendering to canonical `cell|cell` rows.
 * See the file header for the rule set and why the header rule is safe.
 */
export function canonicaliseSqlOutput(raw: string | null | undefined): string {
  const lines = normaliseOutput(raw).split("\n");

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (SQL_ROW_COUNT.test(line)) continue;
    if (SQL_SEPARATOR.test(line)) {
      // The separator itself goes, and so does the header line above it — which
      // is already in `kept`, because a separator can only follow one.
      kept.pop();
      continue;
    }
    kept.push(line);
  }

  return kept
    .map((line) =>
      line
        .split("|")
        .map((cell) => cell.trim())
        .join("|"),
    )
    .join("\n");
}

/** Normalise per mode. The one function both Run and Submit call. */
export function canonicalise(raw: string | null | undefined, mode: ComparisonMode): string {
  return mode === "sql" ? canonicaliseSqlOutput(raw) : normaliseOutput(raw);
}

/** Does this stdout satisfy this expectation? */
export function outputMatches(
  actual: string | null | undefined,
  expected: string | null | undefined,
  mode: ComparisonMode,
): boolean {
  return canonicalise(actual, mode) === canonicalise(expected, mode);
}

// ---------------------------------------------------------------------------
// Per-test grading
// ---------------------------------------------------------------------------

/** A test as the grader needs it. Deliberately structural, not a Drizzle row. */
export interface GradableTest {
  name: string;
  input: string | null;
  expectedOutput: string | null;
  hidden: boolean;
}

/** What one run produced, reduced to the two facts grading needs. */
export interface RunOutcomeLike {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  runtimeMs: number;
}

export interface GradedTest {
  name: string;
  hidden: boolean;
  passed: boolean;
  actual: string;
  expected: string;
}

/**
 * Grade one test against one run.
 *
 * A NON-ZERO EXIT CODE FAILS THE TEST. The execution contract is explicit that
 * `ok: true` with a non-zero exit is a legitimate result to grade (a program that
 * threw), so this is where that becomes a verdict rather than being ignored. A
 * program that crashes but happens to have printed the right prefix has not
 * passed.
 */
export function gradeTest(
  test: GradableTest,
  run: RunOutcomeLike,
  mode: ComparisonMode,
): GradedTest {
  const expected = canonicalise(test.expectedOutput, mode);
  const actual = canonicalise(run.stdout, mode);
  const passed = run.ok && run.exitCode === 0 && actual === expected;
  return { name: test.name, hidden: test.hidden, passed, actual, expected };
}

/**
 * Grade one MARKUP test — no runtime, no network, no exit code.
 *
 * Produces the same `GradedTest` the executed path produces, deliberately: the
 * attempt row, the submit panel and the hidden-test redaction in service.ts are
 * then one code path rather than two, and a markup attempt is indistinguishable
 * from any other in `coding_attempts` except for the `execution` column it records.
 *
 * `expected` is the requirement list and `actual` is the same list with each item
 * ticked or crossed. That is what the existing side-by-side diff pane renders, and
 * for a checklist it reads better than a diff of two documents would.
 */
export function gradeMarkupTest(test: GradableTest, files: Record<string, string>): GradedTest {
  const assertions = parseMarkupAssertions(test.expectedOutput);
  const outcome = evaluateMarkupTest(files, assertions);
  return {
    name: test.name,
    hidden: test.hidden,
    passed: outcome.passed,
    actual: summariseResults(outcome.results),
    expected: summariseExpectations(assertions),
  };
}

export interface GradedRun {
  passedCount: number;
  totalCount: number;
  passed: boolean;
  tests: GradedTest[];
}

/** Fold graded tests into the counts `coding_attempts` stores. */
export function tallyTests(tests: readonly GradedTest[]): GradedRun {
  const passedCount = tests.reduce((n, t) => n + (t.passed ? 1 : 0), 0);
  return {
    passedCount,
    totalCount: tests.length,
    // An empty test list is NOT a pass. `totalCount === 0` would satisfy
    // "passedCount === totalCount" and mark a content bug as solved.
    passed: tests.length > 0 && passedCount === tests.length,
    tests: [...tests],
  };
}

// ---------------------------------------------------------------------------
// Executability
// ---------------------------------------------------------------------------

/**
 * How a test's input reaches the program.
 *
 * For every language except SQL it is stdin, which is what the problems were
 * authored against. SQL has no stdin: the in-browser runner treats
 * `RunRequest.stdin` as a SETUP SCRIPT it executes before the student's query (see
 * src/lib/execution/browser/sqljs-worker.ts), but Piston's `sqlite3` runner has no
 * such convention — it executes one script. So on the server the setup is PREPENDED
 * to the query.
 *
 * Both branches live here, in a pure function, because BOTH callers need them: the
 * browser workbench building a Run and the server building a graded Submit. A copy
 * in each would be two chances for Run and Submit to disagree about what the
 * program was even given.
 */
export function buildRunRequest(params: {
  language: string;
  code: string;
  input: string | null;
  mode: ComparisonMode;
  /** Browser runs pass the setup as stdin; server runs must inline it. */
  target: "browser" | "server";
}): { language: string; source: string; stdin: string } {
  const { language, code, input, mode, target } = params;
  // "markup" never reaches here: an HTML/CSS submission is graded by
  // `gradeMarkupSubmission` without a runtime, and the workbench for those problems
  // renders a live preview instead of a Run button. It is not rejected either —
  // this module does not throw at callers — so a future caller that does reach
  // here gets the harmless plain-stdin shape rather than an exception mid-submit.
  if (mode === "sql") {
    const setup = (input ?? "").trim();
    if (target === "server") {
      return { language, source: setup === "" ? code : `${setup}\n${code}`, stdin: "" };
    }
    return { language, source: code, stdin: setup };
  }
  return { language, source: code, stdin: input ?? "" };
}

/**
 * Can this problem be run and graded at all?
 *
 * `none` means "reference solution only" — still the honest state for the HTML and
 * CSS problems whose requirement is a judgement rather than a checkable structure,
 * and the documented fallback for C and C++ when Piston is unreachable
 * (docs/ADDON_STREAMS.md). A reference-only problem shows no Run button rather than
 * one that always fails.
 *
 * NOTE since the markup work: `execution: "none"` no longer implies "HTML or CSS".
 * A markup problem carrying assertions is `execution: "browser"` — it is edited and
 * previewed in the student's browser and graded on the server by
 * `gradeMarkupSubmission`, with no runtime involved on either side.
 */
export function isExecutable(execution: ExecutionMode): boolean {
  return execution !== "none";
}

/**
 * Does grading this problem depend on Piston being reachable?
 *
 * THIS IS THE PREDICATE THE RUN/SUBMIT GATE MUST USE, and getting it wrong was a
 * latent bug worth spelling out, because the symptom only appears during an outage
 * and only for one family of problems.
 *
 * The gate used to read `execution === "piston"`. That is the SEEDED INTENT, not
 * the runtime fact. `execution` says where the PRACTICE LOOP runs (src/db/schema.ts
 * on the `execution_mode` enum), and a problem may declare `browser` while its
 * language has no in-browser backend at all — src/lib/execution/languages.ts gives
 * C, C++, Java and TypeScript `browserBackend: null`. For such a problem:
 *
 *   - `loadProblem` skipped the availability probe entirely (it only probed for
 *     `piston`), so `serverGradingAvailable` defaulted to true;
 *   - the workbench therefore rendered Run and Submit;
 *   - `runCode(..., { backend: "auto" })` resolves to Piston for a language with no
 *     browser backend (src/lib/execution/index.ts:110), so Run went server-side
 *     anyway and returned `backend_unavailable` for every visible test;
 *   - the workbench label said "runs in your browser", which was simply false.
 *
 * i.e. exactly the "Run button that always fails" the HTML/CSS gate exists to
 * prevent, reachable through a one-word content mistake. The seed catalogue happens
 * not to contain one today — scripts/content/problems/cpp.ts declares `piston` — so
 * this is latent rather than live, and validate.ts now refuses to seed one. Both
 * defences are kept: the validator stops the content mistake, and this predicate
 * makes the UI correct even if a row reaches the database by another route (the
 * admin console, a hand-written INSERT).
 *
 * Markup is false: `gradeMarkupSubmission` runs in the server process and needs no
 * network, so a Piston outage must not hide the editor for an HTML problem.
 *
 * Only C++ and (since this change) C are actually reachable through this branch
 * today. Java and TypeScript have specs in the execution allow-list but are NOT in
 * PROBLEM_TRACKS (src/lib/problems/types.ts), so no problem can declare them; the
 * predicate covers them because it asks the allow-list rather than enumerating
 * tracks, not because the tracks exist.
 */
export function requiresServerRuntime(language: string, execution: ExecutionMode): boolean {
  if (!isExecutable(execution)) return false;
  if (isMarkupLanguage(language)) return false;
  if (execution === "piston") return true;
  return !hasBrowserBackend(language);
}
