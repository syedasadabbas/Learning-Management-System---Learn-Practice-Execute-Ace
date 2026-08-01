// =============================================================================
// GRADING `code_write` ITEMS — run the hidden tests, or DEFER. Never fabricate.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream. Consumes `src/lib/execution/**` (code-execution
// stream) through an INJECTED runner, so every branch below is unit-testable with
// no network and no Piston.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
//
// `shouldDeferToInstructor(result)` from the execution contract is TRUE for
// exactly two failures — `rate_limited` and `backend_unavailable` — and those two
// say NOTHING about the student's code. Scoring them zero is not a strict grade,
// it is a fabricated one: the mark would record a property of a shared free
// server, on a one-attempt exam the student cannot retake. So they defer.
//
// A `timeout` does NOT defer. That is the student's own program looping, which is
// a real failure of a real submission, and the execution contract says so.
//
// !!! `unsupported_language` DOES NOT DEFER EITHER, AND THAT IS AN OPEN DEFECT.
// This header previously claimed the case "is caught before any run happens (see
// `resolveLanguage`)". IT IS NOT: nothing in this file calls `resolveLanguage`,
// the only language check below is `if (!question.language)`, and a language that
// is off the execution allow-list (`src/lib/execution/languages.ts`:
// javascript | typescript | python | cpp | java | sql) is therefore sent to the
// runner, comes back `unsupported_language`, is NOT matched by
// `shouldDeferToInstructor`, and is counted as a FAILED TEST — so the item scores
// a hard 0 and the attempt is finalized `graded`, i.e. FINAL, not provisional.
//
// That is a fabricated zero, and it is live: the seeded week-1 (`language:
// "html"`) and week-2 (`language: "css"`) exams each carry six 8-point
// `code_write` items — 48 of 150 marks — that no allow-listed runtime can
// execute, capping those exams at 102/150 = 68% against a 70% pass threshold.
// `scripts/content/exams/index.ts` states the intended fallback (defer to
// instructor grading, exactly as for `rate_limited` / `backend_unavailable`); it
// has not been implemented here. Reported by qa-hardening; comment corrected to
// stop asserting a guard that does not exist. Do not delete this note without
// implementing the deferral.
//
// COST DISCIPLINE. The public Piston instance is shared by the whole cohort and
// rate-limits. Three consequences, all implemented below:
//   1. empty code is never sent — there is nothing to run;
//   2. tests run SEQUENTIALLY per question, never fanned out;
//   3. the first infrastructure failure SHORT-CIRCUITS the remaining items and
//      the remaining tests. Hammering an instance that just said 429 makes the
//      outage worse for the other 79 students and cannot produce a mark anyway.
//
// Units: milliseconds.
// =============================================================================

import {
  resolveLanguage,
  shouldDeferToInstructor,
  type RunCode,
  type RunResult,
} from "@/lib/execution";

import { clampAwarded, type CodeOutcome, type ExamSavedAnswer } from "./grading";

/**
 * One hidden test, as stored in `questions.tests` (jsonb).
 * Shape: `Array<{ name: string; input: string; expected: string }>`.
 */
export interface CodeTest {
  name: string;
  input: string;
  expected: string;
}

/** A `code_write` question as this module needs it. `tests` is untrusted jsonb. */
export interface CodeQuestion {
  id: number;
  type: string;
  points: number;
  language: string | null;
  /** Raw jsonb. NEVER sent to a client — see ./payload.ts. */
  tests: unknown;
}

/** Wall-clock ceiling for one test run, in milliseconds. Clamped again by the runner. */
export const CODE_TEST_TIMEOUT_MS = 8_000;

/**
 * Validate `questions.tests` on read.
 *
 * jsonb is whatever was written to it. A seed bug producing
 * `{ tests: "see spec" }` must not throw inside a submit transaction, so this
 * returns `[]` for anything unrecognised and the caller treats "no tests" as
 * DEFER — an item that cannot be auto-graded goes to a human, it does not score
 * zero. Individual malformed entries are dropped rather than failing the set:
 * grading a student against the four valid tests of five beats grading them
 * against none.
 */
