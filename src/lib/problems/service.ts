// =============================================================================
// PROBLEM SERVICE — the only place this stream touches the database.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// The three route handlers and the four pages all call these functions, so the
// server components and the API cannot drift into two definitions of "solved" or
// two ideas of which levels are open.
//
// WHERE SUBMIT RUNS, AND WHY IT IS ALWAYS THE SERVER.
// `coding_problems.execution` says where the PRACTICE LOOP runs: `browser` keeps
// Run free and unlimited on the student's own machine, which is what makes 50-80
// concurrent students cost nothing. It does NOT decide where Submit runs. Submit
// grades against the HIDDEN tests, and hidden tests never leave the server
// (payload.ts), so there is exactly one place they can be executed: here, through
// `runOnPiston`. A browser result is advisory by the execution stream's own
// contract — "produced on the student's machine and can be forged" — so accepting
// a client-reported pass count would make `coding_attempts` a table of claims.
//
// WHY A FAILED PISTON CALL RECORDS NOTHING.
// `rate_limited` and `backend_unavailable` say nothing about the submitted code.
// Writing a `passed_count = 0` row for them would leave a permanent failed attempt
// caused by our infrastructure, and — because completion is derived from these
// rows — would be indistinguishable from a wrong answer forever. The execution
// contract separates those reasons from a wrong answer precisely so consumers can
// refuse to score them; `shouldDeferToInstructor` is the shared encoding of that
// distinction and this file honours it by returning `graded: false` and writing
// nothing at all.
//
// Units: every duration is milliseconds (house rule 5).
// =============================================================================

import { cache } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  codingAttempts,
  codingProblems,
  codingProblemTests,
  type ExecutionMode,
  type ProficiencyLevel,
} from "@/db/schema";
import { resolveLanguage } from "@/lib/execution/languages";
import { clampTimeoutMs } from "@/lib/execution/timeouts";
import { MAX_STREAM_CHARS } from "@/lib/execution/truncate";

import { isServerGradingAvailable } from "./availability";
import { attemptCountsByProblem, attemptPassed, solvedProblemIds } from "./completion";
import {
  buildRunRequest,
  comparisonModeFor,
  gradeMarkupTest,
  gradeTest,
  isExecutable,
  requiresServerRuntime,
  tallyTests,
  type GradableTest,
  type GradedTest,
} from "./grading";
import { isMarkupLanguage, splitMarkupBundle, type MarkupLanguage } from "./markup";
import {
  toProblemSummary,
  toStudentProblem,
  type ProblemRowLike,
} from "./payload";
import {
  emptyTallies,
  levelProgression,
  talliesFor,
  type LevelState,
} from "./progression";
import {
  bankOf,
  isProblemTrack,
  PROBLEM_TRACKS,
  TRACK_LABELS,
  type ProblemBank,
  type ProblemSummary,
  type ProblemTrack,
  type StudentProblem,
  type SubmitOutcome,
} from "./types";

/**
 * Ceiling on tests graded in one submit. Each one is a separate Piston call, and
 * the per-user burst window is 6 runs / 10 s (src/lib/execution/rate-limit.ts).
 * Six keeps a single submit inside that window; a seventh test would guarantee
 * every submit ended in `rate_limited`.
 */
export const MAX_GRADED_TESTS = 6;

// ---------------------------------------------------------------------------
// Shared row projection
// ---------------------------------------------------------------------------

/**
 * Columns the list and the detail view both need.
 *
 * `referenceSolution` IS selected: `toStudentProblem` decides whether the student
 * may see it (payload.ts), and the list builder never reads it. Selecting it here
 * rather than in a second query keeps that decision in the one tested place.
 */
