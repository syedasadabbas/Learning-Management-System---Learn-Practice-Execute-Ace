// =============================================================================
// CODING PROBLEMS — tracks, banks and the client-facing payload shapes.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// Two things are declared here and nowhere else, so nothing downstream can
// re-derive them differently:
//
//   1. THE TRACK LIST. `coding_problems.track` is a varchar in the frozen schema
//      (src/db/schema.ts), not an enum, so the database will happily accept
//      "Javascript" or "c++". The allow-list below is the only place a track
//      string becomes a known track; `isProblemTrack` is the gate every filter
//      and every seed row passes through.
//
//   2. THE PAYLOAD TYPES. `StudentProblem` HAS NO FIELD for hidden tests. That
//      absence is the barrier — see payload.ts for why it is structural rather
//      than a rule someone has to remember, and payload.test.ts for the
//      JSON-round-trip assertion that keeps it true.
//
// `referenceSolution` is an answer key for an executable problem, so it is
// OPTIONAL here and populated only in the two cases where it is not a spoiler:
// a reference-only problem (there is nothing else to show) and a problem this
// student has already solved.
// =============================================================================

import type { ExecutionMode, ProficiencyLevel } from "@/db/schema";

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/**
 * The eight tracks. Order is the UI's filter order.
 *
 * "agentic-ai" is one track id with a hyphen deliberately: it is the slug that
 * appears in a query string, and a space or a slash there would need escaping in
 * every link.
 *
 * "c" was added 2026-07-31: the product owner noticed it was absent from the
 * language list, and the platform can in fact run it — Piston's public instance
 * ships { language: "c", version: "10.2.0", runtime: "gcc" }, checked against
 * /runtimes on that date and wired up in src/lib/execution/languages.ts. It sits
 * immediately before "cpp" so the two C-family tracks read as a pair in the filter
 * bar; a student browsing "C++" should see "C" next to it, not four tracks away.
 *
 * NOTE ON WHAT IS STILL ABSENT. Java and TypeScript have entries in the EXECUTION
 * allow-list but no track here, so no problem can be authored in them. That is a
 * deliberate gap, not an oversight: the allow-list is what Piston may be asked for,
 * and this list is what the curriculum teaches. Adding a track means authoring a
 * catalogue for it (scripts/content/problems/), not adding a string.
 */
export const PROBLEM_TRACKS = [
  "javascript",
  "python",
  "html",
  "css",
  "c",
  "cpp",
  "sql",
  "agentic-ai",
] as const;

export type ProblemTrack = (typeof PROBLEM_TRACKS)[number];

export const TRACK_LABELS: Record<ProblemTrack, string> = {
  javascript: "JavaScript",
  python: "Python",
  html: "HTML",
  css: "CSS",
  c: "C",
  cpp: "C++",
  sql: "SQL",
  "agentic-ai": "Agentic AI",
};

/** Narrow an untrusted string (query param, seed row) to a known track. */
export function isProblemTrack(value: unknown): value is ProblemTrack {
  return typeof value === "string" && (PROBLEM_TRACKS as readonly string[]).includes(value);
}

/**
 * Which bank a problem belongs to. Maps 1:1 onto `coding_problems.is_interview`
 * — the schema comment is explicit that one table serves both surfaces, so this
 * is a view over a boolean, not a second dimension.
 */
export const PROBLEM_BANKS = ["practice", "interview"] as const;
export type ProblemBank = (typeof PROBLEM_BANKS)[number];

export function isProblemBank(value: unknown): value is ProblemBank {
  return value === "practice" || value === "interview";
}

/** The bank a row belongs to, from the column that decides it. */
export function bankOf(isInterview: boolean): ProblemBank {
  return isInterview ? "interview" : "practice";
}

/** The URL prefix each bank is served under. Used by links and by the specs. */
export const BANK_BASE_PATH: Record<ProblemBank, string> = {
  practice: "/problems",
  interview: "/interview",
};

export const LEVELS: readonly ProficiencyLevel[] = ["beginner", "intermediate", "advanced"];

