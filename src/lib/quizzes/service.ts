// =============================================================================
// QUIZ SERVICE — the only place the quizzes stream touches the database.
// -----------------------------------------------------------------------------
// Owner: quizzes stream.
//
// Route handlers and the take-a-quiz page both call these functions, so the
// server component and the API cannot drift into two different definitions of
// "what a quiz looks like" or "how many attempts are left".
//
// Grading maths lives in ./grading.ts (pure), scoring bands and thresholds in
// @/lib/contracts/scoring (frozen seam). This file is plumbing: read rows, open
// one transaction, write rows, hand off events.
//
// Units: milliseconds for every duration (house rule 5).
// =============================================================================

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  answers as answersTable,
  options as optionsTable,
  penalties as penaltiesTable,
  progress as progressTable,
  questions as questionsTable,
  quizAttempts,
  quizzes as quizzesTable,
  weeks as weeksTable,
} from "@/db/schema";
import type { PenaltyDecision, ScoringEvent } from "@/lib/contracts/events";
import {
  QUIZ_PASS_PERCENT,
  quizPointsFromPercent,
  shouldUnlockNextWeek,
} from "@/lib/contracts/scoring";
import { dedupeAgainstExisting } from "@/lib/penalties/accumulation";
import { evaluatePenalties } from "@/lib/penalties/rules";
import { onScoringEvent } from "@/lib/leaderboard/on-scoring-event";
import { notifyQuizSubmitted } from "@/lib/notifications";

import {
  attemptsRemaining,
  bestPercent,
  gradeSubmission,
  type GradedAnswer,
  type IgnoredAnswer,
  type SubmittedAnswer,
} from "./grading";
import { toStudentQuiz, type StudentQuizPayload } from "./payload";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The student-safe quiz for a week, or null when the week has no quiz.
 *
 * Every field the client receives is produced by `toStudentQuiz`, which has no
 * `isCorrect` or `explanation` in its output types — see payload.ts.
 */
export async function loadStudentQuizByWeek(
  weekId: number,
  studentId: number,
): Promise<StudentQuizPayload | null> {
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    // `kind = 'practice'` added in the add-on wave, and it is a correctness fix
    // rather than a tidy-up. This is a `limit(1)` with no ORDER BY over "every
    // quiz in the week", which was unambiguous while practice was the only kind.
    // With a 'grand' exam and 'realtime' checks now living in the same table,
    // Postgres could hand this the 50-question, one-attempt EXAM and serve it
    // through the practice engine — 3 attempts, best-counts, unlock on pass.
    // A student would sit their exam in the wrong machinery and never get the
    // one attempt they were owed.
    .where(and(eq(quizzesTable.weekId, weekId), eq(quizzesTable.kind, "practice")))
    .limit(1);
  if (!quiz) return null;

  const questionRows = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.quizId, quiz.id))
    .orderBy(asc(questionsTable.orderIndex), asc(questionsTable.id));

  const optionRows = questionRows.length
    ? await db
        .select()
        .from(optionsTable)
        .where(
          inArray(
            optionsTable.questionId,
            questionRows.map((q) => q.id),
          ),
        )
        .orderBy(asc(optionsTable.orderIndex), asc(optionsTable.id))
    : [];

  const attemptPercentages = await attemptPercentagesFor(quiz.id, studentId);

  return toStudentQuiz({
    quiz,
    questions: questionRows,
    options: optionRows,
    attemptPercentages,
  });
}

export interface AttemptHistoryRow {
  id: number;
  attemptNumber: number;
  score: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  status: string;
  startedAt: string;
  submittedAt: string | null;
}

export interface AttemptHistory {
  quizId: number;
  attemptsAllowed: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  bestPercent: number | null;
  passed: boolean;
  attempts: AttemptHistoryRow[];
}

/**
 * The signed-in student's own attempt history for one quiz. Scoped to
 * `studentId` in the WHERE clause, not filtered after the fact — a student must
 * not be able to read another student's attempts by guessing a quiz id.
 */