const PROBLEM_COLUMNS = {
  id: codingProblems.id,
  slug: codingProblems.slug,
  title: codingProblems.title,
  statement: codingProblems.statement,
  track: codingProblems.track,
  level: codingProblems.level,
  isInterview: codingProblems.isInterview,
  language: codingProblems.language,
  starterCode: codingProblems.starterCode,
  referenceSolution: codingProblems.referenceSolution,
  hints: codingProblems.hints,
  tags: codingProblems.tags,
  execution: codingProblems.execution,
  timeLimitMs: codingProblems.timeLimitMs,
  orderIndex: codingProblems.orderIndex,
} as const;

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface TrackProgress {
  track: ProblemTrack;
  label: string;
  levels: LevelState[];
  total: number;
  solved: number;
}

export interface ProblemListResult {
  bank: ProblemBank;
  /** Rows after the track/level filter, in browse order. */
  problems: ProblemSummary[];
  /** Progress for EVERY track in this bank, so the filter bar can show it. */
  tracks: TrackProgress[];
  /** Tracks that actually have published problems in this bank. */
  availableTracks: ProblemTrack[];
}

/**
 * The browse surface for one bank.
 *
 * Loads the whole bank, not just the filtered slice: the level ladder is derived
 * from completion counts across a track, so a query narrowed to
 * `level = 'advanced'` cannot compute whether advanced is unlocked. The bank is a
 * few hundred rows of metadata, so one unfiltered read is cheaper than the two
 * round trips the alternative needs.
 */