export function parseTests(raw: unknown): CodeTest[] {
  if (!Array.isArray(raw)) return [];
  const tests: CodeTest[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const expected = candidate.expected;
    if (typeof expected !== "string") continue;
    tests.push({
      name: typeof candidate.name === "string" ? candidate.name : `test ${tests.length + 1}`,
      input: typeof candidate.input === "string" ? candidate.input : "",
      expected,
    });
  }
  return tests;
}

/**
 * Compare a program's stdout with a test's expected output.
 *
 * Trailing whitespace and line endings are normalised before comparison. A
 * student whose program prints the right answer followed by "\r\n" instead of
 * "\n" has answered the question; failing them for their operating system's line
 * ending would be a defect in this grader, not in their code. Nothing else is
 * normalised — case and interior spacing are the student's responsibility.
 */
export function outputMatches(stdout: string, expected: string): boolean {
  return normaliseOutput(stdout) === normaliseOutput(expected);
}

function normaliseOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * The mark for `passed` of `total` tests, out of `maxPoints`.
 *
 * PARTIAL CREDIT, and the trade-off stated rather than hidden: all-or-nothing was
 * the alternative. Proportional is chosen because a 4-mark question where 3 of 4
 * hidden tests pass represents real work, and on a one-attempt exam there is no
 * second chance to recover it. `Math.round` rather than `floor` so 1 of 2 tests on
 * a 3-mark question is 2 rather than 1 — rounding toward the student, since the
 * rounding direction is arbitrary and the consequence is not.
 *
 * Always routed through `clampAwarded`, so I5's ceiling holds here too.
 */
export function marksFor(passed: number, total: number, maxPoints: number): number {
  if (total <= 0) return 0;
  const ratio = Math.max(0, Math.min(passed, total)) / total;
  return clampAwarded(Math.round(maxPoints * ratio), maxPoints);
}

// ---------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------

export interface GradeCodeParams {
  question: CodeQuestion;
  /** The student's stored source, already normalised (null when they wrote nothing). */
  code: string | null;
  /** Injected. `runOnPiston` in production, a stub in tests. Never throws, by contract. */
  runner: RunCode;
  timeoutMs?: number;
}

/**
 * Grade one `code_write` answer.
 *
 * Returns a `CodeOutcome`. It NEVER throws and never rejects — the execution
 * contract guarantees `runner` returns failures as values, and the one thing that
 * could still throw (a runner that breaks its own contract) is caught and
 * DEFERRED rather than allowed to unwind a submit transaction and cost the
 * student their attempt.
 */