export async function loadAttemptHistory(
  quizId: number,
  studentId: number,
): Promise<AttemptHistory | null> {
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    // Practice only, for the same reason as the submit path: this history view
    // renders "attempts remaining" against the practice budget, which is
    // meaningless for a one-attempt exam and misleading for an unlimited
    // realtime check.
    .where(and(eq(quizzesTable.id, quizId), eq(quizzesTable.kind, "practice")))
    .limit(1);
  if (!quiz) return null;

  const rows = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.studentId, studentId)))
    .orderBy(desc(quizAttempts.attemptNumber));

  const percentages = rows.map((r) => Number(r.percentage));
  const best = bestPercent(percentages);

  return {
    quizId,
    attemptsAllowed: quiz.attemptsAllowed,
    attemptsUsed: rows.length,
    attemptsRemaining: attemptsRemaining(quiz.attemptsAllowed, rows.length),
    bestPercent: best,
    passed: best != null && best >= QUIZ_PASS_PERCENT,
    attempts: rows.map((r) => ({
      id: r.id,
      attemptNumber: r.attemptNumber,
      score: r.score,
      totalPossible: r.totalPossible,
      percentage: Number(r.percentage),
      passed: Number(r.percentage) >= QUIZ_PASS_PERCENT,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    })),
  };
}

async function attemptPercentagesFor(quizId: number, studentId: number): Promise<number[]> {
  const rows = await db
    .select({ percentage: quizAttempts.percentage })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.studentId, studentId)));
  return rows.map((r) => Number(r.percentage));
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface AttemptResult {
  attemptId: number;
  attemptNumber: number;
  quizId: number;
  weekId: number;
  score: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  passingScore: number;
  attemptsAllowed: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  /** Best across all attempts including this one. Best counts, not latest. */
  bestPercent: number;
  /** Weekly quiz points from the banded scale in scoring.ts, using bestPercent. */
  quizPoints: number;
  /** The week newly (or already) unlocked by passing, null when not applicable. */
  unlockedWeekId: number | null;
  unlockedWeekNumber: number | null;
  /** True only when THIS submit flipped the flag; false when it was already set. */
  unlockedNow: boolean;
  answers: GradedAnswer[];
  ignored: IgnoredAnswer[];
  penaltiesIssued: number;
}

export type SubmitErrorCode =
  | "quiz_not_found"
  | "quiz_empty"
  | "attempts_exhausted";

export type SubmitOutcome =
  | { ok: true; data: AttemptResult }
  | { ok: false; code: SubmitErrorCode; error: string; data?: { attemptsAllowed: number; attemptsUsed: number } };

/**
 * Grade and record one quiz attempt.
 *
 * ATOMICITY (the correctness requirement for this stream)
 * ------------------------------------------------------
 * One `db.transaction` covers the attempt row, its answer rows, the current
 * week's progress row, the next week's unlock, and any penalty rows. Either the
 * student has a graded attempt AND the unlock, or neither exists. A partially
 * applied submit is only repairable with manual SQL, which is why the seam
 * chose node-postgres over neon-http (see src/db/index.ts).
 *
 * CONCURRENCY
 * -----------
 * `attemptNumber` and the attempt-budget check are both computed INSIDE the
 * transaction, after taking a transaction-scoped advisory lock keyed on
 * (studentId, quizId). Two simultaneous submits therefore serialise: the second
 * one sees the first one's row and becomes attempt 3, or is refused. A plain
 * `SELECT count(*)` without the lock cannot do this — `SELECT ... FOR UPDATE`
 * also cannot, because there is no row to lock before the first attempt exists.
 * The lock is per student-and-quiz, so it does not serialise the cohort.
 *
 * SIDE EFFECTS OUTSIDE THE TRANSACTION
 * ------------------------------------
 * `onScoringEvent` is called after commit and its rejection is swallowed: a
 * leaderboard failure must never roll back a grade (see the stub's contract).
 */