export function isLevel(value: unknown): value is ProficiencyLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Client-facing payloads
// ---------------------------------------------------------------------------

/**
 * An EXAMPLE test. Only rows with `hidden = false` ever become one of these.
 * There is no `hidden` field: a test that reached the client is visible by
 * construction, so carrying the flag would only invite a `hidden: true` row to
 * be serialised "but filtered in the UI".
 */
export interface VisibleTest {
  id: number;
  name: string;
  input: string | null;
  expectedOutput: string | null;
  orderIndex: number;
}

/** One recorded run, as the student's own history. */
export interface AttemptSummary {
  id: number;
  passedCount: number;
  totalCount: number;
  execution: ExecutionMode;
  runtimeMs: number | null;
  passed: boolean;
  createdAt: string;
}

/** A row in the problem list. Carries no statement, no tests and no solution. */
export interface ProblemSummary {
  slug: string;
  title: string;
  track: ProblemTrack;
  level: ProficiencyLevel;
  bank: ProblemBank;
  language: string;
  execution: ExecutionMode;
  tags: string[];
  /**
   * DERIVED from coding_attempts — a run exists whose passedCount equals its
   * totalCount and totalCount > 0. There is no stored `solved` column and there
   * must never be one; see the schema comment on `codingAttempts`.
   */
  solved: boolean;
  attemptCount: number;
  /** True when this problem's level is not yet unlocked for this student. */
  locked: boolean;
}

/** The problem view. Note what is NOT here: hidden tests. */
export interface StudentProblem {
  slug: string;
  title: string;
  statement: string;
  track: ProblemTrack;
  level: ProficiencyLevel;
  bank: ProblemBank;
  language: string;
  execution: ExecutionMode;
  timeLimitMs: number;
  starterCode: string;
  hints: string[];
  tags: string[];
  visibleTests: VisibleTest[];
  /**
   * How many hidden tests Submit will run. A COUNT is not a leak — it tells a
   * student that passing the examples is not the whole job, which is the
   * information they actually need — and it is what the UI labels Submit with.
   */
  hiddenTestCount: number;
  solved: boolean;
  attempts: AttemptSummary[];
  /**
   * False when the server-side runner is unreachable. Only ever false for a
   * `piston` problem — the browser-backed ones do not need it.
   *
   * This is the C++ degradation signal docs/ADDON_STREAMS.md asks for: C++ has no
   * in-browser toolchain, so when Piston is down the honest presentation is the
   * statement plus the reference solution and NO Run button, rather than a button
   * that can only ever report a backend failure.
   */
  serverGradingAvailable: boolean;
  /**
   * Present only when `execution === "none"` (there is nothing else to show) or
   * when this student has already solved the problem. Absent otherwise, so a
   * network tab is not an answer key.
   */
  referenceSolution?: string;
}

// ---------------------------------------------------------------------------
// Submit outcome
// ---------------------------------------------------------------------------

/** Per-test outcome as the client may see it after Submit. */
export interface TestOutcome {
  name: string;
  /** False for a hidden test: its input and expected output stay on the server. */
  visible: boolean;
  passed: boolean;
  /** Only ever populated for a VISIBLE test. Hidden diffs would leak the test. */
  detail?: { input: string | null; expected: string; actual: string };
}

export type SubmitOutcome =
  | {
      graded: true;
      attemptId: number;
      passedCount: number;
      totalCount: number;
      passed: boolean;
      /** True when this submission is the first passing run for this student. */
      newlySolved: boolean;
      runtimeMs: number;
      stderr: string | null;
      tests: TestOutcome[];
    }
  | {
      /**
       * The infrastructure, not the code, is why there is no verdict. NOTHING is
       * recorded in this branch: a `passedCount = 0` row would read as a failed
       * attempt forever, and `shouldDeferToInstructor` in the execution contract
       * exists precisely to stop that conflation.
       */
      graded: false;
      reason: "rate_limited" | "backend_unavailable" | "not_executable" | "unsupported_language";
      message: string;
    };
