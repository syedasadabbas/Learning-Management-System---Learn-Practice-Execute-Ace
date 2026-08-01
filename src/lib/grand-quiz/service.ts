// =============================================================================
// GRAND-QUIZ SERVICE — start, autosave, submit, read, sweep.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream. Modelled on `src/lib/quizzes/service.ts` (read, never
// modified) so the exam and the practice quiz share one shape of plumbing:
// decisions in pure modules, rows in ./queries.ts, one transaction per write.
//
// EXPIRY HAS THREE INDEPENDENT TRIGGERS, and every one of them is necessary:
//
//   1. CLIENT AUTO-SUBMIT — the countdown reaches zero and the browser POSTs
//      submit. Covers the common case, and only that case: it needs the tab open.
//   2. LAZY FINALIZE ON READ — `loadExam`/`startExam` finalize an expired
//      in-progress attempt before returning anything. Covers "the student closed
//      the laptop and came back", and — critically — makes it impossible to READ
//      an expired attempt as if it were still open, which is what a client could
//      otherwise exploit by simply never firing trigger 1.
//   3. CRON SWEEP — `sweepExpiredExams`, behind POST /api/cron/finalize-exams.
//      Covers the attempt nobody ever comes back to. Without it, an abandoned
//      exam stays `in_progress` forever, holds a null score, and is invisible to
//      every read model that filters on a terminal status.
//
// All three converge because submission is idempotent and terminal (I3): the
// first to take the row lock scores it, and the other two replay that result.
// Which one won is recorded in `auto_submitted`, not in the score.
//
// WHAT THIS SERVICE DELIBERATELY DOES NOT DO — reported, not silently chosen:
//   * it fires NO `onScoringEvent`, so the exam does not yet move the leaderboard.
//     A provisional total (I6) published to a ranking would have to be republished
//     when the deferred items land, and the leaderboard aggregates quiz points per
//     (student, week) — the same slot the practice quiz already fills, so an exam
//     event would either double-count or overwrite. That is a cross-stream
//     decision, not one this stream may take alone.
//   * it writes NO `progress` row and unlocks NO week. The practice quiz owns the
//     unlock gate; an exam that also unlocked would make the gate ambiguous.
// Both are listed in the stream's final report as open items.
//
// Units: milliseconds.
// =============================================================================

import { quizPointsFromPercent } from "@/lib/contracts/scoring";
import type { RunCode } from "@/lib/execution";

import { gradeCodeAnswers, type CodeQuestion } from "./code-grading";
import { examPassThreshold, gradeExam, type ExamSavedAnswer } from "./grading";
import { notifyExamCompleted } from "@/lib/notifications";
import {
  toExamInProgress,
  toExamMeta,
  toExamResultFromGraded,
  toExamResultFromStored,
  type ExamInProgressPayload,
  type ExamMeta,
  type ExamResult,
} from "./payload";
import * as queries from "./queries";
import { autosaveDecision, statusForFinalized } from "./state";
import { isExpired } from "./timing";

// ---------------------------------------------------------------------------
// Outcome types — every failure is a value, never a throw
// ---------------------------------------------------------------------------

export type ExamErrorCode =
  | "not_found"
  | "quiz_empty"
  | "attempt_terminal"
  | "attempt_expired"
  | "unknown_question"
  | "option_not_in_question"
  | "wrong_answer_shape";

export type ExamOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: ExamErrorCode; error: string };

/**
 * What Start returns. `state` says which screen to render, so the caller never
 * infers it from the presence or absence of a field.
 */
export type ExamView =
  | { state: "in_progress"; exam: ExamInProgressPayload }
  | { state: "finished"; result: ExamResult };

/** How the runner is supplied. Injected in tests; Piston in production. */
export interface RunnerOption {
  /**
   * Server-side code runner. Defaults to `runOnPiston`, imported DYNAMICALLY so
   * the Piston client and its process-local rate limiter never enter a client
   * bundle and never load during a unit test.
   */
  runner?: RunCode;
}

// ---------------------------------------------------------------------------
// Start — invariant I1
// ---------------------------------------------------------------------------