export async function submitQuizAttempt(params: {
  quizId: number;
  studentId: number;
  cohortId: number | null;
  submitted: readonly SubmittedAnswer[];
}): Promise<SubmitOutcome> {
  const { quizId, studentId, cohortId, submitted } = params;

  const outcome = await db.transaction(async (tx): Promise<SubmitOutcome> => {
    // Serialise concurrent submits for this (student, quiz) pair. Released
    // automatically at commit or rollback — no unlock path to leak.
    await tx.execute(
      sql`select pg_advisory_xact_lock(${studentId}::int4, ${quizId}::int4)`,
    );

    const [quiz] = await tx
      .select()
      .from(quizzesTable)
      .where(eq(quizzesTable.id, quizId))
      .limit(1);
    if (!quiz) {
      return { ok: false, code: "quiz_not_found", error: "Quiz not found." };
    }

    // WRONG-ENGINE GUARD, added in the add-on wave.
    //
    // This endpoint grades with the PRACTICE rules: up to 3 attempts, best
    // counts, unlock on pass. Quiz ids are sequential integers, so a student who
    // changes the id in the URL could otherwise submit a 'grand' exam here and
    // have it graded by the wrong engine — three attempts at a one-attempt exam,
    // bypassing the unique-index guarantee the grand-quiz stream relies on
    // (invariant I1). A 'realtime' check submitted here would mint a graded
    // attempt for something that is meant to carry no marks at all.
    //
    // Reported as not-found rather than a distinct error: which quiz kinds exist
    // at which ids is not information this endpoint should confirm.
    if (quiz.kind !== "practice") {
      return { ok: false, code: "quiz_not_found", error: "Quiz not found." };
    }

    const [week] = await tx
      .select()
      .from(weeksTable)
      .where(eq(weeksTable.id, quiz.weekId))
      .limit(1);
    if (!week) {
      // Referential integrity makes this unreachable; treated as not-found
      // rather than crashed so the client gets the envelope, not a 500.
      return { ok: false, code: "quiz_not_found", error: "Quiz week not found." };
    }

    // ---- Attempt budget, inside the lock --------------------------------
    const priorAttempts = await tx
      .select({ id: quizAttempts.id, percentage: quizAttempts.percentage })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.studentId, studentId)));

    if (priorAttempts.length >= quiz.attemptsAllowed) {
      // Nothing has been written yet, so returning (rather than throwing) is
      // enough: the transaction commits an empty unit of work.
      return {
        ok: false,
        code: "attempts_exhausted",
        error: `You have used all ${quiz.attemptsAllowed} attempts for this quiz.`,
        data: { attemptsAllowed: quiz.attemptsAllowed, attemptsUsed: priorAttempts.length },
      };
    }
    const attemptNumber = priorAttempts.length + 1;

    // ---- Answer key + grading -------------------------------------------
    const questionRows = await tx
      .select({
        id: questionsTable.id,
        explanation: questionsTable.explanation,
      })
      .from(questionsTable)
      .where(eq(questionsTable.quizId, quizId))
      .orderBy(asc(questionsTable.orderIndex), asc(questionsTable.id));

    if (questionRows.length === 0) {
      return {
        ok: false,
        code: "quiz_empty",
        error: "This quiz has no questions and cannot be graded.",
      };
    }

    const optionRows = await tx
      .select({
        id: optionsTable.id,
        questionId: optionsTable.questionId,
        isCorrect: optionsTable.isCorrect,
      })
      .from(optionsTable)
      .where(
        inArray(
          optionsTable.questionId,
          questionRows.map((q) => q.id),
        ),
      );

    const graded = gradeSubmission({
      questions: questionRows,
      options: optionRows,
      submitted,
    });

    const now = new Date();

    // ---- Attempt row -----------------------------------------------------
    const [attempt] = await tx
      .insert(quizAttempts)
      .values({
        studentId,
        quizId,
        score: graded.score,
        totalPossible: graded.totalPossible,
        // decimal(5,2) maps to string in Drizzle; fix the scale here so the
        // stored value equals the one already compared against the threshold.
        percentage: graded.percentage.toFixed(2),
        status: "graded",
        attemptNumber,
        startedAt: now,
        submittedAt: now,
      })
      .returning({ id: quizAttempts.id });

    await tx.insert(answersTable).values(
      graded.answers.map((a) => ({
        attemptId: attempt.id,
        questionId: a.questionId,
        selectedOptionId: a.selectedOptionId,
        isCorrect: a.isCorrect,
      })),
    );

    // ---- Best-attempt maths ---------------------------------------------
    const allPercentages = [...priorAttempts.map((a) => Number(a.percentage)), graded.percentage];
    const best = bestPercent(allPercentages) ?? graded.percentage;
    const quizPoints = quizPointsFromPercent(best);

    // ---- Current week progress ------------------------------------------
    // `overallScore` is deliberately NOT written here: it is the aggregate the
    // progress-tracking stream owns, and quizzes contributes to it through the
    // scoring event. Writing it from here would clobber assignment points.
    //
    // On INSERT the row is created with weekUnlocked = true: the student has
    // just submitted this week's quiz, so they demonstrably had access to the
    // week. Creating it as false would make week 1 — which has no progress row
    // until now — read as locked. On CONFLICT the flag is left untouched, so
    // this can never flip a week that another stream deliberately locked.
    await tx
      .insert(progressTable)
      .values({
        studentId,
        weekId: quiz.weekId,
        quizCompleted: true,
        weekUnlocked: true,
        unlockedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [progressTable.studentId, progressTable.weekId],
        set: { quizCompleted: true, updatedAt: now },
      });

    // ---- Next week unlock (idempotent) ----------------------------------
    let unlockedWeekId: number | null = null;
    let unlockedWeekNumber: number | null = null;
    let unlockedNow = false;

    if (shouldUnlockNextWeek(best)) {
      const [nextWeek] = await tx
        .select({ id: weeksTable.id, weekNumber: weeksTable.weekNumber })
        .from(weeksTable)
        .where(
          and(
            eq(weeksTable.courseId, week.courseId),
            eq(weeksTable.weekNumber, week.weekNumber + 1),
          ),
        )
        .limit(1);

      if (nextWeek) {
        unlockedWeekId = nextWeek.id;
        unlockedWeekNumber = nextWeek.weekNumber;

        const [existing] = await tx
          .select({ weekUnlocked: progressTable.weekUnlocked })
          .from(progressTable)
          .where(
            and(
              eq(progressTable.studentId, studentId),
              eq(progressTable.weekId, nextWeek.id),
            ),
          )
          .limit(1);
        unlockedNow = !existing?.weekUnlocked;

        // Idempotent by construction: the flag is only ever set to true, and
        // `unlockedAt` keeps its original value so re-submitting a passed quiz
        // does not rewrite history ("unlocks exactly once").
        await tx
          .insert(progressTable)
          .values({
            studentId,
            weekId: nextWeek.id,
            weekUnlocked: true,
            unlockedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [progressTable.studentId, progressTable.weekId],
            set: {
              weekUnlocked: true,
              unlockedAt: sql`coalesce(${progressTable.unlockedAt}, ${now})`,
              updatedAt: now,
            },
          });
      }
    }

    // ---- Penalties (decided by the penalties stream, persisted here) -----
    let penaltiesIssued = 0;
    if (!graded.passed) {
      const decisions: PenaltyDecision[] = evaluatePenalties({
        studentId,
        // A quiz has no deadline of its own in the schema; lateness is the
        // submissions stream's concern. Passing 0 keeps this input honest.
        daysLate: 0,
        quizBestPercent: best,
        missedEntirely: false,
      });
      // Deduplicate against what the student already holds unresolved, using the
      // penalties stream's own pure helper rather than a second rule here: three
      // failed attempts are one standing low_score notice, not three.
      //
      // NOTE: `issuePenalties` in src/lib/penalties/service.ts does the same
      // thing, but it writes through `db` and so could not participate in this
      // transaction. Persisting here keeps the attempt, the unlock and the
      // penalty atomic; the dedupe DECISION still comes from one place.
      const existingPenalties = await tx
        .select({ type: penaltiesTable.type, resolved: penaltiesTable.resolved })
        .from(penaltiesTable)
        .where(eq(penaltiesTable.studentId, studentId));

      const toIssue = dedupeAgainstExisting(decisions, existingPenalties);

      if (toIssue.length > 0) {
        await tx.insert(penaltiesTable).values(
          toIssue.map((d) => ({
            studentId,
            type: d.type,
            severity: d.severity,
            description: d.description,
            penaltyPoints: d.penaltyPoints,
            // System-issued: no instructor pressed a button.
            issuedBy: null,
            issuedAt: now,
          })),
        );
        penaltiesIssued = toIssue.length;
      }
    }

    const attemptsUsed = attemptNumber;
    return {
      ok: true,
      data: {
        attemptId: attempt.id,
        attemptNumber,
        quizId,
        weekId: quiz.weekId,
        score: graded.score,
        totalPossible: graded.totalPossible,
        percentage: graded.percentage,
        passed: graded.passed,
        passingScore: quiz.passingScore,
        attemptsAllowed: quiz.attemptsAllowed,
        attemptsUsed,
        attemptsRemaining: attemptsRemaining(quiz.attemptsAllowed, attemptsUsed),
        bestPercent: best,
        quizPoints,
        unlockedWeekId,
        unlockedWeekNumber,
        unlockedNow,
        answers: graded.answers,
        ignored: graded.ignored,
        penaltiesIssued,
      },
    };
  });

  if (outcome.ok) {
    await notifyLeaderboard({
      studentId,
      cohortId,
      source: "quiz",
      weekId: outcome.data.weekId,
      points: outcome.data.quizPoints,
    });

    // "Your quiz has been marked" mail. AFTER the transaction has committed and
    // beside notifyLeaderboard, deliberately, for the same two reasons that block
    // exists at all:
    //
    //   - It must not run inside the transaction. Enqueueing from inside means a
    //     later rollback leaves a job pointing at an attempt that does not exist,
    //     and the student is told about a mark that was never recorded.
    //   - It must not be able to fail the submit. A student's attempt is the
    //     durable thing; an email is not. notifyQuizSubmitted returns a
    //     NotifyResult and swallows its own errors rather than throwing, so a mail
    //     problem cannot lose someone's quiz.
    //
    // Nothing is sent from here: this records the notification row and enqueues a
    // job, and the queue's drain sends it through the dedupe ledger
    // (src/lib/mail/dispatch.ts). The idempotency key is scoped to
    // quiz_attempts.id, so a retried submit cannot mail twice.
    await notifyQuizSubmitted({
      studentId,
      attemptId: outcome.data.attemptId,
      quizId: outcome.data.quizId,
      weekId: outcome.data.weekId,
      attemptNumber: outcome.data.attemptNumber,
      attemptsAllowed: outcome.data.attemptsAllowed,
      score: outcome.data.score,
      totalPossible: outcome.data.totalPossible,
      percentage: outcome.data.percentage,
      passed: outcome.data.passed,
      passingScore: outcome.data.passingScore,
    });
  }

  return outcome;
}

/**
 * Fire-and-forget-for-correctness leaderboard notification.
 *
 * Awaited so a fast implementation lands before the response, but its rejection
 * is contained: the grade is already committed and must stand even if the
 * ranking rebuild fails. Swallowing here — rather than at the call site — means
 * no future caller can forget the try/catch.
 */
async function notifyLeaderboard(event: ScoringEvent): Promise<void> {
  try {
    await onScoringEvent(event);
  } catch (err) {
    console.error("[quizzes] onScoringEvent failed; grade is unaffected.", err);
  }
}
