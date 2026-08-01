// =============================================================================
// STUDENT-FACING PROBLEM PAYLOAD — the hidden-test barrier.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// `GET /api/problems/:slug` and the problem page must not tell the client what
// the hidden tests are. Passing the Drizzle rows straight through would do
// exactly that: `coding_problem_tests` carries `input` and `expected_output` for
// hidden rows too, and `coding_problems.reference_solution` is a complete answer.
// Either one turns the browser network tab into a grader bypass.
//
// The defence is STRUCTURAL, not a reminder in a comment. It is the same shape
// the quizzes stream uses for its answer key (src/lib/quizzes/payload.ts), and it
// is copied deliberately rather than reinvented:
//
//   1. `VisibleTest` has NO `hidden` field and `StudentProblem` has no hidden-test
//      collection at all, so there is no property a hidden row could be assigned
//      to. Objects are built by EXPLICIT FIELD COPY — never by spreading a row —
//      because `...row` would silently carry every future column, including the
//      next answer-key-shaped one somebody adds.
//   2. `toStudentProblem` is the only way the route and the page build a body, and
//      payload.test.ts asserts the hidden rows' KEYS AND TEXT ARE ABSENT AFTER A
//      JSON ROUND-TRIP — which is what the browser actually receives. A comment is
//      not a barrier; an assertion on the serialised string is.
//
// `referenceSolution` is admitted in exactly two cases, and both are checked here
// rather than by the caller: a reference-only problem (`execution: "none"`, where
// the solution IS the deliverable — HTML/CSS have no runtime, see grading.ts), and
// a problem this student has already solved, where it is a worked answer rather
// than a spoiler.
// =============================================================================

import type { ExecutionMode, ProficiencyLevel } from "@/db/schema";

import { attemptPassed } from "./completion";
import { requiresServerRuntime } from "./grading";
import {
  bankOf,
  isProblemTrack,
  type AttemptSummary,
  type ProblemBank,
  type ProblemSummary,
  type ProblemTrack,
  type StudentProblem,
  type VisibleTest,
} from "./types";

// ---------------------------------------------------------------------------
// Row shapes accepted as input. Structurally compatible with the Drizzle rows
// INCLUDING their answer-key fields — which is the point: they go in, they do
// not come out.
// ---------------------------------------------------------------------------

export interface ProblemRowLike {
  id: number;
  slug: string;
  title: string;
  statement: string;
  track: string;
  level: ProficiencyLevel;
  isInterview: boolean;
  language: string;
  starterCode: string | null;
  referenceSolution: string | null;
  hints: unknown;
  tags: unknown;
  execution: ExecutionMode;
  timeLimitMs: number;
  orderIndex: number;
}

export interface TestRowLike {
  id: number;
  name: string;
  input: string | null;
  expectedOutput: string | null;
  hidden: boolean;
  orderIndex: number;
}

export interface AttemptRowLike {
  id: number;
  passedCount: number;
  totalCount: number;
  execution: ExecutionMode;
  runtimeMs: number | null;
  createdAt: Date | string;
}

// ---------------------------------------------------------------------------
// jsonb coercion
// ---------------------------------------------------------------------------

/**
 * `hints` and `tags` are `jsonb`, so their runtime type is whatever was written.
 * Coerce defensively and drop anything that is not a non-empty string: a null or
 * a number rendered into a hint list is a crash in a client component, and the
 * seed validator already refuses to write one.
 */