/**
 * Start (or resume) the student's one attempt at a week's grand quiz.
 *
 * IDEMPOTENT BY CONSTRUCTION. There is no "have you already started?" query
 * before the insert: `queries.startAttempt` inserts and catches the unique
 * violation, so two concurrent Start requests produce one row and both callers
 * receive the same attempt id (I1). Calling this endpoint ten times is
 * indistinguishable from calling it once.
 *
 * Resuming is the same code path as starting, on purpose. A student who reloads
 * mid-exam hits this and gets their in-progress attempt back with the SERVER's
 * remaining time — not a fresh 120 minutes, because `deadline_at` was written once
 * at the original start and is never recomputed (I2).
 *
 * If the attempt they are resuming has expired, it is finalized here before
 * anything is returned (expiry trigger 2). An expired attempt is never handed back
 * as if it were open.
 */
export async function startExam(
  params: { weekId: number; studentId: number; now?: Date } & RunnerOption,
): Promise<ExamOutcome<ExamView>> {
  const now = params.now ?? new Date();

  const quiz = await queries.selectGrandQuizForWeek(params.weekId);
  if (!quiz) {
    return { ok: false, code: "not_found", error: "This week has no exam." };
  }

  const questions = await queries.selectQuestions(quiz.id);
  if (questions.length === 0) {
    // Refused BEFORE an attempt row exists. Creating the one attempt a student
    // gets for an exam with no questions would burn it on nothing.
    return {
      ok: false,
      code: "quiz_empty",
      error: "This exam has no questions yet and cannot be started.",
    };
  }

  const totalPossible = questions.reduce(
    (sum, question) => sum + Math.max(0, Math.floor(question.points)),
    0,
  );

  const started = await queries.startAttempt({
    studentId: params.studentId,
    quiz,
    totalPossible,
    now,
  });

  return buildView({
    attemptId: started.attempt.id,
    studentId: params.studentId,
    now,
    ...(params.runner ? { runner: params.runner } : {}),
  });
}

// ---------------------------------------------------------------------------
// Overview — the read the exam PAGE performs, which must not start anything
// ---------------------------------------------------------------------------

/** Adds the pre-start state to `ExamView`, for a student who has not begun. */
export type ExamOverview =
  | { state: "not_started"; quiz: ExamMeta }
  | { state: "in_progress"; exam: ExamInProgressPayload }
  | { state: "finished"; result: ExamResult };

/**
 * What the exam page renders, WITHOUT creating an attempt.
 *
 * Separate from `startExam` deliberately and this is the important part: if the
 * page called `startExam`, then merely NAVIGATING to /exams/2 — a mistyped URL, a
 * link preview, a browser prefetch — would consume the one attempt a student gets
 * and start a 120-minute clock they were not ready for. So the page reads, and
 * only the explicit Start button writes.
 *
 * An expired in-progress attempt is still finalized here (expiry trigger 2): the
 * page is the most likely place a returning student lands, and handing them an
 * open exam whose time had gone would be the I2 hole.
 */
export async function loadExamOverview(
  params: { weekId: number; studentId: number; now?: Date } & RunnerOption,
): Promise<ExamOutcome<ExamOverview>> {
  const now = params.now ?? new Date();

  const quiz = await queries.selectGrandQuizForWeek(params.weekId);
  if (!quiz) {
    return { ok: false, code: "not_found", error: "This week has no exam." };
  }

  const existing = await queries.selectAttemptForQuiz(params.studentId, quiz.id);
  if (existing) {
    return buildView({
      attemptId: existing.id,
      studentId: params.studentId,
      now,
      ...(params.runner ? { runner: params.runner } : {}),
    });
  }

  const questions = await queries.selectQuestions(quiz.id);
  if (questions.length === 0) {
    return {
      ok: false,
      code: "quiz_empty",
      error: "This exam has no questions yet and cannot be started.",
    };
  }

  // `toExamMeta` is the answer-key barrier's own builder, so even this pre-start
  // summary cannot carry `tests` or `explanation` by accident.
  return { ok: true, data: { state: "not_started", quiz: toExamMeta(quiz, questions) } };
}

// ---------------------------------------------------------------------------
// Read — expiry trigger 2 (lazy finalize)
// ---------------------------------------------------------------------------