export async function gradeCodeAnswer(params: GradeCodeParams): Promise<CodeOutcome> {
  const { question, code, runner } = params;
  const timeoutMs = params.timeoutMs ?? CODE_TEST_TIMEOUT_MS;
  const maxPoints = Math.max(0, Math.floor(question.points));

  // Nothing written: a genuine zero, and no call to the shared instance.
  if (code == null || code.trim().length === 0) {
    return { questionId: question.id, kind: "scored", awarded: 0, note: "No code was submitted." };
  }

  const tests = parseTests(question.tests);
  if (tests.length === 0) {
    // An authoring gap, not a wrong answer. A human grades it.
    return {
      questionId: question.id,
      kind: "deferred",
      reason: "This question carries no automated tests, so an instructor will grade it.",
      infrastructure: false,
    };
  }

  if (!question.language) {
    return {
      questionId: question.id,
      kind: "deferred",
      reason: "This question does not name a language, so an instructor will grade it.",
      infrastructure: false,
    };
  }

  // NO RUNTIME FOR THIS LANGUAGE -> DEFER, never zero.
  //
  // This check was missing and the consequence was severe. `shouldDeferToInstructor`
  // treats `unsupported_language` as a content bug that "scores normally (zero)",
  // which is reasonable for practice but catastrophic here: the seeded week-1 and
  // week-2 exams carry six 8-point `code_write` items in `html` and `css`, neither
  // of which any runtime executes. Those 48 of 150 marks were being recorded as a
  // FINAL zero, capping both exams at 102/150 = 68% — so no student could pass
  // either one, on an exam that cannot be retaken.
  //
  // Deferring instead is what invariant I6 requires: an item nobody has judged
  // must never contribute a fabricated zero to a total labelled final. A student's
  // answer being unjudgeable by machine is our problem, not their mistake.
  // `infrastructure: false` because it is not an outage — the question genuinely
  // needs a human (or a markup/CSS assertion grader nobody has built yet).
  if (resolveLanguage(question.language) === null) {
    return {
      questionId: question.id,
      kind: "deferred",
      reason:
        `Answers in ${question.language} cannot be graded automatically, ` +
        `so an instructor will mark this one.`,
      infrastructure: false,
    };
  }

  let passed = 0;
  for (const test of tests) {
    let result: RunResult;
    try {
      result = await runner({
        language: question.language,
        source: code,
        stdin: test.input,
        timeoutMs,
      });
    } catch {
      // A runner that throws has broken the execution contract. Defer — the one
      // thing that must not happen is a zero for an unrun program.
      return {
        questionId: question.id,
        kind: "deferred",
        reason: "The code runner failed unexpectedly, so an instructor will grade this answer.",
        infrastructure: true,
      };
    }

    if (shouldDeferToInstructor(result)) {
      // rate_limited | backend_unavailable. Abandon the remaining tests: they
      // would hit the same wall, and one deferral is enough to defer the item.
      return {
        questionId: question.id,
        kind: "deferred",
        reason: deferralReason(result),
        infrastructure: true,
      };
    }

    if (result.ok && result.exitCode === 0 && outputMatches(result.stdout, test.expected)) {
      passed += 1;
    }
    // Everything else — non-zero exit, wrong output, timeout, unsupported
    // language — is a failed test. Real failures of a real submission.
  }

  const awarded = marksFor(passed, tests.length, maxPoints);
  return {
    questionId: question.id,
    kind: "scored",
    awarded,
    note: `${passed} of ${tests.length} hidden tests passed.`,
  };
}

/** Prose for the student, taken from the runner's own user-safe message. */
function deferralReason(result: RunResult): string {
  const detail = !result.ok ? result.message : "";
  const base =
    "The code runner was unavailable, so this answer has been sent to an instructor" +
    " for grading rather than marked wrong.";
  return detail ? `${base} (${detail})` : base;
}

// ---------------------------------------------------------------------------
// Every code_write question in the exam
// ---------------------------------------------------------------------------

/**
 * Grade every `code_write` question in one exam.
 *
 * Runs OUTSIDE the submit transaction, on purpose. A 50-question exam with eight
 * code items and five tests each is 40 network round trips; holding a Postgres
 * connection open across them would exhaust the five-connection pool the moment
 * two students submitted at once. The authoritative status check still happens
 * inside the transaction afterwards (I3), so a submit that raced another one
 * simply discards this work rather than double-scoring.
 *
 * SHORT-CIRCUIT: once one item has deferred for an infrastructure reason, every
 * remaining item defers WITHOUT a further call. Continuing would queue 40 more
 * requests at an instance that just refused one, delaying this student's response
 * and everyone else's.
 */
export async function gradeCodeAnswers(params: {
  questions: readonly CodeQuestion[];
  saved: readonly ExamSavedAnswer[];
  runner: RunCode;
  timeoutMs?: number;
}): Promise<CodeOutcome[]> {
  const { questions, saved, runner, timeoutMs } = params;

  const codeByQuestion = new Map<number, string | null>();
  for (const answer of saved) codeByQuestion.set(answer.questionId, answer.codeAnswer);

  const outcomes: CodeOutcome[] = [];
  let backendDown: string | null = null;

  for (const question of questions) {
    if (question.type !== "code_write") continue;

    if (backendDown !== null) {
      outcomes.push({
        questionId: question.id,
        kind: "deferred",
        reason: backendDown,
        infrastructure: true,
      });
      continue;
    }

    const outcome = await gradeCodeAnswer({
      question,
      code: codeByQuestion.get(question.id) ?? null,
      runner,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    outcomes.push(outcome);

    // Only an infrastructure deferral short-circuits. "No tests authored" is
    // specific to one question and must not condemn the others.
    if (outcome.kind === "deferred" && outcome.infrastructure) {
      backendDown = outcome.reason;
    }
  }

  return outcomes;
}