export async function listProblems(params: {
  bank: ProblemBank;
  studentId: number;
  track?: ProblemTrack | null;
  level?: ProficiencyLevel | null;
}): Promise<ProblemListResult> {
  const { bank, studentId } = params;

  const rows = await db
    .select(PROBLEM_COLUMNS)
    .from(codingProblems)
    .where(
      and(
        eq(codingProblems.isInterview, bank === "interview"),
        eq(codingProblems.published, true),
      ),
    )
    .orderBy(asc(codingProblems.track), asc(codingProblems.level), asc(codingProblems.orderIndex), asc(codingProblems.id));

  const known = rows.filter((row) => isProblemTrack(row.track));
  const attempts = await attemptsFor(studentId, known.map((r) => r.id));
  const solved = solvedProblemIds(attempts);
  const attemptCounts = attemptCountsByProblem(attempts);

  // --- ladder per track -------------------------------------------------
  const tracks: TrackProgress[] = [];
  const unlockedByTrack = new Map<ProblemTrack, Set<ProficiencyLevel>>();

  for (const track of PROBLEM_TRACKS) {
    const inTrack = known.filter((row) => row.track === track);
    const tallies = inTrack.length
      ? talliesFor(
          inTrack.map((row) => ({
            id: row.id,
            level: row.level,
            gradeable: isExecutable(row.execution),
          })),
          solved,
        )
      : emptyTallies();

    const levels = levelProgression(tallies);
    unlockedByTrack.set(
      track,
      new Set(levels.filter((l) => l.unlocked).map((l) => l.level)),
    );

    tracks.push({
      track,
      label: TRACK_LABELS[track],
      levels,
      total: inTrack.length,
      solved: inTrack.reduce((n, row) => n + (solved.has(row.id) ? 1 : 0), 0),
    });
  }

  // --- filtered rows ----------------------------------------------------
  const filtered = known.filter((row) => {
    if (params.track && row.track !== params.track) return false;
    if (params.level && row.level !== params.level) return false;
    return true;
  });

  const problems = filtered
    .map((row) =>
      toProblemSummary({
        problem: asProblemRow(row),
        solved: solved.has(row.id),
        attemptCount: attemptCounts.get(row.id) ?? 0,
        locked: !(unlockedByTrack.get(row.track as ProblemTrack)?.has(row.level) ?? true),
      }),
    )
    .filter((row): row is ProblemSummary => row !== null);

  return {
    bank,
    problems,
    tracks,
    availableTracks: PROBLEM_TRACKS.filter((t) => known.some((row) => row.track === t)),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface ProblemDetailResult {
  problem: StudentProblem;
  /** True when this problem's level is not yet open for this student. */
  locked: boolean;
  /** The ladder for this problem's track, so the page can explain the lock. */
  levels: LevelState[];
}

/**
 * One problem for one student, or null when there is no published problem with
 * that slug.
 *
 * A locked problem is still RETURNED, with `locked: true` and the ladder that
 * explains why. The callers decide what to do: the page renders the lock reason
 * (a bare 404 for a locked problem is indistinguishable from a typo), while the
 * API route refuses with 403, following the same shape as the week-lock gate on
 * `GET /api/weeks/:weekId/quiz`.
 *
 * WRAPPED IN React `cache()` (see the export below this function). Nothing about
 * the query changed; what changed is that /problems/[slug] and /interview/[slug]
 * now each carry a `layout.tsx` existence guard, because those routes gained a
 * `loading.tsx` and a `notFound()` under a Suspense boundary can no longer set
 * the status code (full account in src/components/nav/PageSkeleton.tsx). The
 * guard resolves the same problem the page then renders, and this function is
 * FOUR sequential round trips — the problem row, its tests, its whole track, and
 * the student's attempts. At ~245 ms per round trip (scripts/perf-roundtrips.ts)
 * an unmemoised guard would have added roughly a second to every problem page.
 * `cache()` is request-scoped, so no student can observe another's attempts
 * through it, and a submission made in one request is visible in the next.
 */
async function loadProblemUncached(
  slug: string,
  studentId: number,
): Promise<ProblemDetailResult | null> {
  const [row] = await db
    .select(PROBLEM_COLUMNS)
    .from(codingProblems)
    .where(and(eq(codingProblems.slug, slug), eq(codingProblems.published, true)))
    .limit(1);
  if (!row || !isProblemTrack(row.track)) return null;

  const track = row.track;
  const bank = bankOf(row.isInterview);

  const testRows = await db
    .select()
    .from(codingProblemTests)
    .where(eq(codingProblemTests.problemId, row.id))
    .orderBy(asc(codingProblemTests.orderIndex), asc(codingProblemTests.id));

  // Every problem in this (bank, track), because the ladder needs the whole track.
  const trackRows = await db
    .select({
      id: codingProblems.id,
      level: codingProblems.level,
      execution: codingProblems.execution,
    })
    .from(codingProblems)
    .where(
      and(
        eq(codingProblems.track, track),
        eq(codingProblems.isInterview, row.isInterview),
        eq(codingProblems.published, true),
      ),
    );

  const trackAttempts = await attemptsFor(studentId, trackRows.map((r) => r.id));
  const solved = solvedProblemIds(trackAttempts);

  const tallies = talliesFor(
    trackRows.map((r) => ({ id: r.id, level: r.level, gradeable: isExecutable(r.execution) })),
    solved,
  );
  const levels = levelProgression(tallies);
  const locked = !levels.some((l) => l.level === row.level && l.unlocked);

  const attemptRows = await db
    .select()
    .from(codingAttempts)
    .where(and(eq(codingAttempts.problemId, row.id), eq(codingAttempts.studentId, studentId)));

  // Probe ONLY when the answer can change what is rendered: a problem that needs
  // the server runner and has not been solved. Every browser-backed problem — the
  // large majority — costs no probe at all, and the result is cached for ten
  // minutes per process anyway (availability.ts).
  const alreadySolved = attemptRows.some(attemptPassed);
  // `requiresServerRuntime`, NOT `execution === "piston"`. A problem declaring
  // `browser` in a language with no in-browser backend (C, C++) also depends on
  // Piston, and skipping the probe for it is what let the workbench render a Run
  // button that could only ever report `backend_unavailable`. See the long note on
  // that function in grading.ts.
  const needsProbe = requiresServerRuntime(row.language, row.execution) && !alreadySolved;
  const serverGradingAvailable = needsProbe ? await isServerGradingAvailable() : true;

  const problem = toStudentProblem({
    problem: asProblemRow(row),
    tests: testRows,
    attempts: attemptRows,
    serverGradingAvailable,
  });
  if (!problem) return null;

  // `bank` is already on the payload; asserting it here keeps the compiler honest
  // if `bankOf` and the payload ever disagree.
  if (problem.bank !== bank) {
    throw new Error(`Bank mismatch for ${slug}: payload says ${problem.bank}, row says ${bank}.`);
  }

  return { problem, locked, levels };
}

/**
 * Request-scoped memo of the above. THE name every caller imports; the unwrapped
 * function is intentionally not exported, so a new call site cannot opt out of
 * the memo by accident.
 *
 * It has to be wrapped HERE rather than in the navigation stream's own
 * src/lib/navigation/guards.ts, where the other guard memos live, because
 * `cache()` keys on function identity: one of the two callers that must share the
 * memo is src/components/problems/BankPages.tsx, which belongs to the
 * coding-problems stream, so a wrapper declared elsewhere could never have been
 * put in front of it.
 */
export const loadProblem = cache(loadProblemUncached);

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/**
 * Grade one submission against EVERY test and record the attempt.
 *
 * Runs tests sequentially rather than in parallel: the per-user and cohort-wide
 * limiters in src/lib/execution/rate-limit.ts are sliding windows, and firing six
 * simultaneous calls spends the burst budget in one instant, turning a normal
 * submit into `rate_limited`. Sequential also lets an infrastructure failure abort
 * the rest instead of spending five more calls to learn the same thing.
 */
export async function gradeAndRecordAttempt(params: {
  slug: string;
  studentId: number;
  code: string;
}): Promise<SubmitOutcome> {
  const { slug, studentId, code } = params;

  const [row] = await db
    .select({
      id: codingProblems.id,
      language: codingProblems.language,
      execution: codingProblems.execution,
      timeLimitMs: codingProblems.timeLimitMs,
    })
    .from(codingProblems)
    .where(and(eq(codingProblems.slug, slug), eq(codingProblems.published, true)))
    .limit(1);

  if (!row) {
    return { graded: false, reason: "not_executable", message: "Problem not found." };
  }

  if (!isExecutable(row.execution)) {
    return {
      graded: false,
      reason: "not_executable",
      message:
        "This problem is presented with a reference solution and no automatic checking, " +
        "so there is nothing to submit. Compare your answer with the reference.",
    };
  }

  // ---- MARKUP: graded here, in this process, with no runtime at all ----------
  // Checked BEFORE `resolveLanguage`, because "html" and "css" are deliberately
  // absent from the execution allow-list (there is no Piston runtime for either)
  // and would otherwise be reported as `unsupported_language`. See
  // src/lib/problems/markup.ts for what "graded" means for markup and, more
  // importantly, for what it does not mean.
  if (isMarkupLanguage(row.language)) {
    return gradeMarkupSubmission({
      problemId: row.id,
      studentId,
      code,
      language: row.language.trim().toLowerCase() as MarkupLanguage,
    });
  }

  const language = resolveLanguage(row.language);
  if (!language) {
    // A content bug, not a student error. Say so rather than recording a failure.
    return {
      graded: false,
      reason: "unsupported_language",
      message: `This problem declares the language "${row.language}", which this platform cannot run. Please report it.`,
    };
  }

  const testRows = await db
    .select()
    .from(codingProblemTests)
    .where(eq(codingProblemTests.problemId, row.id))
    .orderBy(asc(codingProblemTests.orderIndex), asc(codingProblemTests.id));

  if (testRows.length === 0) {
    return {
      graded: false,
      reason: "not_executable",
      message: "This problem has no tests, so it cannot be graded. Please report it.",
    };
  }

  const tests: GradableTest[] = testRows.slice(0, MAX_GRADED_TESTS).map((t) => ({
    name: t.name,
    input: t.input,
    expectedOutput: t.expectedOutput,
    hidden: t.hidden,
  }));

  const mode = comparisonModeFor(language);
  const timeoutMs = clampTimeoutMs(row.timeLimitMs);
  // Deep import, sanctioned by src/lib/execution/index.ts: `runOnPiston` is
  // deliberately not on the barrel so the Piston client and its limiter stay out
  // of every client bundle. This module is server-only.
  const { runOnPiston } = await import("@/lib/execution/piston");

  const graded: GradedTest[] = [];
  let runtimeMs = 0;
  let stderr = "";

  for (const test of tests) {
    const request = buildRunRequest({
      language,
      code,
      input: test.input,
      mode,
      target: "server",
    });
    const result = await runOnPiston(
      { ...request, timeoutMs },
      { userKey: `problem:${studentId}` },
    );
    runtimeMs += result.runtimeMs;

    if (!result.ok && (result.reason === "rate_limited" || result.reason === "backend_unavailable")) {
      // Nothing is written. See the file header for why a 0/n row here would be a
      // permanent fabricated failure.
      return { graded: false, reason: result.reason, message: result.message };
    }

    graded.push(
      gradeTest(
        test,
        {
          ok: result.ok,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.ok ? result.exitCode : null,
          runtimeMs: result.runtimeMs,
        },
        mode,
      ),
    );

    // Keep the FIRST diagnostic: a compile error on test 1 explains the other
    // failures, and the last one is usually the same message repeated.
    if (stderr === "" && result.stderr.trim() !== "") stderr = result.stderr;
    // A timeout on one test says nothing useful about the rest and costs the
    // student their whole rate-limit budget. Stop and report what we have.
    if (!result.ok && result.reason === "timeout") {
      if (stderr === "") stderr = result.message;
      break;
    }
  }

  return recordGradedAttempt({
    studentId,
    problemId: row.id,
    code,
    language,
    // The honest label: this run happened on the server via Piston regardless of
    // where the problem's practice loop runs.
    execution: "piston",
    tests,
    graded,
    runtimeMs,
    stderr,
  });
}

// ---------------------------------------------------------------------------
// Submit — the markup path
// ---------------------------------------------------------------------------

/**
 * Grade an HTML or CSS submission against its structural assertions.
 *
 * NO NETWORK, NO RUNTIME, NO RATE LIMIT. Everything this needs is a pure function
 * over the submitted text (src/lib/problems/markup.ts), so:
 *
 *   * `MAX_GRADED_TESTS` does not apply and every test is graded. That cap exists
 *     only because each executed test is one Piston call inside a 6-per-10 s
 *     window; there is nothing here to exhaust.
 *   * `graded: false` is impossible for infrastructure reasons — the two branches
 *     that produce it upstream (`rate_limited`, `backend_unavailable`) cannot
 *     arise. A markup submit therefore always yields a verdict, which is precisely
 *     why it was worth building rather than leaving HTML and CSS ungraded.
 *   * The attempt records `execution: "none"`. That column says WHAT RAN, and
 *     nothing ran: writing "piston" would put a Piston call in the record that
 *     never happened, and "browser" would claim a result produced on the student's
 *     machine — the one thing the whole submit path exists to avoid asserting.
 *     Reading a "none" attempt back as "no execution, statically checked" is the
 *     truth. `attemptPassed` (completion.ts) reads only the counts, so the derived
 *     solved state is unaffected by the choice.
 *
 * Runtime is measured and stored in MILLISECONDS like every other attempt, even
 * though it is a sub-millisecond string scan: a column that means "ms" for five
 * languages and something else for two would be a trap for the leaderboard and the
 * instructor views that read it.
 */
async function gradeMarkupSubmission(params: {
  problemId: number;
  studentId: number;
  code: string;
  language: MarkupLanguage;
}): Promise<SubmitOutcome> {
  const { problemId, studentId, code, language } = params;

  const testRows = await db
    .select()
    .from(codingProblemTests)
    .where(eq(codingProblemTests.problemId, problemId))
    .orderBy(asc(codingProblemTests.orderIndex), asc(codingProblemTests.id));

  if (testRows.length === 0) {
    return {
      graded: false,
      reason: "not_executable",
      message: "This problem has no requirements to check, so it cannot be graded. Please report it.",
    };
  }

  const tests: GradableTest[] = testRows.map((t) => ({
    name: t.name,
    input: t.input,
    expectedOutput: t.expectedOutput,
    hidden: t.hidden,
  }));

  const startedAt = Date.now();
  // Split ONCE and grade every test against the same file map: the split is the
  // student's submission, not per-test state, and re-splitting per test would let a
  // pathological bundle cost O(tests x bytes) for no benefit.
  const files = splitMarkupBundle(code, language);
  const graded = tests.map((test) => gradeMarkupTest(test, files));
  const runtimeMs = Date.now() - startedAt;

  return recordGradedAttempt({
    studentId,
    problemId,
    code,
    language,
    execution: "none",
    tests,
    graded,
    runtimeMs,
    stderr: "",
  });
}

// ---------------------------------------------------------------------------
// Submit — the shared tail
// ---------------------------------------------------------------------------

/**
 * Write the attempt row and build the client's outcome.
 *
 * Shared by the executed and the markup paths ON PURPOSE. The redaction of a hidden
 * test's diff is done here, once: two copies of "if hidden, omit `detail`" is two
 * places for the next person to forget one, and the thing being forgotten is the
 * answer key. payload.test.ts guards the same property for the problem payload.
 */
async function recordGradedAttempt(params: {
  studentId: number;
  problemId: number;
  code: string;
  /** Stored verbatim in `coding_attempts.language`; already resolved or markup. */
  language: string;
  /** What actually ran, not what the problem declares. See gradeMarkupSubmission. */
  execution: ExecutionMode;
  tests: readonly GradableTest[];
  graded: readonly GradedTest[];
  runtimeMs: number;
  stderr: string;
}): Promise<SubmitOutcome> {
  const { studentId, problemId, code, language, execution, tests, graded, runtimeMs, stderr } =
    params;

  // `totalCount` is the number of tests the problem HAS, not the number that ran,
  // so a run cut short by a timeout can never satisfy passedCount === totalCount.
  const tally = tallyTests(graded);
  const totalCount = tests.length;
  const passed = tally.passedCount === totalCount && totalCount > 0;

  const priorPassing = await hasPassingAttempt(studentId, problemId);

  const [attempt] = await db
    .insert(codingAttempts)
    .values({
      studentId,
      problemId,
      code: code.slice(0, MAX_STREAM_CHARS),
      language,
      passedCount: tally.passedCount,
      totalCount,
      execution,
      runtimeMs,
      stderr: stderr === "" ? null : stderr.slice(0, MAX_STREAM_CHARS),
    })
    .returning({ id: codingAttempts.id });

  return {
    graded: true,
    attemptId: attempt.id,
    passedCount: tally.passedCount,
    totalCount,
    passed,
    newlySolved: passed && !priorPassing,
    runtimeMs,
    stderr: stderr === "" ? null : stderr,
    tests: graded.map((t) =>
      t.hidden
        ? { name: t.name, visible: false, passed: t.passed }
        : {
            name: t.name,
            visible: true,
            passed: t.passed,
            detail: {
              input: tests.find((x) => x.name === t.name)?.input ?? null,
              expected: t.expected,
              actual: t.actual,
            },
          },
    ),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function attemptsFor(
  studentId: number,
  problemIds: readonly number[],
): Promise<{ problemId: number; passedCount: number; totalCount: number }[]> {
  if (problemIds.length === 0) return [];
  return db
    .select({
      problemId: codingAttempts.problemId,
      passedCount: codingAttempts.passedCount,
      totalCount: codingAttempts.totalCount,
    })
    .from(codingAttempts)
    .where(
      and(
        eq(codingAttempts.studentId, studentId),
        inArray(codingAttempts.problemId, [...problemIds]),
      ),
    );
}

/** Derived, as always: is there already a run of this problem that passed? */
async function hasPassingAttempt(studentId: number, problemId: number): Promise<boolean> {
  const rows = await attemptsFor(studentId, [problemId]);
  return solvedProblemIds(rows).has(problemId);
}

/** Widen a selected row to the payload builders' structural input type. */
function asProblemRow(row: {
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
}): ProblemRowLike {
  return row;
}