/**
 * Read one attempt: the exam to sit, or the result if it is over.
 *
 * LAZY FINALIZE. If the attempt is `in_progress` and its stored deadline has
 * passed, this finalizes it — grading whatever was autosaved — and returns the
 * result. It does not return "in progress, 0 ms remaining", because a client that
 * receives that is one line of JavaScript away from ignoring it.
 *
 * This is the trigger that makes I2 hold against a hostile client: there is no
 * sequence of requests that yields an open exam past its deadline, whatever the
 * browser believes the time is.
 */
export async function loadExam(
  params: { attemptId: number; studentId: number; now?: Date } & RunnerOption,
): Promise<ExamOutcome<ExamView>> {
  const now = params.now ?? new Date();
  return buildView({
    attemptId: params.attemptId,
    studentId: params.studentId,
    now,
    ...(params.runner ? { runner: params.runner } : {}),
  });
}

async function buildView(
  params: { attemptId: number; studentId: number; now: Date } & RunnerOption,
): Promise<ExamOutcome<ExamView>> {
  const { attemptId, studentId, now } = params;

  const context = await queries.selectAttemptContext(attemptId, studentId);
  if (!context) {
    return { ok: false, code: "not_found", error: "Exam attempt not found." };
  }

  // Expiry trigger 2. Note the ORDER: expired-and-open is finalized before any
  // payload is built, so there is no branch that renders an out-of-time exam.
  if (!isTerminalContext(context) && isExpired(context.attempt.deadlineAt, now)) {
    const finalized = await submitExam({
      attemptId,
      studentId,
      now,
      autoSubmitted: true,
      ...(params.runner ? { runner: params.runner } : {}),
    });
    if (!finalized.ok) return finalized;
    return { ok: true, data: { state: "finished", result: finalized.data } };
  }

  if (isTerminalContext(context)) {
    return {
      ok: true,
      data: {
        state: "finished",
        result: resultFromStored(context, /* replayed */ false),
      },
    };
  }

  return {
    ok: true,
    data: {
      state: "in_progress",
      exam: toExamInProgress({
        quiz: context.quiz,
        questions: context.questions,
        options: context.options,
        attempt: context.attempt,
        saved: context.saved,
        now,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Autosave — invariant I3's writing half
// ---------------------------------------------------------------------------

export interface SaveAnswerInput {
  attemptId: number;
  studentId: number;
  questionId: number;
  /** For option-keyed questions. Null clears the selection. */
  selectedOptionId?: number | null;
  /** For `code_write`. Null clears the editor. */
  codeAnswer?: string | null;
  now?: Date;
}

/**
 * Save one answer while the exam is open.
 *
 * Refused once the attempt is terminal or its stored deadline has passed —
 * decided by `autosaveDecision` (pure, tested) against the SERVER's clock, then
 * re-checked inside the transaction under the row lock so a submit that began a
 * millisecond earlier still wins.
 *
 * NOTHING IS SCORED HERE. `awarded` and `max_points` stay 0 until submit, so a
 * student cannot poll this endpoint to discover which answers are right.
 */
export async function saveExamAnswer(
  params: SaveAnswerInput,
): Promise<ExamOutcome<{ saved: true; questionId: number }>> {
  const now = params.now ?? new Date();
  const selectedOptionId = params.selectedOptionId ?? null;
  const codeAnswer = params.codeAnswer ?? null;

  const attempt = await queries.selectAttempt(params.attemptId, params.studentId);
  if (!attempt) {
    return { ok: false, code: "not_found", error: "Exam attempt not found." };
  }

  const decision = autosaveDecision({
    status: attempt.status,
    deadlineAt: attempt.deadlineAt,
    now,
  });
  if (!decision.accept) {
    return { ok: false, code: decision.code, error: decision.error };
  }

  // The question must belong to THIS quiz and the option to THIS question. Both
  // checked server-side: option ids are sequential integers, so a hand-crafted
  // POST could otherwise store another quiz's option as this student's answer.
  const target = await queries.validateAnswerTarget({
    quizId: attempt.quizId,
    questionId: params.questionId,
    selectedOptionId,
  });
  if (!target.ok) {
    return {
      ok: false,
      code: target.reason,
      error:
        target.reason === "unknown_question"
          ? "That question is not part of this exam."
          : "That option does not belong to that question.",
    };
  }

  // A code answer on an MCQ, or an option on a free-form code question, is a
  // client bug. Refused rather than stored, so the graded row cannot contain a
  // field its own question type has no meaning for.
  if (target.type === "code_write" && selectedOptionId != null) {
    return {
      ok: false,
      code: "wrong_answer_shape",
      error: "This question is answered with code, not by choosing an option.",
    };
  }
  if (target.type !== "code_write" && codeAnswer != null) {
    return {
      ok: false,
      code: "wrong_answer_shape",
      error: "This question is answered by choosing an option, not with code.",
    };
  }

  const saved = await queries.saveAnswer({
    attemptId: params.attemptId,
    studentId: params.studentId,
    questionId: params.questionId,
    selectedOptionId,
    codeAnswer,
    now,
  });

  if (saved.outcome === "not_found") {
    return { ok: false, code: "not_found", error: "Exam attempt not found." };
  }
  if (saved.outcome === "refused") {
    // The transaction saw a state our pre-check did not — a submit landed in
    // between. Report the same refusal `autosaveDecision` would have.
    const recheck = autosaveDecision({
      status: saved.status,
      deadlineAt: saved.deadlineAt,
      now,
    });
    return recheck.accept
      ? {
          ok: false,
          code: "attempt_terminal",
          error: "This exam is no longer accepting answers.",
        }
      : { ok: false, code: recheck.code, error: recheck.error };
  }

  return { ok: true, data: { saved: true, questionId: params.questionId } };
}

// ---------------------------------------------------------------------------
// Submit — invariants I3, I4, I5, I6
// ---------------------------------------------------------------------------

export interface SubmitExamInput extends RunnerOption {
  attemptId: number;
  studentId: number;
  now?: Date;
  /** True when the timer closed the exam rather than the student. Recorded, not scored. */
  autoSubmitted?: boolean;
}

/**
 * Grade and close one exam attempt.
 *
 * THE SEQUENCE, AND WHY IT IS THIS SEQUENCE:
 *
 *  1. Read the attempt and everything under it. If it is ALREADY terminal, return
 *     the stored result immediately — no re-scoring, no writes (I3). This is the
 *     cheap path a double-clicked Submit takes.
 *
 *  2. Grade the `code_write` items via the runner. OUTSIDE the transaction,
 *     because each is a network round trip and the pool has five connections.
 *     `rate_limited` and `backend_unavailable` DEFER; they never score zero.
 *
 *  3. Grade everything else purely, producing one row per question (I4) with
 *     `awarded` clamped to `[0, maxPoints]` (I5) and the score as their SUM.
 *
 *  4. `queries.finalizeAttempt` — one transaction, attempt row `FOR UPDATE`. If a
 *     concurrent submit got there first, the work from steps 2–3 is DISCARDED and
 *     the winner's stored result is returned. Both callers therefore receive the
 *     same body, which is what makes the three expiry triggers safe (I3).
 *
 *  5. Return the score, the per-question outcomes and the deferred count, with
 *     the total labelled provisional iff anything deferred (I6).
 *
 * `submitted` is NOT accepted as a payload of answers. Everything was autosaved
 * as the student worked, so a submit cannot introduce an answer, cannot answer a
 * question that is not in the quiz, and cannot arrive too large to process.
 */
export async function submitExam(params: SubmitExamInput): Promise<ExamOutcome<ExamResult>> {
  const now = params.now ?? new Date();
  const { attemptId, studentId } = params;

  const context = await queries.selectAttemptContext(attemptId, studentId);
  if (!context) {
    return { ok: false, code: "not_found", error: "Exam attempt not found." };
  }

  // 1. I3 — already closed. Replay, do not re-score.
  if (isTerminalContext(context)) {
    return { ok: true, data: resultFromStored(context, /* replayed */ true) };
  }

  const expired = isExpired(context.attempt.deadlineAt, now);
  // The timer closed it if the caller says so OR if the server's own clock says
  // the deadline has passed. A student who pressed Submit at 119:59 and whose
  // request arrived at 120:01 is recorded as auto-submitted, which is accurate.
  const autoSubmitted = (params.autoSubmitted ?? false) || expired;

  // 2. Code items, outside the transaction.
  const runner = params.runner ?? defaultRunner;
  const codeQuestions: CodeQuestion[] = context.questions
    .filter((question) => question.type === "code_write")
    .map((question) => ({
      id: question.id,
      type: question.type,
      points: question.points,
      language: question.language,
      tests: question.tests,
    }));

  const saved: ExamSavedAnswer[] = context.saved.map((answer) => ({
    questionId: answer.questionId,
    selectedOptionId: answer.selectedOptionId,
    codeAnswer: answer.codeAnswer,
  }));

  const codeOutcomes =
    codeQuestions.length > 0
      ? await gradeCodeAnswers({ questions: codeQuestions, saved, runner })
      : [];

  // 3. Everything else, purely. One row per question, clamped, summed.
  const graded = gradeExam({
    questions: context.questions.map((question) => ({
      id: question.id,
      type: question.type,
      points: question.points,
      orderIndex: question.orderIndex,
    })),
    options: context.options,
    saved,
    codeOutcomes,
    // The exam's OWN pass mark, not the practice threshold. The seeder writes 60
    // for grand exams while QUIZ_PASS_PERCENT is 70, and judging against 70 made
    // the result card print "Not passed" beside "Pass mark 60%".
    passingScore: context.quiz.passingScore,
  });

  const status = statusForFinalized(graded.deferredCount);

  // 4. The authoritative write, under the row lock.
  const finalized = await queries.finalizeAttempt({
    attemptId,
    studentId,
    rows: graded.rows,
    score: graded.score,
    totalPossible: graded.totalPossible,
    percentage: graded.percentage,
    status,
    autoSubmitted,
    now,
  });

  if (finalized.outcome === "not_found") {
    return { ok: false, code: "not_found", error: "Exam attempt not found." };
  }

  if (finalized.outcome === "already_terminal") {
    // I3 — a concurrent submit won. Discard everything graded above and hand back
    // the recorded result, so both callers see identical bodies.
    return {
      ok: true,
      data: toExamResultFromStored({
        attempt: finalized.attempt,
        quiz: context.quiz,
        questions: context.questions,
        options: context.options,
        stored: finalized.stored,
        quizPointsFor: quizPointsFromPercent,
        replayed: true,
      }),
    };
  }

  // "Your exam has been marked" mail.
  //
  // HERE AND NOWHERE ELSE IN THIS FUNCTION, which is the whole point. This is the
  // fall-through, reached only when `finalizeAttempt` actually wrote the terminal
  // row under its row lock. The two branches above return first:
  //
  //   - `not_found`: nothing happened, so there is nothing to announce.
  //   - `already_terminal`: I3, a CONCURRENT SUBMIT WON. Both callers are handed
  //     identical bodies by design, so notifying here would mail the student twice
  //     for one exam — and the second mail would not even be a retry, it would be
  //     a different request that legitimately lost the race.
  //
  // The expiry sweeper (SWEEP_LIMIT, below) reaches submitExam through this same
  // path, so an auto-submitted exam is announced once, with autoSubmitted = true
  // so the copy can say the deadline closed it rather than implying the student
  // did. The key is scoped to the attempt id, which is an insert-once terminal
  // row, so even if a sweep and a student submit collide only one mail exists.
  //
  // notifyExamCompleted swallows its own errors: an exam result is durable, an
  // email is not, and a mail failure must not turn a graded exam into a 500.
  await notifyExamCompleted({
    studentId,
    attemptId,
    quizId: context.quiz.id,
    weekId: context.quiz.weekId,
    score: graded.score,
    totalPossible: graded.totalPossible,
    percentage: graded.percentage,
    passed: graded.passed,
    passingScore: examPassThreshold(context.quiz.passingScore),
    autoSubmitted,
  });

  // 5. I6 — score, per-question outcomes, deferred count; provisional iff deferred.
  return {
    ok: true,
    data: toExamResultFromGraded({
      attempt: finalized.attempt,
      quiz: context.quiz,
      status: finalized.attempt.status,
      rows: graded.rows,
      summary: graded,
      quizPoints: quizPointsFromPercent(graded.percentage),
      questionMeta: questionMetaMap(context.questions),
      optionText: optionTextMap(context.options),
      replayed: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// Expiry trigger 3 — the cron sweeper
// ---------------------------------------------------------------------------

/** Ceiling on one sweep, so a scheduled invocation cannot run unbounded. */
export const SWEEP_LIMIT = 50;

export interface SweepReport {
  /** Expired in-progress attempts this sweep looked at. */
  examined: number;
  /** Attempts this sweep closed. */
  finalized: number;
  /** Attempts another trigger had already closed. Not an error — the design working. */
  alreadyClosed: number;
  /** Attempts that could not be finalized, with the reason. Reported, never thrown. */
  failed: { attemptId: number; reason: string }[];
  durationMs: number;
  /** True when the limit was reached, so the next run has more to do. */
  more: boolean;
}

/**
 * Finalize exams abandoned with the browser closed.
 *
 * The safety net, not the primary mechanism: the client auto-submitter and the
 * lazy finalize-on-read handle every case where somebody is present. This exists
 * because neither runs if the student never comes back, and an attempt left
 * `in_progress` forever holds a null result the student can never see.
 *
 * PER-ATTEMPT ISOLATION. Each attempt is finalized in its own call and its own
 * transaction, and a failure is recorded rather than thrown. One student's
 * unparseable code answer must not abort the sweep and leave the other 49
 * abandoned attempts open.
 *
 * IDEMPOTENT by I3: an attempt the client already submitted between the SELECT and
 * the finalize comes back as a replay and is counted in `alreadyClosed`.
 */
export async function sweepExpiredExams(
  params: { now?: Date; limit?: number } & RunnerOption = {},
): Promise<SweepReport> {
  const now = params.now ?? new Date();
  const limit = params.limit ?? SWEEP_LIMIT;
  const startedAtMs = Date.now();

  const expired = await queries.selectExpiredInProgressAttempts(now, limit);

  const report: SweepReport = {
    examined: expired.length,
    finalized: 0,
    alreadyClosed: 0,
    failed: [],
    durationMs: 0,
    more: expired.length >= limit,
  };

  for (const row of expired) {
    try {
      const outcome = await submitExam({
        attemptId: row.attemptId,
        studentId: row.studentId,
        now,
        autoSubmitted: true,
        ...(params.runner ? { runner: params.runner } : {}),
      });
      if (!outcome.ok) {
        report.failed.push({ attemptId: row.attemptId, reason: outcome.code });
      } else if (outcome.data.replayed) {
        report.alreadyClosed += 1;
      } else {
        report.finalized += 1;
      }
    } catch (error) {
      report.failed.push({
        attemptId: row.attemptId,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  report.durationMs = Date.now() - startedAtMs;
  return report;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminalContext(context: queries.AttemptContext): boolean {
  return context.attempt.status !== "in_progress";
}

function resultFromStored(context: queries.AttemptContext, replayed: boolean): ExamResult {
  return toExamResultFromStored({
    attempt: context.attempt,
    quiz: context.quiz,
    questions: context.questions,
    options: context.options,
    stored: context.saved,
    quizPointsFor: quizPointsFromPercent,
    replayed,
  });
}

function questionMetaMap(
  questions: readonly { id: number; questionText: string; explanation: string | null }[],
): Map<number, { questionText: string; explanation: string | null }> {
  return new Map(
    questions.map((question) => [
      question.id,
      { questionText: question.questionText, explanation: question.explanation },
    ]),
  );
}

function optionTextMap(
  options: readonly { id: number; optionText: string }[],
): Map<number, string> {
  return new Map(options.map((option) => [option.id, option.optionText]));
}

/**
 * The production runner.
 *
 * `runOnPiston` is imported dynamically and deliberately deep (the barrel does not
 * re-export it) for the reason `src/lib/execution/index.ts` states: it owns the
 * process-local rate limiter and reads `PISTON_URL`, neither of which belongs in a
 * client bundle. `skipRateLimit` is NOT set — an exam submission is charged to the
 * shared bucket like anything else, and a refusal DEFERS the item rather than
 * zeroing it.
 */
const defaultRunner: RunCode = async (request, options) => {
  const { runOnPiston } = await import("@/lib/execution/piston");
  return runOnPiston(request, options ?? {});
};