export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/** A row's track, or null when the stored string is not an allow-listed track. */
export function trackOf(row: { track: string }): ProblemTrack | null {
  return isProblemTrack(row.track) ? row.track : null;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toAttemptSummary(row: AttemptRowLike): AttemptSummary {
  return {
    id: row.id,
    passedCount: row.passedCount,
    totalCount: row.totalCount,
    execution: row.execution,
    runtimeMs: row.runtimeMs,
    passed: attemptPassed(row),
    createdAt: isoOf(row.createdAt),
  };
}

/**
 * A list row. Carries no statement, no tests and no solution — the list is a
 * browse surface, and shipping 100 statements to render 100 titles is both a leak
 * risk and a payload nobody reads.
 */
export function toProblemSummary(params: {
  problem: ProblemRowLike;
  solved: boolean;
  attemptCount: number;
  locked: boolean;
}): ProblemSummary | null {
  const { problem, solved, attemptCount, locked } = params;
  const track = trackOf(problem);
  // An unknown track is a content bug. Dropping the row keeps the list rendering
  // instead of throwing inside a server component, and the seed validator refuses
  // to create one in the first place.
  if (!track) return null;

  return {
    slug: problem.slug,
    title: problem.title,
    track,
    level: problem.level,
    bank: bankOf(problem.isInterview),
    language: problem.language,
    execution: problem.execution,
    tags: stringArray(problem.tags),
    solved,
    attemptCount,
    locked,
  };
}

/**
 * The problem view.
 *
 * `tests` may contain hidden rows — pass them all in. The filter happens HERE, in
 * the one place that is tested, rather than at each of the several call sites that
 * would otherwise each have to remember it.
 */
export function toStudentProblem(params: {
  problem: ProblemRowLike;
  tests: readonly TestRowLike[];
  attempts: readonly AttemptRowLike[];
  /**
   * Whether the server-side runner is reachable. Defaults to true, so a caller
   * that does not care (every browser-backed problem) need not pass it. When it is
   * false AND the problem needs the server, the reference solution IS admitted —
   * that is the documented C++ degradation, and it is decided here rather than by
   * the caller so it cannot be granted on a client's word.
   */
  serverGradingAvailable?: boolean;
}): StudentProblem | null {
  const { problem, tests, attempts } = params;
  const serverGradingAvailable = params.serverGradingAvailable ?? true;
  const track = trackOf(problem);
  if (!track) return null;

  const visible: VisibleTest[] = tests
    .filter((test) => !test.hidden)
    .map((test) => ({
      // Explicit field copy. `hidden` is read nowhere below and therefore cannot
      // be serialised, and no hidden row reaches this map at all.
      id: test.id,
      name: test.name,
      input: test.input,
      expectedOutput: test.expectedOutput,
      orderIndex: test.orderIndex,
    }))
    .sort(compareOrder);

  const hiddenTestCount = tests.reduce((n, test) => n + (test.hidden ? 1 : 0), 0);

  const attemptSummaries = attempts
    .map(toAttemptSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const solved = attemptSummaries.some((a) => a.passed);

  const bank: ProblemBank = bankOf(problem.isInterview);

  const payload: StudentProblem = {
    slug: problem.slug,
    title: problem.title,
    statement: problem.statement,
    track,
    level: problem.level,
    bank,
    language: problem.language,
    execution: problem.execution,
    timeLimitMs: problem.timeLimitMs,
    starterCode: problem.starterCode ?? "",
    hints: stringArray(problem.hints),
    tags: stringArray(problem.tags),
    visibleTests: visible,
    hiddenTestCount,
    solved,
    attempts: attemptSummaries,
    serverGradingAvailable,
  };

  // The only admissions. Assigned conditionally so the KEY is absent otherwise —
  // `referenceSolution: undefined` would still be a key in the object, and
  // `JSON.stringify` dropping it is an implementation detail to lean on, not a
  // barrier.
  if (
    mayRevealSolution(
      problem.execution,
      solved,
      serverGradingAvailable,
      // Computed rather than inferred from `execution` — see the note on the
      // `needsServer` parameter, and grading.ts `requiresServerRuntime` for the
      // latent gating bug that made the inference wrong.
      requiresServerRuntime(problem.language, problem.execution),
    ) &&
    problem.referenceSolution
  ) {
    payload.referenceSolution = problem.referenceSolution;
  }

  return payload;
}

/**
 * May this student see the reference solution? Three cases, and only three:
 *
 *   1. `execution === "none"` — there is nothing else to show. HTML and CSS have no
 *      runtime on the execution allow-list, so the worked answer IS the content.
 *   2. the student has already solved it — then it is a worked answer, not a spoiler.
 *   3. the problem needs the SERVER and the server is unreachable — the documented
 *      C++ degradation. Without this, a C++ problem during a Piston outage is a
 *      statement with no way to attempt it and no answer to learn from.
 *
 * Case 3 is scoped to problems that GENUINELY need the server: a browser-backed
 * problem is unaffected by a server outage for Run, and its Submit will work again
 * shortly, so revealing its answer would be a leak dressed up as a degradation.
 *
 * `needsServer` is a PARAMETER rather than being re-derived from `execution` here,
 * and it defaults to the old `execution === "piston"` test so that every existing
 * caller keeps its exact previous behaviour. The default is not the right answer —
 * see `requiresServerRuntime` in grading.ts, which is what `toStudentProblem`
 * passes — but a default that silently CHANGED an existing caller's answer would be
 * a way to widen an answer-key disclosure by accident, and this function is the
 * last gate in front of one. Callers opt in.
 */
export function mayRevealSolution(
  execution: ExecutionMode,
  solved: boolean,
  serverGradingAvailable = true,
  needsServer: boolean = execution === "piston",
): boolean {
  if (execution === "none" || solved) return true;
  return needsServer && !serverGradingAvailable;
}

function compareOrder(
  a: { orderIndex: number; id: number },
  b: { orderIndex: number; id: number },
): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}
